/**
 * The portable `.desktopstage` project archive.
 *
 * The JSON project format stores *references* to media bytes in the browser's
 * IndexedDB, which means a JSON download cannot move a media-rich project to
 * another computer: the file travels, the footage does not. The archive closes
 * that gap. It is a plain ZIP containing:
 *
 * ```
 * manifest.json          what is in the archive, and the format version
 * project.json           the project document (same parser as the JSON file)
 * assets/<media-id>      the original bytes of every bundled media asset
 * ```
 *
 * ZIP rather than a bespoke container: it streams, it is inspectable with tools
 * every operating system already has, and a creator can recover their footage
 * from it by hand if this editor is ever unavailable to them.
 *
 * ## Non-destructive by construction
 *
 * Import validates the archive and reads every referenced blob *before* it
 * writes anything to storage, stages media under fresh keys, and only then hands
 * back a remapped document. A failure at any point deletes whatever was staged
 * and leaves the caller's current project untouched — the caller swaps the
 * document in, and does so last.
 */

import type { MediaAsset, ProjectDocument } from "@cutaway/types";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  ZipReader,
  ZipWriter,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js";
import { migrateDocument } from "./migrate";
import { setOwn } from "./own";
import { parseProjectFile } from "./serialize";
import { validateProject, type ValidationIssue } from "./validate";

export const ARCHIVE_FILE_EXTENSION = "desktopstage";
export const ARCHIVE_FILE_MIME = "application/zip";
export const ARCHIVE_FORMAT = "desktop-stage/project";
export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_MANIFEST_NAME = "manifest.json";
export const ARCHIVE_PROJECT_NAME = "project.json";
export const ARCHIVE_ASSET_DIRECTORY = "assets";

/**
 * The slice of a blob store the archive needs.
 *
 * Declared structurally rather than imported from `@cutaway/media-engine` so this
 * package stays a pure document library: the IndexedDB store satisfies it, and
 * so does the in-memory store the tests use.
 */
export interface ArchiveBlobStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
}

export type ArchiveErrorCode =
  | "missing-media"
  | "invalid-archive"
  | "unsupported-version"
  | "invalid-project"
  | "storage-failure";

export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode;
  /** Human-readable specifics: which files are missing, what was malformed. */
  readonly details: string[];

  constructor(code: ArchiveErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
    this.details = details;
  }
}

export interface ArchiveAssetEntry {
  mediaId: string;
  name: string;
  mimeType: string;
  /** Path inside the archive, or null when the bytes are not bundled. */
  archivePath: string | null;
  /** True when the archive carries the original bytes. */
  bundled: boolean;
  byteSize: number;
}

export interface ArchiveManifest {
  format: string;
  formatVersion: number;
  savedAt: number;
  app: string;
  appVersion: string;
  projectId: string;
  projectName: string;
  assets: ArchiveAssetEntry[];
}

export interface ArchiveProgress {
  completed: number;
  total: number;
  label: string;
}

export interface ArchiveExportOptions {
  store: ArchiveBlobStore;
  appVersion?: string;
  /** Overrides the manifest timestamp; tests pass a fixed value. */
  savedAt?: number;
  onProgress?: (progress: ArchiveProgress) => void;
}

export interface ArchiveExportResult {
  blob: Blob;
  manifest: ArchiveManifest;
}

/**
 * Practical ceilings on what a single archive may unpack.
 *
 * An archive is attacker-controlled input, and a small file can describe a
 * very large one. These bound one asset and the whole set. The defaults are
 * sized for what a browser tab can actually hold: import reads *every* asset
 * before the first write, so peak memory is the sum, not one asset, and the
 * aggregate ceiling is the number that matters. 512 MiB for one asset and
 * 2 GiB in total leave ordinary media-rich projects room — a single 4 GB source
 * clip and a 16 GB project are both beyond a browser blob store to begin with —
 * while staying far below what a decompression bomb asks for. Every number is
 * read from the ZIP central directory, so enforcing them never inflates a byte;
 * note that they bound *declared output*, not the memory the decode retains.
 *
 * A caller that genuinely needs more can raise either through
 * `ArchiveImportOptions.limits`.
 */
