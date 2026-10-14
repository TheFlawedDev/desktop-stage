"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collectGarbage } from "@cutaway/media-engine";
import {
  parseProjectFile,
  referencedBlobKeys,
  serializeProject,
  projectFileName,
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

/**
 * Autosave, restore, and file import/export.
 *
 * Saving is debounced rather than immediate: dragging a clip fires a store
 * update on every pointer move, and writing the document to IndexedDB sixty
 * times a second would stall the drag. A short idle delay batches a gesture
 * into one write.
 */

/** Idle time before an autosave fires. */
const AUTOSAVE_DELAY_MS = 800;

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

export interface ProjectPersistence {
  saveState: SaveState;
  lastSavedAt: number | null;
  /** Issues reported by the last load, e.g. clips dropped during repair. */
  loadIssues: string[];
  dismissIssues: () => void;
  saveNow: () => Promise<void>;
  downloadProject: () => void;
  openProjectFile: (file: File) => Promise<void>;
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

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Blocks autosave until the restore attempt has finished. */
  const restoredRef = useRef(false);
  /** The converted legacy document, held from discovery until the user decides. */
  const legacyProjectRef = useRef<ProjectDocument | null>(null);

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

  const downloadProject = useCallback(() => {
    const current = useEditorStore.getState().project;
    const blob = new Blob([serializeProject(current)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = projectFileName(current.name);
    anchor.click();

    URL.revokeObjectURL(url);
  }, []);

  const openProjectFile = useCallback(
    async (file: File) => {
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
    [replaceProject],
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
    openProjectFile,
    legacyImport: {
      status: legacyStatus,
      error: legacyError,
      accept: acceptLegacyImport,
      decline: declineLegacyImport,
    },
  };
}
