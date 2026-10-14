"use client";

/**
 * The pure half of project-file opening and sharing.
 *
 * Three questions the UI must answer before it touches storage or the open
 * document, answered here as plain functions so they can be tested without a
 * browser:
 *
 * 1. **What kind of file is this?** A `.desktopstage` archive, project JSON, or
 *    something unrelated. Getting this wrong is not cosmetic: a ZIP read as text
 *    produces mojibake that the forgiving JSON parser might repair into an empty
 *    project, silently discarding the one that is open.
 * 2. **How should a failure read?** `ArchiveError` codes are precise but terse;
 *    the banner needs a sentence a person can act on, plus the specifics.
 * 3. **How big, and how far along?** Archive sizes and packing progress, phrased
 *    for display.
 *
 * Nothing here reads storage, touches the editor store, or creates object URLs.
 */

import {
  ArchiveError,
  type ArchiveManifest,
  type ArchiveProgress,
} from "@cutaway/project-io";

/** What a file offered to the project-open control turned out to be. */
export type ProjectFileKind = "archive" | "json" | "unknown";

/** The `.desktopstage` extension is the portable format; `.zip` is a rename. */
const ARCHIVE_EXTENSIONS = [".desktopstage", ".zip"] as const;

/** `.cutaway` is the current JSON envelope; `.json` covers v1 and hand edits. */
const JSON_EXTENSIONS = [".cutaway", ".json"] as const;

/**
 * MIME types an operating system may report for each kind.
 *
 * Deliberately short. `application/octet-stream` is the "I have no idea" answer
 * both Windows and macOS give for an extension they do not know, so it is *not*
 * treated as an archive hint — the extension or the bytes decide instead.
 */
const ARCHIVE_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

const JSON_MIME_TYPES = new Set(["application/json", "text/json"]);

/**
 * A bytes-level ZIP signature, checked for the three signatures a ZIP can start
 * with: a local file header, an empty-archive end-of-central-directory record,
 * and a spanned-archive marker.
 *
 * This exists for the extension-less case (a file dragged from a mail client or
 * an unhelpful download folder), never to override a name that already said
 * what the file is.
 */
const ZIP_SIGNATURES: readonly (readonly number[])[] = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

/** What the open control's file picker should allow. */
export const PROJECT_FILE_ACCEPT =
  ".desktopstage,.cutaway,.json,.zip,application/json,application/zip,application/x-zip-compressed";

/** Shown when a file is neither a recognizable archive nor recognizable JSON. */
export const UNKNOWN_PROJECT_FILE_MESSAGE =
  "Unrecognized project file. Desktop Stage opens .desktopstage archives, .cutaway project files, and version 1 JSON exports.";

/** Lowercased extension including the dot, or an empty string. */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  // A leading dot is a hidden file, not an extension (".json" alone is a name).
  if (dot <= 0) return "";
  return name.slice(dot).toLowerCase();
}

/** What the file's name and reported MIME type alone say. */
function classifyByMetadata(file: { name: string; type: string }): ProjectFileKind {
  const extension = extensionOf(file.name);
  if ((ARCHIVE_EXTENSIONS as readonly string[]).includes(extension)) return "archive";
  if ((JSON_EXTENSIONS as readonly string[]).includes(extension)) return "json";

  const mime = file.type.trim().toLowerCase();
  if (ARCHIVE_MIME_TYPES.has(mime)) return "archive";
  if (JSON_MIME_TYPES.has(mime)) return "json";

  return "unknown";
}

/**
 * Classifies a file's leading bytes.
 *
 * A ZIP signature wins over everything; otherwise the first meaningful
 * character decides between JSON (an object or array) and "no idea". Only a
 * few hundred bytes are needed — this reads a head, never the whole file.
 */
export function sniffProjectFileKind(
  bytes: Uint8Array | ArrayBuffer | null | undefined,
): ProjectFileKind {
  if (!bytes) return "unknown";

  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length === 0) return "unknown";

  for (const signature of ZIP_SIGNATURES) {
    if (view.length >= signature.length && signature.every((byte, index) => view[index] === byte)) {
      return "archive";
    }
  }

  return firstJsonCharacter(view) === null ? "unknown" : "json";
}

/** The first non-whitespace character, skipping a UTF-8 byte-order mark. */
function firstJsonCharacter(view: Uint8Array): number | null {
  let index = 0;

  if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    index = 3;
  }

  for (; index < view.length; index += 1) {
    const byte = view[index] as number;
    const isWhitespace = byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (isWhitespace) continue;

    return byte === 0x7b || byte === 0x5b ? byte : null;
  }

  return null;
}