export interface ArchiveLimits {
  /** Largest single asset, after decompression, in bytes. Default 512 MiB. */
  maxAssetBytes: number;
  /** Largest total of every bundled asset, after decompression. Default 2 GiB. */
  maxTotalBytes: number;
  /** Largest uncompressed:compressed ratio tolerated. Default 200:1. */
  maxCompressionRatio: number;
  /**
   * Largest manifest.json or project.json, after decompression. Default 64 MiB.
   *
   * These are read before the asset gate, so they need a ceiling of their own:
   * a project document with millions of clips is already unusable, and no
   * legitimate one is 64 MiB of JSON.
   */
  maxMetadataBytes: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxAssetBytes: 512 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxMetadataBytes: 64 * 1024 * 1024,
};

/**
 * Ratio checks only apply at or above this size.
 *
 * Below it a few highly compressible bytes are just a small file — a short
 * caption asset, a tiny one-colour image — and the ratio says nothing. A real
 * bomb has to be large to threaten memory, so the floor costs no protection.
 */
export const ARCHIVE_COMPRESSION_RATIO_FLOOR_BYTES = 1024 * 1024;

export interface ArchiveImportOptions {
  store: ArchiveBlobStore;
  /**
   * Fresh storage key for an imported media asset.
   *
   * Defaults to a unique `imported/<media-id>/<random>` key. Tests inject a
   * deterministic one.
   */
  keyFor?: (mediaId: string, index: number) => string;
  /** Overrides the resource bounds; tests use tiny values. */
  limits?: Partial<ArchiveLimits>;
  onProgress?: (progress: ArchiveProgress) => void;
}

export interface ArchiveImportResult {
  project: ProjectDocument;
  manifest: ArchiveManifest;
  issues: ValidationIssue[];
  migrations: string[];
  /** Media ids that were staged, with the key they were staged under. */
  stagedMedia: { mediaId: string; key: string }[];
}

/** Media whose bytes live in the blob store and can therefore be bundled. */
function bundledAssets(project: ProjectDocument): MediaAsset[] {
  return Object.values(project.entities.media).filter(
    (asset) => asset.source.type === "indexeddb",
  );
}

function isIndexedDbSource(asset: MediaAsset): asset is MediaAsset & {
  source: { type: "indexeddb"; key: string };
} {
  return asset.source.type === "indexeddb";
}

/** Filesystem-safe archive name for a project. */
export function archiveFileName(projectName: string): string {
  const safe = projectName
    .trim()
    .replace(/[^a-z0-9\-_ ]/gi, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);

  return `${safe || "untitled"}.${ARCHIVE_FILE_EXTENSION}`;
}

/**
 * Encodes one media id as a single archive path segment that is always safe.
 *
 * `encodeURIComponent` is the base because it leaves ordinary ids — letters,
 * digits, and the punctuation it treats as unreserved — unchanged, so most
 * archives written by earlier builds keep exactly the paths they had; the few
 * that contain a "." are still readable, because import trusts the path the
 * manifest records. It is not sufficient on its own: it leaves "." and ".."
 * untouched, so an id of ".." would name the parent of the assets directory.
 * Dots are escaped instead. A lone surrogate is not encodable as UTF-8 at all
 * (`encodeURIComponent` throws), and an empty id has nothing to encode, so both
 * fall back to a UTF-16 hex form behind a "#" prefix. `encodeURIComponent`
 * percent-encodes a literal "#", so the two forms can never collide: every
 * fallback path is unique and none is a parent segment.
 */
function encodeMediaIdSegment(mediaId: string): string {
  try {
    const encoded = encodeURIComponent(mediaId).replace(/\./g, "%2E");
    if (encoded.length > 0) return encoded;
  } catch {
    // A lone surrogate cannot be percent-encoded; use the hex form below.
  }

  let hex = "";
  for (let index = 0; index < mediaId.length; index += 1) {
    hex += mediaId.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0");
  }
  return `#${hex}`;
}

/** Archive path for one media asset. Media ids are opaque, so they are encoded. */
export function archiveAssetPath(mediaId: string): string {
  return `${ARCHIVE_ASSET_DIRECTORY}/${encodeMediaIdSegment(mediaId)}`;
}

/** True when a manifest path names exactly one asset inside the assets directory. */
function isArchiveAssetPath(path: string): boolean {
  if (!path.startsWith(`${ARCHIVE_ASSET_DIRECTORY}/`)) return false;

  const segment = path.slice(ARCHIVE_ASSET_DIRECTORY.length + 1);
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.includes("/") &&
    !segment.includes("\\")
  );
}

