/**
 * Tests for the import pipeline's failure paths.
 *
 * `importFile` persists the bytes before it probes them, so an import that fails
 * after the write has staged a full-size blob that no asset references. There is
 * no sweep in the app to reclaim it (docs/DEVELOPMENT.md, "Deferred media
 * cleanup"), so the import itself must clean up — but only the key it just
 * staged.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { probeMedia } = vi.hoisted(() => ({ probeMedia: vi.fn() }));

vi.mock("../probe", () => ({
  probeMedia,
  // createMediaStore / importFile only call probeMedia; the thumbnail path is
  // reached through the fire-and-forget artifact step and never awaits the fake.
  generateThumbnail: vi.fn(async () => null),
}));

import { MemoryMediaStore } from "../storage";

const file = (name: string, contents = "hello"): File =>
  new File([contents], name, { type: "image/png" });

describe("importFile failure cleanup", () => {
  beforeEach(() => {
    probeMedia.mockReset();
  });

  it("deletes only the key it just staged when the probe fails", async () => {
    const { importFile } = await import("../import");
    const store = new MemoryMediaStore();
    await store.put("someone-elses:source", new Blob(["keep me"]));

    probeMedia.mockRejectedValueOnce(new Error("probe exploded"));

    await expect(importFile(file("clip.png"), { store })).rejects.toThrow(
      "probe exploded",
    );

    // The staged source key is gone; a blob staged by another import (or kept
    // for a removed-but-undoable asset) is untouched.
    expect(await store.keys()).toEqual(["someone-elses:source"]);
  });

  it("keeps the staged bytes and reports an asset when the probe is fine", async () => {
    const { importFile } = await import("../import");
    const store = new MemoryMediaStore();

    probeMedia.mockResolvedValueOnce({
      durationSeconds: 0,
      frameRate: null,
      dimensions: { width: 10, height: 10 },
      hasAudio: false,
      hasVideo: true,
      codec: null,
      sampleRate: null,
      channels: null,
      byteSize: 5,
    });

    const asset = await importFile(file("clip.png"), { store });

    expect(asset.name).toBe("clip.png");
    const keys = await store.keys();
    expect(keys).toHaveLength(1);
    expect(await store.get(keys[0]!)).not.toBeNull();
  });
});
