"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collectGarbage } from "@cutaway/media-engine";
import {
  archiveFileName,
  exportProjectArchive,
  importProjectArchive,
  parseProjectFile,
  referencedBlobKeys,
  serializeProject,
  projectFileName,
  type ArchiveProgress,
} from "@cutaway/project-io";
import type { ProjectDocument } from "@cutaway/types";
import {
  browserLegacyStorage,
  inspectLegacyProjectText,
  readLegacyCandidateJson,
  readLegacyImportDecision,
  recordLegacyImportDecision,
  shouldOfferLegacyImport,
} from "@/features/desktop-stage/legacyImport";
import { useMediaImportContext } from "@/features/media/MediaImportProvider";
import { useEditorStore } from "@/state/editorStore";
import {
  isStorageAvailable,
  listProjects,
  loadMostRecentProject,
  saveProject,
} from "@/state/projectStorage";
import { downloadBlob } from "./downloadBlob";
import {
  UNKNOWN_PROJECT_FILE_MESSAGE,
  classifyProjectFile,
  describeArchiveFailure,
  formatByteSize,
  unbundledAssetNotice,
  type ArchiveNotice,
} from "./projectFiles";

/**
 * Autosave, restore, and file import/export.
 *
 * Saving is debounced rather than immediate: dragging a clip fires a store
 * update on every pointer move, and writing the document to IndexedDB sixty
 * times a second would stall the drag. A short idle delay batches a gesture
 * into one write.
 *
 * Two file formats leave this hook, and the difference matters to the user:
 *
 * - `.desktopstage` (`downloadArchive`) is the portable one — the document plus
 *   the original bytes of every referenced media file, which is what makes a
 *   project survive the trip to another computer.
 * - JSON (`downloadProject`) is the document alone. It stores media *keys*, and
 *   those keys address blobs in this browser only, so it is labelled
 *   document-only everywhere it appears.
 *
 * Opening is dispatched by {@link classifyProjectFile}: archives go to the
 * archive reader, JSON to the v1 converter or the current parser, and neither
 * reader is ever given a file the other one was chosen for.
 */

/** Idle time before an autosave fires. */
const AUTOSAVE_DELAY_MS = 800;

/**
 * Recorded in the archive manifest, for a human reading the file later.
 *
 * Informational only: the archive's own `formatVersion` is what gates reading
 * it, so a stale string here cannot make an unreadable archive look readable.
 */
const APP_VERSION = "0.2.0";

/** How much of a file to read when deciding what it is. Enough for a ZIP head. */
const FILE_HEAD_BYTES = 512;

/**
 * A file's leading bytes, or null when even that cannot be read.
 *
 * `slice` is used rather than reading the whole file: a two-gigabyte archive
 * must not be pulled into memory just to find out that it is a ZIP.
 */
async function readFileHead(file: File): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await file.slice(0, FILE_HEAD_BYTES).arrayBuffer());
  } catch {
    return null;
  }
}

export type SaveState = "idle" | "saving" | "saved" | "error" | "unavailable";

export type LegacyImportStatus = "idle" | "offered" | "importing" | "error";

/**
 * The one-time offer to bring the prototype's `localStorage` project forward.
 *
 * It is a state machine rather than a boolean because every step can fail: the
 * conversion, the save, and even recording the user's answer. The UI shows
 * `status` and `error`; nothing here resolves until the work is actually done.
 */
export interface LegacyImportOffer {
  status: LegacyImportStatus;
  /** Why the last import attempt failed, when `status` is `"error"`. */
  error: string | null;
  /**
   * Converts, saves to IndexedDB, then opens the legacy project.
   *
   * The save happens first and the offer is only marked done after it succeeds,
   * so a failed write never leaves the user believing their old work is safe.
   */
  accept: () => Promise<void>;
  /** Records the refusal, so the offer stops interrupting normal editing. */
  decline: () => void;
}

/** Which half of the archive flow is running, if any. */
export type ArchivePhase = "idle" | "exporting" | "importing";

export interface ArchiveState {
  phase: ArchivePhase;
  /** Progress of the operation in flight, or null when there is none. */
  progress: ArchiveProgress | null;
  /** The result of the last archive operation, until it is dismissed. */
  notice: ArchiveNotice | null;
  dismissNotice: () => void;
  /** Bytes of the last `.desktopstage` written or read. */
  lastArchiveBytes: number | null;
  /** True while an archive is being packed or unpacked. */
  isBusy: boolean;
}