/**
 * Writes a project and its media bytes into a `.desktopstage` archive.
 *
 * Every referenced source blob is read before a single byte is written, so an
 * export that is going to fail fails immediately with the list of what is
 * missing rather than producing a half-complete file.
 */
export async function exportProjectArchive(
  project: ProjectDocument,
  options: ArchiveExportOptions,
): Promise<ArchiveExportResult> {
  const assets = bundledAssets(project);
  const collected: { asset: MediaAsset; key: string; blob: Blob }[] = [];
  const missing: string[] = [];

  for (const asset of assets) {
    if (!isIndexedDbSource(asset)) continue;

    const blob = await options.store.get(asset.source.key);
    if (!blob) {
      missing.push(`${asset.name} (missing "${asset.source.key}")`);
      continue;
    }
    collected.push({ asset, key: asset.source.key, blob });
  }

  if (missing.length > 0) {
    throw new ArchiveError(
      "missing-media",
      `Cannot export: ${missing.length} media source${missing.length === 1 ? " is" : "s are"} missing from local storage.`,
      missing,
    );
  }

  // Assets that are not in the blob store (a URL, a filesystem handle, a builtin)
  // are recorded as unbundled, so an import can say exactly what did not travel.
  const externalAssets: ArchiveAssetEntry[] = Object.values(project.entities.media)
    .filter((asset) => asset.source.type !== "indexeddb")
    .map((asset) => ({
      mediaId: asset.id,
      name: asset.name,
      mimeType: asset.mimeType,
      archivePath: null,
      bundled: false,
      byteSize: asset.metadata.byteSize,
    }));

  const manifestAssets: ArchiveAssetEntry[] = collected.map((entry) => ({
    mediaId: entry.asset.id,
    name: entry.asset.name,
    mimeType: entry.asset.mimeType,
    archivePath: archiveAssetPath(entry.asset.id),
    bundled: true,
    byteSize: entry.blob.size,
  }));

  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    savedAt: options.savedAt ?? Date.now(),
    app: "desktop-stage",
    appVersion: options.appVersion ?? "0.0.0",
    projectId: project.id,
    projectName: project.name,
    assets: [...manifestAssets, ...externalAssets],
  };

  const total = collected.length + 2;
  let completed = 0;
  const report = (label: string) => {
    completed += 1;
    options.onProgress?.({ completed, total, label });
  };

  const writer = new ZipWriter(new BlobWriter(ARCHIVE_FILE_MIME));

  try {
    await writer.add(ARCHIVE_MANIFEST_NAME, new TextReader(JSON.stringify(manifest, null, 2)));
    report(ARCHIVE_MANIFEST_NAME);

    await writer.add(ARCHIVE_PROJECT_NAME, new TextReader(JSON.stringify(project, null, 2)));
    report(ARCHIVE_PROJECT_NAME);

    for (const entry of collected) {
      // Media is already compressed; re-compressing it costs time and saves
      // nothing. `level: 0` stores the original bytes verbatim.
      await writer.add(archiveAssetPath(entry.asset.id), new BlobReader(entry.blob), { level: 0 });
      report(entry.asset.name);
    }

    const blob = await writer.close();
    return { blob, manifest };
  } catch (error) {
    await writer.close().catch(() => undefined);
    throw error;
  }
}

/** Entry names an archive may contain. Anything else is rejected, not ignored. */
function validateEntryName(name: string): string | null {
  if (name.length === 0) return "an entry has an empty name";
  if (name.includes("\\")) return `entry "${name}" uses a backslash path separator`;
  if (name.startsWith("/")) return `entry "${name}" is an absolute path`;
  if (name.split("/").some((segment) => segment === "..")) {
    return `entry "${name}" escapes the archive root`;
  }

  if (name === ARCHIVE_MANIFEST_NAME || name === ARCHIVE_PROJECT_NAME) return null;
  if (name.startsWith(`${ARCHIVE_ASSET_DIRECTORY}/`) && name.length > ARCHIVE_ASSET_DIRECTORY.length + 1) {
    return null;
  }

  return `entry "${name}" is not part of a Desktop Stage archive`;
}

