import { describe, expect, it } from "vitest";
import { BlobReader, BlobWriter, TextReader, ZipReader, ZipWriter } from "@zip.js/zip.js";
import type { Clip, MediaAsset, ProjectDocument } from "@cutaway/types";
import { createClip, createProject, createTrack } from "@cutaway/utils";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ARCHIVE_MANIFEST_NAME,
  ARCHIVE_PROJECT_NAME,
  ArchiveError,
  archiveAssetPath,
  archiveFileName,
  exportProjectArchive,
  importProjectArchive,
  type ArchiveBlobStore,
} from "../archive";

/** Minimal in-memory stand-in for the IndexedDB media store. */
class MemoryBlobStore implements ArchiveBlobStore {
  readonly blobs = new Map<string, Blob>();
  /** When set, `put` rejects for any key containing this substring. */
  failOnPut: string | null = null;

  async put(key: string, blob: Blob): Promise<void> {
    if (this.failOnPut !== null && key.includes(this.failOnPut)) {
      throw new Error("QuotaExceededError: the storage quota was exceeded");
    }
    this.blobs.set(key, blob);
  }

  async get(key: string): Promise<Blob | null> {
    return this.blobs.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}

function mediaAsset(id: string): MediaAsset {
  return {
    id,
    name: `${id}.png`,
    kind: "image",
    mimeType: "image/png",
    source: { type: "indexeddb", key: `${id}:source` },
    metadata: {
      durationSeconds: 0,
      frameRate: null,
      dimensions: { width: 32, height: 32 },
      hasAudio: false,
      hasVideo: true,
      codec: null,
      sampleRate: null,
      channels: null,
      byteSize: 8,
    },
    thumbnailKey: `${id}:thumb`,
    waveformKey: null,
    importedAt: 0,
  };
}

/** A project with one image clip per media id, all on one video track. */
function projectWithMedia(...ids: string[]): ProjectDocument {
  const base = createProject("Archive test");
  const track = createTrack({ kind: "video", index: 0 });
  const media: Record<string, MediaAsset> = {};
  const clips: Record<string, Clip> = {};

  ids.forEach((id, index) => {
    media[id] = mediaAsset(id);
    const clip = createClip({
      id: `clip-${id}`,
      trackId: track.id,
      startFrame: index * 10,
      durationFrames: 20,
      content: { kind: "image", mediaId: id },
    });
    clips[clip.id] = clip;
  });

  return {
    ...base,
    entities: { ...base.entities, tracks: { [track.id]: track }, media, clips },
    trackOrder: [track.id],
    durationFrames: ids.length * 10 + 10,
  };
}

/** A store that already holds the source bytes for each media id. */
function seededStore(...ids: string[]): MemoryBlobStore {
  const store = new MemoryBlobStore();
  for (const id of ids) {
    store.blobs.set(`${id}:source`, new Blob([`bytes:${id}`], { type: "image/png" }));
  }
  return store;
}

/** A project whose only clip is a Desktop Stage plugin payload. */
function projectWithDesktopClip(
  contentType: string,
  data: Record<string, unknown>,
): ProjectDocument {
  const base = createProject("Archive test");
  const track = createTrack({ kind: "desktop", index: 0 });
  const clip = createClip({
    id: "clip-desktop",
    trackId: track.id,
    startFrame: 0,
    durationFrames: 30,
    content: { kind: "plugin", contentType, data },
  });

  return {
    ...base,
    entities: { ...base.entities, tracks: { [track.id]: track }, media: {}, clips: { [clip.id]: clip } },
    trackOrder: [track.id],
    durationFrames: 30,
  };
}

async function zipWith(entries: Record<string, string>): Promise<Blob> {
  const writer = new ZipWriter<Blob>(new BlobWriter("application/zip"));
  for (const [name, text] of Object.entries(entries)) {
    await writer.add(name, new TextReader(text));
  }
  return writer.close();
}

/**
 * Builds an archive whose manifest and asset entries are written by hand, so a
 * test can lie about a size or choose a compression method.
 *
 * `level` is passed straight through to zip.js: 0 stores the bytes, leaving it
 * unset compresses them.
 */
async function archiveWithAssets(
  assets: { mediaId: string; bytes: Blob; byteSize?: number; level?: number }[],
  project: ProjectDocument,
): Promise<Blob> {
  const writer = new ZipWriter<Blob>(new BlobWriter("application/zip"));

  await writer.add(
    ARCHIVE_MANIFEST_NAME,
    new TextReader(
      manifestJson(
        assets.map((asset) => ({
          mediaId: asset.mediaId,
          name: `${asset.mediaId}.png`,
          mimeType: "image/png",
          archivePath: archiveAssetPath(asset.mediaId),
          bundled: true,
          byteSize: asset.byteSize ?? asset.bytes.size,
        })),
      ),
    ),
  );
  await writer.add(ARCHIVE_PROJECT_NAME, new TextReader(JSON.stringify(project)));

  for (const asset of assets) {
    const path = archiveAssetPath(asset.mediaId);
    if (asset.level === undefined) {
      await writer.add(path, new BlobReader(asset.bytes));
    } else {
      await writer.add(path, new BlobReader(asset.bytes), { level: asset.level });
    }
  }

  return writer.close();
}

function manifestJson(assets: unknown[], formatVersion = ARCHIVE_FORMAT_VERSION): string {
  return JSON.stringify({
    format: ARCHIVE_FORMAT,
    formatVersion,
    savedAt: 0,
    app: "desktop-stage",
    appVersion: "0.0.0",
    projectId: "p1",
    projectName: "Archive test",
    assets,
  });
}

/** Runs an import/export and returns the `ArchiveError` it must throw. */
async function archiveError(run: () => Promise<unknown>): Promise<ArchiveError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ArchiveError) return error;
    throw error;
  }
  throw new Error("expected the operation to reject with an ArchiveError");
}