/**
 * The dispatch decision for the project-open control.
 *
 * Name and MIME type take precedence over the bytes, on purpose. A file called
 * `scene.desktopstage` whose contents are corrupt — truncated, encrypted,
 * actually JSON — must reach the archive reader and be reported as a broken
 * archive. Falling back to the JSON parser would either resurrect a stale
 * document or replace the open project with nonsense. The reverse holds too: a
 * `.json` file that happens to start with `PK` is still read as JSON, and says
 * so plainly, rather than being fed to the ZIP reader.
 *
 * Sniffing only fills the gap where the metadata genuinely says nothing.
 */
export function classifyProjectFile(
  file: { name: string; type: string },
  head?: Uint8Array | ArrayBuffer | null,
): ProjectFileKind {
  const byMetadata = classifyByMetadata(file);
  if (byMetadata !== "unknown") return byMetadata;

  return sniffProjectFileKind(head);
}

/** Which half of the archive flow a notice is about. */
export type ArchiveAction = "export" | "import";

export interface ArchiveNotice {
  tone: "success" | "error";
  /** One sentence: what happened, or what went wrong. */
  title: string;
  /** Specifics and next steps. May be empty. */
  details: string[];
}

function archiveErrorTitle(code: ArchiveError["code"], action: ArchiveAction): string {
  switch (code) {
    case "missing-media":
      return action === "export"
        ? "Cannot build the archive: some media in this project is missing from this browser."
        : "The archive is missing media it says it contains.";
    case "invalid-archive":
      return "That file is not a readable Desktop Stage archive (.desktopstage ZIP).";
    case "unsupported-version":
      return "That archive was written by a newer version of Desktop Stage.";
    case "invalid-project":
      return "The project inside the archive could not be read.";
    case "storage-failure":
      return "The imported media could not be stored — this browser's storage may be full.";
  }
}

/** Whether an error is the browser refusing a write because storage is full. */
function isQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && /quota/i.test(name);
}

/**
 * Turns any archive failure into a banner a person can act on.
 *
 * The contract the archive core promises — an import that fails changes nothing
 * — is restated on every import failure, because "did it break my project?" is
 * the first question a failed import raises and the answer is always no.
 */
export function describeArchiveFailure(error: unknown, action: ArchiveAction): ArchiveNotice {
  const notice = describeArchiveFailureCause(error, action);
  if (action === "import") {
    notice.details.push("Your open project was left unchanged.");
  }
  return notice;
}

function describeArchiveFailureCause(error: unknown, action: ArchiveAction): ArchiveNotice {
  if (error instanceof ArchiveError) {
    return {
      tone: "error",
      title: archiveErrorTitle(error.code, action),
      details: [...error.details],
    };
  }

  if (isQuotaError(error)) {
    return {
      tone: "error",
      title: "The browser ran out of storage while saving the imported media.",
      details: ["Free space for this site (or remove unused media) and try again."],
    };
  }

  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error.trim() : "";

  return {
    tone: "error",
    title:
      action === "export"
        ? "The project could not be packed into an archive."
        : "The project file could not be opened.",
    details: message ? [message] : [],
  };
}

/** Human-readable byte size. Binary units, because that is what storage reports. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ["kB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * Packing progress, phrased for the banner.
 *
 * `label` is the entry being written: `manifest.json`, `project.json`, or an
 * asset name on export, and a media id on import.
 */
export function archiveProgressText(
  progress: ArchiveProgress | null,
  action: ArchiveAction,
): string {
  const verb = action === "export" ? "Packing" : "Unpacking";
  if (!progress || progress.total <= 0) return `${verb}…`;

  const label = progress.label ? ` · ${progress.label}` : "";
  return `${verb} ${progress.completed} of ${progress.total}${label}`;
}

/**
 * A warning for media the archive could not carry.
 *
 * A project may reference a remote URL or a file handle rather than stored
 * bytes; those are recorded in the manifest as unbundled. Saying so at import
 * time is the difference between "the archive moved everything" and a scene
 * that reopens with silent gaps.
 */
export function unbundledAssetNotice(manifest: ArchiveManifest): string | null {
  const unbundled = manifest.assets.filter((asset) => !asset.bundled);
  if (unbundled.length === 0) return null;

  return unbundled.length === 1
    ? "1 media file is a link rather than stored bytes, so it was not included in the archive."
    : `${unbundled.length} media files are links rather than stored bytes, so they were not included in the archive.`;
}