/**
 * Validates every `manifest.assets` entry before any of it is used.
 *
 * The manifest is attacker-controlled JSON, so a null, string, or half-written
 * entry must be reported as a broken archive — with the index that is wrong —
 * rather than surfacing later as a `TypeError` from reading `.mediaId` of
 * `null`. Descriptive fields are defaulted; everything the import relies on
 * (identity, bundling, path, size) is required.
 */
function parseManifestAssets(raw: readonly unknown[]): ArchiveAssetEntry[] {
  return raw.map((candidate, index) => {
    const where = `manifest.json assets[${index}]`;

    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new ArchiveError("invalid-archive", `${where} is not an object.`);
    }

    const item = candidate as Record<string, unknown>;

    const mediaId = item.mediaId;
    if (typeof mediaId !== "string" || mediaId.length === 0) {
      throw new ArchiveError("invalid-archive", `${where} has no readable media id.`);
    }

    const bundled = item.bundled;
    if (typeof bundled !== "boolean") {
      throw new ArchiveError("invalid-archive", `${where} ("${mediaId}") has no bundled flag.`);
    }

    const archivePath = item.archivePath;
    if (archivePath !== null && typeof archivePath !== "string") {
      throw new ArchiveError(
        "invalid-archive",
        `${where} ("${mediaId}") has an unreadable archive path.`,
      );
    }
    if (bundled && typeof archivePath !== "string") {
      throw new ArchiveError(
        "invalid-archive",
        `${where} ("${mediaId}") is bundled but names no archive path.`,
      );
    }
    if (typeof archivePath === "string" && !isArchiveAssetPath(archivePath)) {
      throw new ArchiveError(
        "invalid-archive",
        `${where} ("${mediaId}") points outside the assets directory: "${archivePath}".`,
      );
    }

    const byteSize = item.byteSize;
    if (typeof byteSize !== "number" || !Number.isFinite(byteSize) || byteSize < 0) {
      throw new ArchiveError("invalid-archive", `${where} ("${mediaId}") has no readable byte size.`);
    }

    return {
      mediaId,
      name: typeof item.name === "string" ? item.name : mediaId,
      mimeType: typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream",
      archivePath: typeof archivePath === "string" ? archivePath : null,
      bundled,
      byteSize,
    };
  });
}

function parseManifest(text: string): ArchiveManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ArchiveError("invalid-archive", "manifest.json is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ArchiveError("invalid-archive", "manifest.json is not an object.");
  }

  const manifest = parsed as Partial<ArchiveManifest>;

  if (manifest.format !== ARCHIVE_FORMAT) {
    throw new ArchiveError(
      "invalid-archive",
      "This file is not a Desktop Stage project archive.",
    );
  }

  const version = manifest.formatVersion;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    throw new ArchiveError("invalid-archive", "manifest.json has no readable format version.");
  }

  if (version > ARCHIVE_FORMAT_VERSION) {
    throw new ArchiveError(
      "unsupported-version",
      `This archive was written by a newer version of Desktop Stage (format ${version}; this build reads ${ARCHIVE_FORMAT_VERSION}).`,
    );
  }

  if (!Array.isArray(manifest.assets)) {
    throw new ArchiveError("invalid-archive", "manifest.json lists no assets.");
  }

  return {
    format: manifest.format,
    formatVersion: version,
    savedAt: typeof manifest.savedAt === "number" ? manifest.savedAt : 0,
    app: typeof manifest.app === "string" ? manifest.app : "desktop-stage",
    appVersion: typeof manifest.appVersion === "string" ? manifest.appVersion : "0.0.0",
    projectId: typeof manifest.projectId === "string" ? manifest.projectId : "",
    projectName: typeof manifest.projectName === "string" ? manifest.projectName : "",
    assets: parseManifestAssets(manifest.assets),
  };
}

function uniqueImportedKey(mediaId: string, index: number): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  return `imported/${index}-${mediaId}/${random}`;
}

/**
 * Reads an archive's central directory.
 *
 * A truncated, encrypted, or simply unrelated file is not a zip at all; that is
 * reported as an `ArchiveError` so a caller only has to handle one error type.
 */