describe("archiveFileName", () => {
  it("produces a filesystem-safe name", () => {
    expect(archiveFileName("My Project / 2026!")).toBe("My-Project-2026.desktopstage");
    expect(archiveFileName("   ")).toBe("untitled.desktopstage");
  });
});

describe("exportProjectArchive", () => {
  it("bundles every indexeddb asset plus the manifest and project", async () => {
    const store = seededStore("m1");
    const result = await exportProjectArchive(projectWithMedia("m1"), { store, savedAt: 123 });

    expect(result.manifest.format).toBe(ARCHIVE_FORMAT);
    expect(result.manifest.formatVersion).toBe(ARCHIVE_FORMAT_VERSION);
    expect(result.manifest.savedAt).toBe(123);
    expect(result.manifest.assets).toEqual([
      {
        mediaId: "m1",
        name: "m1.png",
        mimeType: "image/png",
        archivePath: archiveAssetPath("m1"),
        bundled: true,
        byteSize: 8,
      },
    ]);

    const reader = new ZipReader(new BlobReader(result.blob));
    const names = (await reader.getEntries()).map((entry) => entry.filename).sort();
    await reader.close();

    expect(names).toEqual([archiveAssetPath("m1"), ARCHIVE_MANIFEST_NAME, ARCHIVE_PROJECT_NAME]);
  });

  it("refuses to write a partial archive when a source blob is missing", async () => {
    const error = await archiveError(() =>
      exportProjectArchive(projectWithMedia("m1"), { store: new MemoryBlobStore() }),
    );

    expect(error.code).toBe("missing-media");
    expect(error.details).toHaveLength(1);
    expect(error.details[0]).toContain("m1:source");
  });
});

