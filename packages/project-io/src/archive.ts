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

export interface ArchiveImportOptions {
  store: ArchiveBlobStore;
  /**
   * Fresh storage key for an imported media asset.
   *
   * Defaults to a unique `imported/<media-id>/<random>` key. Tests inject a
   * deterministic one.
   */
  keyFor?: (mediaId: string, index: number) => string;
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

/** Archive path for one media asset. Media ids are opaque, so they are encoded. */
export function archiveAssetPath(mediaId: string): string {
  return `${ARCHIVE_ASSET_DIRECTORY}/${encodeURIComponent(mediaId)}`;
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
    assets: manifest.assets,
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

    const manifestText = await (
      await manifestEntry.getData(new BlobWriter("application/json"))
    ).text();
    const manifest = parseManifest(manifestText);

    const projectEntry = byName.get(ARCHIVE_PROJECT_NAME);
    if (!projectEntry) {
      throw new ArchiveError("invalid-archive", "The archive has no project.json.");
    }

    const projectText = await (await projectEntry.getData(new BlobWriter("application/json"))).text();
    const parsed = parseProjectFile(projectText);
    if (!parsed.ok) {
      throw new ArchiveError("invalid-project", `The archived project could not be read: ${parsed.error}`);
    }

    const assetPaths = new Map(manifest.assets.map((asset) => [asset.mediaId, asset.archivePath]));
    const media = { ...parsed.project.entities.media };
    const plannedStaging: { mediaId: string; key: string; blob: Blob }[] = [];
    const problems: string[] = [];

    // Read every referenced blob before writing anything. An archive missing one
    // of its own assets fails here, with the project still untouched.
    for (const asset of Object.values(media)) {
      if (!isIndexedDbSource(asset)) continue;

      const path = assetPaths.get(asset.id);
      if (!path) {
        problems.push(`${asset.name} is not listed in manifest.json`);
        continue;
      }

      const entry = byName.get(path) ?? byName.get(archiveAssetPath(asset.id));
      if (!entry) {
        problems.push(`${asset.name} is listed as ${path} but that entry is missing`);
        continue;
      }

      const blob = await entry.getData(new BlobWriter(asset.mimeType || "application/octet-stream"));
      plannedStaging.push({
        mediaId: asset.id,
        key: (options.keyFor ?? uniqueImportedKey)(asset.id, plannedStaging.length),
        blob,
      });
    }

    if (problems.length > 0) {
      throw new ArchiveError(
        "invalid-archive",
        `The archive is missing ${problems.length} media source${problems.length === 1 ? "" : "s"}.`,
        problems,
      );
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
        remapped[id] = asset;
        continue;
      }

      remapped[id] = {
        ...asset,
        source: { type: "indexeddb", key: plan.key },
        metadata: { ...asset.metadata, byteSize: plan.blob.size },
        // Thumbnails and waveforms are caches; they are rebuilt from the source
        // bytes rather than shipped, which keeps archives smaller.
        thumbnailKey: null,
        waveformKey: null,
      };
    }

    const migrated = migrateDocument({ ...parsed.project, entities: { ...parsed.project.entities, media: remapped } });
    const { project, issues } = validateProject(migrated.document);

    return {
      project,
      manifest,
      issues,
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