async function readArchiveEntries(reader: ZipReader<Blob>): Promise<Entry[]> {
  try {
    return await reader.getEntries();
  } catch (error) {
    throw new ArchiveError("invalid-archive", "The file is not a readable ZIP archive.", [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

/** One media asset resolved to the ZIP entry that will be unpacked for it. */
interface PlannedAssetRead {
  asset: MediaAsset;
  entry: FileEntry;
  /** The manifest entry that listed this asset, already validated. */
  listed: ArchiveAssetEntry;
}

function resolveLimits(overrides: Partial<ArchiveLimits> | undefined): ArchiveLimits {
  return { ...DEFAULT_ARCHIVE_LIMITS, ...overrides };
}

/**
 * Rejects manifest.json or project.json before it is inflated.
 *
 * Both are read before the asset gate below, so their own declared size has to
 * be bounded too; otherwise a bomb could simply move into the project document.
 */
function assertMetadataEntryWithinBounds(entry: FileEntry, limits: ArchiveLimits): void {
  const size = entry.uncompressedSize;
  if (size > limits.maxMetadataBytes) {
    throw new ArchiveError(
      "invalid-archive",
      `${entry.filename} unpacks to ${size} bytes, above the ${limits.maxMetadataBytes}-byte metadata limit.`,
    );
  }
}

/**
 * Rejects an archive whose declared media is inconsistent or abusive, before a
 * single asset is inflated.
 *
 * Every number comes from the ZIP central directory: the manifest's declared
 * byte size and the entry's stored uncompressed/compressed sizes. That means a
 * bomb is refused for what it *says* it will produce, with no decompression and
 * without loading assets into memory just to measure them. Three checks run:
 *
 * - the manifest's `byteSize` must match the entry's declared uncompressed size,
 *   so a harmless-looking small claim cannot hide a large payload;
 * - a single entry and the set together must stay under the configured ceilings;
 * - an entry may not be compressed beyond a practical ratio (above the floor
 *   where a ratio is meaningful), which is what a bomb engineered to sit under
 *   an absolute ceiling would look like.
 *
 * A header that under-reports its own output is caught too, because zip.js
 * refuses to return more bytes than the entry declares.
 */
function assertArchiveAssetSizes(
  plans: readonly PlannedAssetRead[],
  limits: ArchiveLimits,
): void {
  const details: string[] = [];
  let totalBytes = 0;

  for (const plan of plans) {
    const { entry } = plan;
    const label = `${plan.asset.name} (${entry.filename})`;
    const size = entry.uncompressedSize;

    if (plan.listed.byteSize !== size) {
      details.push(
        `${label} is listed as ${plan.listed.byteSize} bytes but declares ${size} uncompressed bytes`,
      );
      continue;
    }

    if (size > limits.maxAssetBytes) {
      details.push(
        `${label} unpacks to ${size} bytes, above the ${limits.maxAssetBytes}-byte per-asset limit`,
      );
      continue;
    }

    const compressed = entry.compressedSize;
    if (size > 0 && compressed === 0) {
      details.push(`${label} declares 0 compressed bytes for ${size} uncompressed bytes`);
      continue;
    }

    if (
      size >= ARCHIVE_COMPRESSION_RATIO_FLOOR_BYTES &&
      compressed > 0 &&
      size / compressed > limits.maxCompressionRatio
    ) {
      details.push(
        `${label} is compressed ${Math.round(size / compressed)}:1, above the ${limits.maxCompressionRatio}:1 limit`,
      );
      continue;
    }

    totalBytes += size;
  }

  if (totalBytes > limits.maxTotalBytes) {
    details.push(
      `the archive's media unpacks to ${totalBytes} bytes in total, above the ${limits.maxTotalBytes}-byte limit`,
    );
  }

  if (details.length > 0) {
    throw new ArchiveError("invalid-archive", "The archive's media failed its size checks.", details);
  }
}

/**
 * Combines the issues raised while reading the archived project with any raised
 * while re-validating the remapped document, keeping the first of each.
 *
 * The first pass is the authoritative one for content the file could not carry:
 * a Desktop Stage clip whose payload version this build does not know is dropped
 * there. Re-validating a document that was already repaired rarely adds
 * anything, so the first pass must not be discarded.
 */
function mergeIssues(
  first: readonly ValidationIssue[],
  second: readonly ValidationIssue[],
): ValidationIssue[] {
  const merged: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const issue of [...first, ...second]) {
    const key = `${issue.severity}\u0000${issue.subject}\u0000${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(issue);
  }

  return merged;
}

/** The media id a manifest path claims, or null when it does not match one. */
function mediaIdForArchivePath(path: string): string | null {
  if (!isArchiveAssetPath(path)) return null;

  const segment = path.slice(ARCHIVE_ASSET_DIRECTORY.length + 1);
  try {
    return decodeURIComponent(segment);
  } catch {
    // Not a percent-encoding; no id could have produced it.
    return null;
  }
}

/**
 * Reads a `.desktopstage` archive and stages its media.
 *
 * Returns a document whose media sources point at the newly staged keys. The
 * caller applies it — this function never touches the open project, so a failed
 * import cannot damage it.
 */
export async function importProjectArchive(
  archive: Blob,
  options: ArchiveImportOptions,
): Promise<ArchiveImportResult> {
  // `filenameValidation: "tolerant"` keeps zip.js from rejecting an unusual name
  // before this module can: `validateEntryName` below is the authority on what a
  // Desktop Stage archive may contain, and it reports exactly what was wrong. A
  // name is only ever used as a map key, never as a filesystem path, so being
  // permissive here is not a traversal risk.
  const reader = new ZipReader(new BlobReader(archive), { filenameValidation: "tolerant" });
  const staged: { mediaId: string; key: string }[] = [];
  const limits = resolveLimits(options.limits);

  try {
    const entries = await readArchiveEntries(reader);

    // Only file entries carry data. Directories are dropped here so that every
    // later `getData` call is provably on a file, not on the `Entry` union.
    const byName = new Map<string, FileEntry>();

    for (const entry of entries) {
      if (entry.directory) continue;

      const problem = validateEntryName(entry.filename);
      if (problem) throw new ArchiveError("invalid-archive", problem);

      if (byName.has(entry.filename)) {
        throw new ArchiveError("invalid-archive", `entry "${entry.filename}" appears twice`);
      }
      byName.set(entry.filename, entry);
    }

    const manifestEntry = byName.get(ARCHIVE_MANIFEST_NAME);
    if (!manifestEntry) {
      throw new ArchiveError("invalid-archive", "The archive has no manifest.json.");
    }

    assertMetadataEntryWithinBounds(manifestEntry, limits);
    const manifestText = await (
      await manifestEntry.getData(new BlobWriter("application/json"))
    ).text();
    const manifest = parseManifest(manifestText);

    const projectEntry = byName.get(ARCHIVE_PROJECT_NAME);
    if (!projectEntry) {
      throw new ArchiveError("invalid-archive", "The archive has no project.json.");
    }

    assertMetadataEntryWithinBounds(projectEntry, limits);
    const projectText = await (await projectEntry.getData(new BlobWriter("application/json"))).text();
    const parsed = parseProjectFile(projectText);
    if (!parsed.ok) {
      throw new ArchiveError("invalid-project", `The archived project could not be read: ${parsed.error}`);
    }

    const manifestById = new Map<string, ArchiveAssetEntry>(
      manifest.assets.map((asset) => [asset.mediaId, asset]),
    );
    const media = { ...parsed.project.entities.media };
    const problems: string[] = [];
    const plans: PlannedAssetRead[] = [];

    // Resolve every referenced blob before writing anything. An archive missing
    // one of its own assets fails here, with the project still untouched.
    for (const asset of Object.values(media)) {
      if (!isIndexedDbSource(asset)) continue;

      const listed = manifestById.get(asset.id);
      if (!listed || listed.archivePath === null) {
        problems.push(`${asset.name} is not listed in manifest.json`);
        continue;
      }

      // The bytes a project sees must be the bytes its manifest named for that
      // asset id. Accepting a path that names a different asset — or falling
      // back to the canonical path when the recorded one is stale — would
      // silently substitute one asset's data for another, so a mismatch is
      // reported instead: either the entry the manifest points at, or nothing.
      //
      // Compatibility: the path must be the entry this build writes for the id
      // (`archiveAssetPath`), or the equivalent path an older build wrote, which
      // is the same segment with `.` left literal. Older exports are compared by
      // id rather than by exact string so they keep importing; an id that cannot
      // survive the round trip is not one they could have written.
      const canonicalPath = archiveAssetPath(asset.id);
      const legacyEquivalent =
        listed.archivePath !== canonicalPath &&
        mediaIdForArchivePath(listed.archivePath) === asset.id;
      if (listed.archivePath !== canonicalPath && !legacyEquivalent) {
        problems.push(
          `${asset.name} is listed as ${listed.archivePath}, which is not the entry for its own id ${asset.id} (${canonicalPath})`,
        );
        continue;
      }

      const entry = byName.get(listed.archivePath);
      if (!entry) {
        problems.push(`${asset.name} is listed as ${listed.archivePath} but that entry is missing`);
        continue;
      }

      plans.push({ asset, entry, listed });
    }

    if (problems.length > 0) {
      throw new ArchiveError(
        "invalid-archive",
        `The archive has ${problems.length} unusable media source${problems.length === 1 ? "" : "s"}.`,
        problems,
      );
    }

    // Sizes are checked from the central directory first: an archive that lies
    // about how much its media unpacks to is rejected before it can inflate
    // anything into memory.
    assertArchiveAssetSizes(plans, limits);

    // Only now are the bytes inflated. Everything above used the central
    // directory alone, so an archive that was going to be rejected never had a
    // single asset unpacked into memory. Every asset is still read before the
    // first write, which is what makes a storage failure roll back cleanly.
    const plannedStaging: { mediaId: string; key: string; blob: Blob }[] = [];

    for (const plan of plans) {
      const blob = await plan.entry.getData(
        new BlobWriter(plan.asset.mimeType || "application/octet-stream"),
      );

      // zip.js refuses to return more than the declared size; a blob smaller
      // than the header claims is the other half of the same guarantee.
      if (blob.size !== plan.entry.uncompressedSize) {
        throw new ArchiveError(
          "invalid-archive",
          "An archive entry did not unpack to the size its header declares.",
          [
            `${plan.asset.name} (${plan.entry.filename}) unpacked to ${blob.size} bytes, not ${plan.entry.uncompressedSize}`,
          ],
        );
      }

      plannedStaging.push({
        mediaId: plan.asset.id,
        key: (options.keyFor ?? uniqueImportedKey)(plan.asset.id, plannedStaging.length),
        blob,
      });
    }

    const total = plannedStaging.length;
    let completed = 0;

    for (const plan of plannedStaging) {
      try {
        await options.store.put(plan.key, plan.blob);
      } catch (error) {
        throw new ArchiveError(
          "storage-failure",
          "Could not store the imported media. The browser's storage may be full.",
          [error instanceof Error ? error.message : String(error)],
        );
      }

      staged.push({ mediaId: plan.mediaId, key: plan.key });
      completed += 1;
      options.onProgress?.({ completed, total, label: plan.mediaId });
    }

    const remapped: Record<string, MediaAsset> = {};
    for (const [id, asset] of Object.entries(media)) {
      const plan = plannedStaging.find((candidate) => candidate.mediaId === id);
      if (!plan) {
        // Media ids survive validation as own keys, so this write must be an
        // own-key write too: `remapped["__proto__"] = asset` would make the
        // asset the map's prototype and drop it from the project on the next
        // save. See `own.ts`.
        setOwn(remapped, id, asset);
        continue;
      }

      setOwn(remapped, id, {
        ...asset,
        source: { type: "indexeddb", key: plan.key },
        metadata: { ...asset.metadata, byteSize: plan.blob.size },
        // Thumbnails and waveforms are caches; they are rebuilt from the source
        // bytes rather than shipped, which keeps archives smaller.
        thumbnailKey: null,
        waveformKey: null,
      });
    }

    const migrated = migrateDocument({ ...parsed.project, entities: { ...parsed.project.entities, media: remapped } });
    const { project, issues: revalidatedIssues } = validateProject(migrated.document);

    return {
      project,
      manifest,
      // What the archived project lost while being read must survive into the
      // result: `validateProject` here sees a document that is already repaired,
      // so the dropped Desktop Stage clips only appear in the first pass.
      issues: mergeIssues(parsed.issues, revalidatedIssues),
      migrations: [...parsed.migrations, ...migrated.applied],
      stagedMedia: staged,
    };
  } catch (error) {
    // Nothing staged survives a failure: a partial import would leave orphaned
    // blobs behind and a project that half-exists.
    for (const entry of staged) {
      await options.store.delete(entry.key).catch(() => undefined);
    }
    throw error;
  } finally {
    await reader.close().catch(() => undefined);
  }
}