describe("archiveAssetPath", () => {
  it("keeps ordinary ids readable and escapes anything that could escape the root", () => {
    expect(archiveAssetPath("m1")).toBe("assets/m1");
    expect(archiveAssetPath("a b")).toBe("assets/a%20b");
    expect(archiveAssetPath("a/b")).toBe("assets/a%2Fb");
    expect(archiveAssetPath("..")).toBe("assets/%2E%2E");
    expect(archiveAssetPath(".")).toBe("assets/%2E");
    expect(archiveAssetPath("")).toBe("assets/#");
    expect(archiveAssetPath("\uD800")).toBe("assets/#D800");
  });

  it("gives every unusual id its own path, so two assets cannot share an entry", () => {
    const paths = ["..", ".", "", "\uD800", "\uD801", "#", "a.b", "a%2Eb"].map(archiveAssetPath);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("importProjectArchive", () => {
  it("round-trips a media-rich project and remaps its media keys", async () => {
    const exported = await exportProjectArchive(projectWithMedia("m1"), { store: seededStore("m1") });

    const destination = new MemoryBlobStore();
    const result = await importProjectArchive(exported.blob, {
      store: destination,
      keyFor: (_mediaId, index) => `staged-${index}`,
    });

    expect(result.stagedMedia).toEqual([{ mediaId: "m1", key: "staged-0" }]);
    expect(result.project.entities.media.m1?.source).toEqual({ type: "indexeddb", key: "staged-0" });
    expect(result.issues).toEqual([]);

    const staged = destination.blobs.get("staged-0");
    expect(staged).toBeDefined();
    expect(await staged!.text()).toBe("bytes:m1");
  });

  it("round-trips several assets without tripping the size bounds", async () => {
    const exported = await exportProjectArchive(projectWithMedia("m1", "m2", "m3"), {
      store: seededStore("m1", "m2", "m3"),
    });

    const destination = new MemoryBlobStore();
    const result = await importProjectArchive(exported.blob, {
      store: destination,
      keyFor: (_mediaId, index) => `staged-${index}`,
    });

    expect(result.stagedMedia).toHaveLength(3);
    expect(result.issues).toEqual([]);
    expect(destination.blobs.size).toBe(3);
  });

  it("round-trips a media id that is unsafe as a raw path segment", async () => {
    const exported = await exportProjectArchive(projectWithMedia(".."), { store: seededStore("..") });

    expect(exported.manifest.assets[0]?.archivePath).toBe(archiveAssetPath(".."));
    expect(exported.manifest.assets[0]?.archivePath).not.toBe("assets/..");

    const destination = new MemoryBlobStore();
    const result = await importProjectArchive(exported.blob, {
      store: destination,
      keyFor: (_mediaId, index) => `staged-${index}`,
    });

    expect(result.stagedMedia).toEqual([{ mediaId: "..", key: "staged-0" }]);
    expect(await destination.blobs.get("staged-0")!.text()).toBe("bytes:..");
  });

  it("reports the first-pass issues, including a dropped unsupported Desktop Stage clip", async () => {
    const archive = await zipWith({
      [ARCHIVE_MANIFEST_NAME]: manifestJson([]),
      [ARCHIVE_PROJECT_NAME]: JSON.stringify(projectWithDesktopClip("desktop-stage/app@2", {})),
    });
    const store = new MemoryBlobStore();

    const result = await importProjectArchive(archive, { store });

    expect(result.project.entities.clips["clip-desktop"]).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        severity: "dropped",
        subject: "clip:clip-desktop",
        message: expect.stringMatching(/version 2 is not supported/),
      }),
    ]);
    expect(store.blobs.size).toBe(0);
  });

  it("rejects an asset entry that is null instead of throwing a TypeError", async () => {
    const archive = await zipWith({
      [ARCHIVE_MANIFEST_NAME]: manifestJson([null]),
      [ARCHIVE_PROJECT_NAME]: JSON.stringify(projectWithMedia("m1")),
    });
    const store = new MemoryBlobStore();

    const error = await archiveError(() => importProjectArchive(archive, { store }));

    expect(error.code).toBe("invalid-archive");
    expect(error.message).toMatch(/assets\[0\]/);
    expect(store.blobs.size).toBe(0);
  });

  it("rejects an asset entry with no media id", async () => {
    const archive = await zipWith({
      [ARCHIVE_MANIFEST_NAME]: manifestJson([
        { bundled: true, archivePath: "assets/m1", byteSize: 8 },
      ]),
      [ARCHIVE_PROJECT_NAME]: JSON.stringify(projectWithMedia("m1")),
    });
    const store = new MemoryBlobStore();

    const error = await archiveError(() => importProjectArchive(archive, { store }));

    expect(error.code).toBe("invalid-archive");
    expect(error.message).toMatch(/media id/);
  });

  it("rejects a bundled asset whose manifest path leaves the assets directory", async () => {
    const archive = await zipWith({
      [ARCHIVE_MANIFEST_NAME]: manifestJson([
        {
          mediaId: "m1",
          name: "m1.png",
          mimeType: "image/png",
          archivePath: "../m1",
          bundled: true,
          byteSize: 8,
        },
      ]),
      [ARCHIVE_PROJECT_NAME]: JSON.stringify(projectWithMedia("m1")),
    });
    const store = new MemoryBlobStore();

    const error = await archiveError(() => importProjectArchive(archive, { store }));

    expect(error.code).toBe("invalid-archive");
    expect(error.message).toMatch(/outside the assets directory/);
  });

  it("rejects an asset entry with no readable byte size", async () => {
    const archive = await zipWith({
      [ARCHIVE_MANIFEST_NAME]: manifestJson([
        {
          mediaId: "m1",
          name: "m1.png",
          mimeType: "image/png",
          archivePath: "assets/m1",
          bundled: true,
          byteSize: "8",
        },
      ]),
      [ARCHIVE_PROJECT_NAME]: JSON.stringify(projectWithMedia("m1")),
    });
    const store = new MemoryBlobStore();

    const error = await archiveError(() => importProjectArchive(archive, { store }));

    expect(error.code).toBe("invalid-archive");
    expect(error.message).toMatch(/byte size/);
  });

  it("refuses a manifest above the metadata bound before parsing it", async () => {
    const archive = await zipWith({
      [ARCHIVE_MANIFEST_NAME]: manifestJson([]),
      [ARCHIVE_PROJECT_NAME]: JSON.stringify(projectWithMedia("m1")),
    });
    const store = new MemoryBlobStore();

    const error = await archiveError(() =>
      importProjectArchive(archive, { store, limits: { maxMetadataBytes: 16 } }),
    );

    expect(error.code).toBe("invalid-archive");
    expect(error.message).toMatch(/metadata limit/);
    expect(store.blobs.size).toBe(0);
  });

  it("rejects an asset that unpacks to far more than the manifest claims", async () => {
    // A small compressed entry (about 1 KB stored) that inflates to 1 MiB, but
    // whose manifest claims 8 bytes.
    const archive = await archiveWithAssets(
      [{ mediaId: "m1", bytes: new Blob(["A".repeat(1024 * 1024)]), byteSize: 8 }],
      projectWithMedia("m1"),
    );
    const store = new MemoryBlobStore();

    const error = await archiveError(() => importProjectArchive(archive, { store }));

    expect(error.code).toBe("invalid-archive");
    expect(error.details.join(" ")).toMatch(/listed as 8 bytes but declares 1048576/);
    expect(store.blobs.size).toBe(0);
  });

  it("refuses an asset above the per-asset bound without unpacking it", async () => {
    const bytes = new Blob([new Uint8Array(2 * 1024 * 1024)]);
    const archive = await archiveWithAssets([{ mediaId: "m1", bytes, level: 0 }], projectWithMedia("m1"));
    const store = new MemoryBlobStore();

    const error = await archiveError(() =>
      importProjectArchive(archive, {
        store,
        limits: {
          maxAssetBytes: 1024 * 1024,
          maxTotalBytes: 100 * 1024 * 1024,
          maxCompressionRatio: 1_000_000,
        },
      }),
    );

    expect(error.code).toBe("invalid-archive");
    expect(error.details.join(" ")).toMatch(/per-asset limit/);
    expect(store.blobs.size).toBe(0);
  });

  it("refuses a set of assets above the aggregate bound", async () => {
    const bytes = () => new Blob([new Uint8Array(2 * 1024 * 1024)]);
    const archive = await archiveWithAssets(
      [
        { mediaId: "m1", bytes: bytes(), level: 0 },
        { mediaId: "m2", bytes: bytes(), level: 0 },
      ],
      projectWithMedia("m1", "m2"),
    );
    const store = new MemoryBlobStore();

    const error = await archiveError(() =>
      importProjectArchive(archive, {
        store,
        limits: {
          maxAssetBytes: 100 * 1024 * 1024,
          maxTotalBytes: 3 * 1024 * 1024,
          maxCompressionRatio: 1_000_000,
        },
      }),
    );

    expect(error.code).toBe("invalid-archive");
    expect(error.details.join(" ")).toMatch(/in total/);
    expect(store.blobs.size).toBe(0);
  });

  it("refuses a highly compressed large entry as a decompression bomb", async () => {
    const archive = await archiveWithAssets(
      [{ mediaId: "m1", bytes: new Blob(["A".repeat(2 * 1024 * 1024)]) }],
      projectWithMedia("m1"),
    );
    const store = new MemoryBlobStore();

    const error = await archiveError(() =>
      importProjectArchive(archive, {
        store,
        limits: { maxAssetBytes: 1024 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024, maxCompressionRatio: 50 },
      }),
    );

    expect(error.code).toBe("invalid-archive");
    expect(error.details.join(" ")).toMatch(/:1 limit/);
    expect(store.blobs.size).toBe(0);
  });

  it("rejects an entry that is not part of the format, staging nothing", async () => {
    const archive = await zipWith({ "notes.txt": "hello" });
    const store = new MemoryBlobStore();

    const error = await archiveError(() => importProjectArchive(archive, { store }));

    expect(error.code).toBe("invalid-archive");
    expect(error.message).toMatch(/notes\.txt/);
    expect(store.blobs.size).toBe(0);
  });

  it("rejects a file that is not a readable zip archive", async () => {
    const store = new MemoryBlobStore();

    const error = await archiveError(() =>
      importProjectArchive(new Blob(["definitely not a zip"]), { store }),
    );

    expect(error.code).toBe("invalid-archive");
    expect(store.blobs.size).toBe(0);
  });

  it("rejects an entry that escapes the archive root", async () => {
    const archive = await zipWith({
      "../evil.txt": "x",
      [ARCHIVE_MANIFEST_NAME]: manifestJson([]),
    });
    const store = new MemoryBlobStore();

    const error = await archiveError(() => importProjectArchive(archive, { store }));

    expect(error.code).toBe("invalid-archive");
    expect(error.message).toMatch(/escapes the archive root/);
  });

  it("rejects an archive without a manifest", async () => {
    const archive = await zipWith({
      [ARCHIVE_PROJECT_NAME]: JSON.stringify(projectWithMedia("m1")),
    });
    const store = new MemoryBlobStore();

    const error = await archiveError(() => importProjectArchive(archive, { store }));

    expect(error.code).toBe("invalid-archive");
    expect(error.message).toMatch(/manifest\.json/);
    expect(store.blobs.size).toBe(0);
  });

  it("refuses an archive written by a newer format version", async () => {
    const archive = await zipWith({
      [ARCHIVE_MANIFEST_NAME]: manifestJson([], ARCHIVE_FORMAT_VERSION + 1),
      [ARCHIVE_PROJECT_NAME]: JSON.stringify(projectWithMedia("m1")),
    });
    const store = new MemoryBlobStore();

    const error = await archiveError(() => importProjectArchive(archive, { store }));

    expect(error.code).toBe("unsupported-version");
    expect(store.blobs.size).toBe(0);
  });

  it("stages nothing when an asset the archive lists is missing", async () => {
    const archive = await zipWith({
      [ARCHIVE_MANIFEST_NAME]: manifestJson([
        {
          mediaId: "m1",
          name: "m1.png",
          mimeType: "image/png",
          archivePath: archiveAssetPath("m1"),
          bundled: true,
          byteSize: 8,
        },
      ]),
      [ARCHIVE_PROJECT_NAME]: JSON.stringify(projectWithMedia("m1")),
    });
    const store = new MemoryBlobStore();

    const error = await archiveError(() =>
      importProjectArchive(archive, { store, keyFor: (_mediaId, index) => `staged-${index}` }),
    );

    expect(error.code).toBe("invalid-archive");
    expect(error.details[0]).toMatch(/assets\/m1/);
    expect(store.blobs.size).toBe(0);
  });

  it("deletes blobs already staged when a later write fails", async () => {
    const exported = await exportProjectArchive(projectWithMedia("m1", "m2"), {
      store: seededStore("m1", "m2"),
    });

    const destination = new MemoryBlobStore();
    destination.failOnPut = "staged-1";

    const error = await archiveError(() =>
      importProjectArchive(exported.blob, {
        store: destination,
        keyFor: (_mediaId, index) => `staged-${index}`,
      }),
    );

    expect(error.code).toBe("storage-failure");
    // The first blob was written, then rolled back together with the failure.
    expect(destination.blobs.size).toBe(0);
  });
});
