/**
 * Tests for the project-file decisions the UI makes before it touches anything.
 *
 * These are deliberately browser-free: the interesting behavior is the
 * classification — which reader a file is handed to — and the wording of a
 * failure. Getting the first wrong can replace an open project with garbage, and
 * getting the second wrong leaves a user with no idea what to do next, so both
 * are pinned here rather than exercised through the DOM.
 */

import { describe, expect, it } from "vitest";
import {
  ArchiveError,
  type ArchiveManifest,
  type ArchiveProgress,
} from "@cutaway/project-io";
import {
  archiveProgressText,
  classifyProjectFile,
  describeArchiveFailure,
  formatByteSize,
  sniffProjectFileKind,
  unbundledAssetNotice,
} from "./projectFiles";

/** First bytes of a ZIP local file header, i.e. anything `.desktopstage`. */
const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const ZIP_EMPTY = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00]);

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("classifyProjectFile", () => {
  it("reads the archive extension the share action writes", () => {
    expect(classifyProjectFile({ name: "scene.desktopstage", type: "" })).toBe("archive");
  });

  it("ignores case and an unhelpful Windows MIME type", () => {
    expect(
      classifyProjectFile({ name: "SCENE.DesktopStage", type: "application/octet-stream" }),
    ).toBe("archive");
  });

  it("accepts a renamed archive", () => {
    expect(classifyProjectFile({ name: "scene.zip", type: "application/zip" })).toBe("archive");
  });

  it("reads both JSON extensions", () => {
    expect(classifyProjectFile({ name: "scene.cutaway", type: "" })).toBe("json");
    expect(classifyProjectFile({ name: "desktop-stage-project.json", type: "application/json" })).toBe(
      "json",
    );
    expect(classifyProjectFile({ name: "EXPORT.JSON", type: "application/octet-stream" })).toBe(
      "json",
    );
  });

  it("falls back to the reported MIME type when the name has no extension", () => {
    expect(classifyProjectFile({ name: "download", type: "application/zip" })).toBe("archive");
    expect(classifyProjectFile({ name: "download", type: "application/json" })).toBe("json");
  });

  it("treats a bare leading dot as part of the name, not an extension", () => {
    expect(classifyProjectFile({ name: ".desktopstage", type: "" })).toBe("unknown");
  });

  it("knows nothing about unrelated files", () => {
    expect(classifyProjectFile({ name: "clip.mp4", type: "video/mp4" })).toBe("unknown");
    expect(classifyProjectFile({ name: "notes.txt", type: "text/plain" })).toBe("unknown");
  });

  it("sniffs the bytes only when the name and type say nothing", () => {
    expect(classifyProjectFile({ name: "backup", type: "" }, ZIP_HEAD)).toBe("archive");
    expect(classifyProjectFile({ name: "backup", type: "" }, bytesOf('{"magic":"cutaway.project"}'))).toBe(
      "json",
    );
    expect(classifyProjectFile({ name: "backup", type: "" }, bytesOf("not a project"))).toBe(
      "unknown",
    );
    expect(classifyProjectFile({ name: "backup", type: "" }, null)).toBe("unknown");
  });

  it("never reads a corrupt archive as JSON", () => {
    // A file named `.desktopstage` whose contents are JSON text is a broken
    // archive, and must fail as one. Handing it to the JSON parser would
    // replace the open project with whatever that text describes.
    expect(
      classifyProjectFile({ name: "scene.desktopstage", type: "" }, bytesOf('{"hello":"world"}')),
    ).toBe("archive");
  });

  it("never reads JSON as an archive", () => {
    // The mirror image: a `.json` file that happens to begin with the ZIP
    // signature is still JSON, so it fails with a JSON parse error rather than
    // a ZIP error that would not explain anything.
    expect(classifyProjectFile({ name: "scene.json", type: "" }, ZIP_HEAD)).toBe("json");
  });
});

describe("sniffProjectFileKind", () => {
  it("recognizes every ZIP opening signature", () => {
    expect(sniffProjectFileKind(ZIP_HEAD)).toBe("archive");
    expect(sniffProjectFileKind(ZIP_EMPTY)).toBe("archive");
    expect(sniffProjectFileKind(new Uint8Array([0x50, 0x4b, 0x07, 0x08]))).toBe("archive");
  });

  it("does not guess from a partial signature", () => {
    expect(sniffProjectFileKind(new Uint8Array([0x50, 0x4b]))).toBe("unknown");
  });

  it("accepts an ArrayBuffer as readily as a view", () => {
    expect(sniffProjectFileKind(ZIP_HEAD.buffer as ArrayBuffer)).toBe("archive");
  });

  it("recognizes JSON behind whitespace or a byte-order mark", () => {
    expect(sniffProjectFileKind(bytesOf('  \r\n\t{"magic":"cutaway.project"}'))).toBe("json");
    expect(sniffProjectFileKind(bytesOf("["))).toBe("json");
    expect(sniffProjectFileKind(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b]))).toBe("json");
  });

  it("reports unknown for empty, blank, or unrelated bytes", () => {
    expect(sniffProjectFileKind(new Uint8Array())).toBe("unknown");
    expect(sniffProjectFileKind(bytesOf("   \n"))).toBe("unknown");
    expect(sniffProjectFileKind(bytesOf("<!doctype html>"))).toBe("unknown");
  });
});