export interface ProjectPersistence {
  saveState: SaveState;
  lastSavedAt: number | null;
  /** Issues reported by the last load, e.g. clips dropped during repair. */
  loadIssues: string[];
  dismissIssues: () => void;
  saveNow: () => Promise<void>;
  /**
   * Downloads the document alone as JSON.
   *
   * Portable between installs of the editor, but *not* portable with media: the
   * JSON stores references to blobs that live in this browser. Labelled as
   * document-only wherever it is offered, and again when it completes.
   */
  downloadProject: () => void;
  /** Packs the document and every referenced media blob into `.desktopstage`. */
  downloadArchive: () => Promise<void>;
  openProjectFile: (file: File) => Promise<void>;
  /** Status of the portable-archive flow, for the toolbar and the banner. */
  archive: ArchiveState;
  legacyImport: LegacyImportOffer;
}

export function useProjectPersistence(): ProjectPersistence {
  const project = useEditorStore((state) => state.project);
  const replaceProject = useEditorStore((state) => state.replaceProject);
  const { store } = useMediaImportContext();

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [loadIssues, setLoadIssues] = useState<string[]>([]);
  const [legacyStatus, setLegacyStatus] = useState<LegacyImportStatus>("idle");
  const [legacyError, setLegacyError] = useState<string | null>(null);
  const [archivePhase, setArchivePhase] = useState<ArchivePhase>("idle");
  const [archiveProgress, setArchiveProgress] = useState<ArchiveProgress | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<ArchiveNotice | null>(null);
  const [lastArchiveBytes, setLastArchiveBytes] = useState<number | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Blocks autosave until the restore attempt has finished. */
  const restoredRef = useRef(false);
  /** The converted legacy document, held from discovery until the user decides. */
  const legacyProjectRef = useRef<ProjectDocument | null>(null);
  /**
   * The synchronous guard against a duplicated archive action.
   *
   * A ref rather than the `phase` state: two clicks in the same tick both read
   * the state from before either re-render, so a state check alone would pack
   * the same project twice and hand the browser two downloads.
   */
  const archiveBusyRef = useRef(false);

  const beginArchive = useCallback((phase: ArchivePhase) => {
    archiveBusyRef.current = true;
    setArchivePhase(phase);
    setArchiveProgress(null);
    setArchiveNotice(null);
  }, []);

  const endArchive = useCallback(() => {
    archiveBusyRef.current = false;
    setArchivePhase("idle");
    setArchiveProgress(null);
  }, []);

  const persist = useCallback(async (document: ProjectDocument) => {
    if (!isStorageAvailable()) {
      setSaveState("unavailable");
      return;
    }

    setSaveState("saving");
    try {
      await saveProject(document);
      setLastSavedAt(Date.now());
      setSaveState("saved");
    } catch {
      // Quota exhaustion or a private-browsing restriction. Surfaced in the
      // status bar rather than thrown, since the editor still works unsaved.
      setSaveState("error");
    }
  }, []);

  // --- Restore on startup, then sweep orphaned media --------------------
  useEffect(() => {
    let cancelled = false;

    /**
     * Looks for the prototype's saved project, once, at startup.
     *
     * Only consulted when nothing was restored: a current project is newer by
     * definition, and offering to replace it is exactly the silent overwrite
     * this path exists to avoid. The old `localStorage` value is never removed —
     * if this build has a bug, the user's only copy must survive it.
     */
    const considerLegacyCandidate = (hasRestoredProject: boolean) => {
      if (hasRestoredProject) return;

      const storage = browserLegacyStorage();
      const candidateJson = readLegacyCandidateJson(storage);
      if (!candidateJson) return;

      const candidate = inspectLegacyProjectText(candidateJson);
      const decision = readLegacyImportDecision(storage);
      if (candidate.kind !== "converted") return;
      if (!shouldOfferLegacyImport({ hasRestoredProject, decision, candidate })) return;

      legacyProjectRef.current = candidate.project;
      if (!cancelled) setLegacyStatus("offered");
    };

    void (async () => {
      try {
        if (!isStorageAvailable()) {
          setSaveState("unavailable");
          considerLegacyCandidate(false);
          return;
        }

        let hasRestoredProject = false;
        try {
          const stored = await loadMostRecentProject();
          if (!cancelled && stored) {
            replaceProject(stored.document);
            setLastSavedAt(stored.savedAt);
            setSaveState("saved");
            hasRestoredProject = true;
          }
        } catch {
          // A failed restore must never block the editor from opening. It is
          // treated as "nothing restored"; the offer below is still an explicit
          // user choice, so an unread shelf cannot cause a silent replacement.
        }

        if (!cancelled) considerLegacyCandidate(hasRestoredProject);

        try {
          // Sweep media belonging to no stored project. The referenced set must
          // span *every* project, not just the restored one — otherwise opening
          // project A would delete project B's footage.
          const all = await listProjects();
          const referenced = new Set<string>();
          for (const entry of all) {
            for (const key of referencedBlobKeys(entry.document)) referenced.add(key);
          }

          await collectGarbage(store(), referenced);
        } catch {
          // Sweeping is best effort; orphaned blobs cost disk, not correctness.
        }
      } finally {
        // Autosave stays blocked until here, so the starter document can never
        // overwrite the project being restored — or land in the slot the legacy
        // offer is about to fill.
        restoredRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount-only: restoring again on a later render would discard live edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Debounced autosave ----------------------------------------------
  // Nothing is written while `restoredRef` is false. That covers the startup
  // window in both directions: the starter document cannot land before the
  // stored project is read, and the legacy candidate — which lives in
  // `localStorage` and is read, never written, here — is untouched until the
  // user decides.
  useEffect(() => {
    if (!restoredRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(project), AUTOSAVE_DELAY_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [project, persist]);

  // --- Save on the way out ---------------------------------------------
  useEffect(() => {
    const handleBeforeUnload = () => {
      // A pending debounce would be lost when the tab closes, so the latest
      // state is flushed synchronously-ish here. Best effort: browsers do not
      // guarantee async work during unload, and there is no UI left to report a
      // failure to — but an unhandled rejection here would be pure noise.
      void saveProject(useEditorStore.getState().project).catch(() => {});
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const saveNow = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await persist(useEditorStore.getState().project);
  }, [persist]);

  /**
   * Document-only JSON export.
   *
   * Kept because it is the inspectable, diffable, hand-editable form of the
   * project, and because a v1-era user already has these files. It is *not*
   * labelled a backup anywhere in the UI: the media it references stays in this
   * browser, so the notice after the download says exactly that.
   */
  const downloadProject = useCallback(() => {
    const current = useEditorStore.getState().project;
    const blob = new Blob([serializeProject(current)], { type: "application/json" });
    const fileName = projectFileName(current.name);

    downloadBlob(blob, fileName);
    setArchiveNotice({
      tone: "success",
      title: `Downloaded ${fileName} — document only, media not included.`,
      details: [
        "This project's media stays in this browser. To move the project and its media together, use Share (.desktopstage).",
      ],
    });
  }, []);

  /**
   * Portable export: the document, its manifest, and every original media blob.
   *
   * `exportProjectArchive` reads every referenced blob before writing anything,
   * so an export that cannot be complete fails with the list of what is missing
   * instead of producing a half-archive that would import with silent gaps.
   */
  const downloadArchive = useCallback(async () => {
    if (archiveBusyRef.current) return;

    const current = useEditorStore.getState().project;
    beginArchive("exporting");

    try {
      const { blob, manifest } = await exportProjectArchive(current, {
        store: store(),
        appVersion: APP_VERSION,
        onProgress: setArchiveProgress,
      });

      downloadBlob(blob, archiveFileName(current.name));
      setLastArchiveBytes(blob.size);

      const bundled = manifest.assets.filter((asset) => asset.bundled).length;
      const warning = unbundledAssetNotice(manifest);

      setArchiveNotice({
        tone: "success",
        title: `Shared "${manifest.projectName || current.name}" — ${bundled} media ${
          bundled === 1 ? "file" : "files"
        }, ${formatByteSize(blob.size)}.`,
        details: warning ? [warning] : [],
      });
    } catch (error) {
      setArchiveNotice(describeArchiveFailure(error, "export"));
    } finally {
      endArchive();
    }
  }, [beginArchive, endArchive, store]);

  /**
   * Archive import.
   *
   * The whole point of the ordering here is that `replaceProject` is the last
   * statement before the success notice: `importProjectArchive` validates the
   * archive, remaps the document, and stages every media blob under fresh keys
   * first, deleting whatever it staged if anything fails. A corrupt archive, a
   * missing asset, or a full disk therefore leaves the open project, and every
   * media key it references, exactly as they were.
   */
  const importArchiveFile = useCallback(
    async (file: File) => {
      beginArchive("importing");

      try {
        const result = await importProjectArchive(file, {
          store: store(),
          onProgress: setArchiveProgress,
        });

        replaceProject(result.project);

        const bundled = result.stagedMedia.length;
        const warning = unbundledAssetNotice(result.manifest);
        setLoadIssues([
          ...result.migrations.map((entry) => `Migrated: ${entry}`),
          ...result.issues.map((issue) => issue.message),
          ...(warning ? [warning] : []),
        ]);

        setLastArchiveBytes(file.size);
        setArchiveNotice({
          tone: "success",
          title: `Opened "${result.project.name}" from ${file.name} — ${bundled} media ${
            bundled === 1 ? "file" : "files"
          } restored, ${formatByteSize(file.size)}.`,
          details: [],
        });
      } catch (error) {
        setArchiveNotice(describeArchiveFailure(error, "import"));
      } finally {
        endArchive();
      }
    },
    [beginArchive, endArchive, replaceProject, store],
  );

  const openProjectFile = useCallback(
    async (file: File) => {
      if (archiveBusyRef.current) return;

      // Which reader gets the file is decided before anything is read in full:
      // a name or type that says "archive" is never retried as JSON, so a
      // corrupt ZIP cannot be "repaired" into a plausible empty project, and a
      // JSON file that begins with the ZIP signature is not fed to the ZIP
      // reader. Only a file whose name and type say nothing is sniffed.
      const kind = classifyProjectFile(
        { name: file.name, type: file.type },
        await readFileHead(file),
      );

      if (kind === "archive") {
        await importArchiveFile(file);
        return;
      }

      if (kind === "unknown") {
        setLoadIssues([UNKNOWN_PROJECT_FILE_MESSAGE]);
        return;
      }

      let text: string;
      try {
        text = await file.text();
      } catch {
        setLoadIssues([`Could not read ${file.name}.`]);
        return;
      }

      // Checked before the current parser, which is deliberately forgiving: a v1
      // document is valid JSON, so it would be "repaired" into a plausible
      // project with the wrong contents instead of being converted. This is also
      // how a v1 JSON gets in from another origin, where the old `localStorage`
      // is unreadable by definition.
      const legacy = inspectLegacyProjectText(text);
      if (legacy.kind === "converted") {
        replaceProject(legacy.project);
        setLoadIssues([]);
        return;
      }
      if (legacy.kind === "invalid") {
        setLoadIssues([legacy.error]);
        return;
      }

      const result = parseProjectFile(text);

      if (!result.ok) {
        setLoadIssues([result.error]);
        return;
      }

      replaceProject(result.project);

      const messages = [
        ...result.migrations.map((entry) => `Migrated: ${entry}`),
        ...result.issues.map((issue) => issue.message),
      ];
      if (result.fromFuture) {
        messages.unshift(
          "This project was saved by a newer version of Desktop Stage; some data may be lost on save.",
        );
      }
      setLoadIssues(messages);
    },
    [importArchiveFile, replaceProject],
  );

  const acceptLegacyImport = useCallback(async () => {
    const legacyProject = legacyProjectRef.current;
    if (!legacyProject) {
      setLegacyStatus("idle");
      return;
    }

    setLegacyStatus("importing");
    setLegacyError(null);

    try {
      if (!isStorageAvailable()) {
        throw new Error(
          "Local project storage is unavailable, so the converted project cannot be saved.",
        );
      }

      // The order is the promise the offer makes: the converted document is
      // durably stored *before* the offer is recorded as done. A failed write
      // leaves the offer standing, so the user can retry or decline rather than
      // being told their old project is safe when it is not.
      await saveProject(legacyProject);

      replaceProject(legacyProject);
      setLastSavedAt(Date.now());
      setSaveState("saved");
    } catch (error) {
      setLegacyError(
        error instanceof Error ? error.message : "The saved project could not be imported.",
      );
      setLegacyStatus("error");
      return;
    }

    // A failure to remember the decision is not a failure to import: the project
    // is already saved and open, and next startup's restore short-circuits the
    // offer anyway.
    recordLegacyImportDecision(browserLegacyStorage(), "imported");
    legacyProjectRef.current = null;
    setLegacyStatus("idle");
  }, [replaceProject]);

  const declineLegacyImport = useCallback(() => {
    // Recorded, not just hidden: otherwise the offer would reappear on every
    // launch and interrupt the editing it is supposed to precede.
    recordLegacyImportDecision(browserLegacyStorage(), "declined");
    legacyProjectRef.current = null;
    setLegacyError(null);
    setLegacyStatus("idle");
  }, []);

  return {
    saveState,
    lastSavedAt,
    loadIssues,
    dismissIssues: () => setLoadIssues([]),
    saveNow,
    downloadProject,
    downloadArchive,
    openProjectFile,
    archive: {
      phase: archivePhase,
      progress: archiveProgress,
      notice: archiveNotice,
      dismissNotice: () => setArchiveNotice(null),
      lastArchiveBytes,
      isBusy: archivePhase !== "idle",
    },
    legacyImport: {
      status: legacyStatus,
      error: legacyError,
      accept: acceptLegacyImport,
      decline: declineLegacyImport,
    },
  };
}