describe("describeArchiveFailure", () => {
  it("keeps the specifics of a missing-media failure, and says nothing was lost", () => {
    const notice = describeArchiveFailure(
      new ArchiveError("missing-media", "2 media sources are missing", [
        'take-01.mp4 (missing "media/1/source")',
        'logo.png (missing "media/2/source")',
      ]),
      "export",
    );

    expect(notice.tone).toBe("error");
    expect(notice.title).toMatch(/missing/i);
    expect(notice.details).toEqual([
      'take-01.mp4 (missing "media/1/source")',
      'logo.png (missing "media/2/source")',
    ]);
  });

  it("explains a malformed ZIP as a malformed archive", () => {
    const notice = describeArchiveFailure(
      new ArchiveError("invalid-archive", "The file is not a readable ZIP archive.", ["corrupt"]),
      "import",
    );

    expect(notice.title).toMatch(/archive/i);
    expect(notice.details).toContain("corrupt");
    expect(notice.details.some((line) => /unchanged/i.test(line))).toBe(true);
  });

  it("names the version problem when an archive is too new", () => {
    const notice = describeArchiveFailure(
      new ArchiveError("unsupported-version", "format 2"),
      "import",
    );

    expect(notice.title).toMatch(/newer version/i);
  });

  it("points at storage when staging fails", () => {
    const notice = describeArchiveFailure(
      new ArchiveError("storage-failure", "quota", ["QuotaExceededError"]),
      "import",
    );

    expect(notice.title).toMatch(/storage/i);
    expect(notice.details).toContain("QuotaExceededError");
  });

  it("recognizes a raw quota error from the browser", () => {
    const quota = new Error("the quota has been exceeded");
    quota.name = "QuotaExceededError";

    const notice = describeArchiveFailure(quota, "import");

    expect(notice.title).toMatch(/storage/i);
    expect(notice.details.some((line) => /free space/i.test(line))).toBe(true);
  });

  it("reports an unexpected error without claiming to know its cause", () => {
    const exported = describeArchiveFailure(new Error("boom"), "export");
    const imported = describeArchiveFailure("odd failure", "import");

    expect(exported.details).toEqual(["boom"]);
    expect(exported.title).toMatch(/could not be packed/i);
    expect(imported.details).toEqual(["odd failure", "Your open project was left unchanged."]);
  });

  it("survives a thrown non-error", () => {
    expect(() => describeArchiveFailure(undefined, "export")).not.toThrow();
    expect(describeArchiveFailure(undefined, "export").details).toEqual([]);
  });
});

describe("formatByteSize", () => {
  it("prints small sizes in bytes", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(512)).toBe("512 B");
  });

  it("switches to binary units at 1024", () => {
    expect(formatByteSize(1024)).toBe("1.0 kB");
    expect(formatByteSize(1536)).toBe("1.5 kB");
    expect(formatByteSize(10 * 1024)).toBe("10 kB");
    expect(formatByteSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatByteSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("refuses to print a nonsense size", () => {
    expect(formatByteSize(-1)).toBe("unknown size");
    expect(formatByteSize(Number.NaN)).toBe("unknown size");
  });
});

describe("archiveProgressText", () => {
  const progress = (completed: number, total: number, label: string): ArchiveProgress => ({
    completed,
    total,
    label,
  });

  it("names the entry being written while exporting", () => {
    expect(archiveProgressText(progress(2, 5, "manifest.json"), "export")).toBe(
      "Packing 2 of 5 · manifest.json",
    );
  });

  it("describes import progress", () => {
    expect(archiveProgressText(progress(1, 3, "media-2"), "import")).toBe(
      "Unpacking 1 of 3 · media-2",
    );
  });

  it("has something to say before the first entry", () => {
    expect(archiveProgressText(null, "export")).toBe("Packing…");
    expect(archiveProgressText(progress(0, 0, ""), "import")).toBe("Unpacking…");
  });
});

describe("unbundledAssetNotice", () => {
  function manifest(bundled: number, unbundled: number): ArchiveManifest {
    return {
      format: "desktop-stage/project",
      formatVersion: 1,
      savedAt: 0,
      app: "desktop-stage",
      appVersion: "0.0.0",
      projectId: "p",
      projectName: "p",
      assets: [
        ...Array.from({ length: bundled }, (_, index) => ({
          mediaId: `bundled-${index}`,
          name: `bundled-${index}.png`,
          mimeType: "image/png",
          archivePath: `assets/bundled-${index}`,
          bundled: true,
          byteSize: 8,
        })),
        ...Array.from({ length: unbundled }, (_, index) => ({
          mediaId: `linked-${index}`,
          name: `linked-${index}.png`,
          mimeType: "image/png",
          archivePath: null,
          bundled: false,
          byteSize: 0,
        })),
      ],
    };
  }

  it("stays quiet when everything travelled", () => {
    expect(unbundledAssetNotice(manifest(3, 0))).toBeNull();
    expect(unbundledAssetNotice(manifest(0, 0))).toBeNull();
  });

  it("counts the assets that did not travel", () => {
    expect(unbundledAssetNotice(manifest(1, 1))).toMatch(/^1 media file is a link/);
    expect(unbundledAssetNotice(manifest(1, 2))).toMatch(/^2 media files are links/);
  });
});
