/**
 * Tests for the media-removal edit.
 *
 * Removing an asset is an ordinary undoable document edit. It must stay one:
 * the bytes are kept (see `useMediaImport.removeAsset`), so undo restores an
 * asset that still resolves — the document and the store stay consistent.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createStarterProject } from "@desktop-stage/desktop-engine";
import type { MediaAsset } from "@cutaway/types";
import { useEditorStore } from "./editorStore";

const asset: MediaAsset = {
  id: "media-1",
  name: "clip.mp4",
  kind: "video",
  mimeType: "video/mp4",
  source: { type: "indexeddb", key: "blob-1" },
  metadata: {
    durationSeconds: 5,
    frameRate: 30,
    dimensions: { width: 1920, height: 1080 },
    hasAudio: true,
    hasVideo: true,
    codec: "h264",
    sampleRate: 48000,
    channels: 2,
    byteSize: 1024,
  },
  thumbnailKey: "thumb-1",
  waveformKey: null,
  importedAt: 0,
};

describe("removeMediaAsset", () => {
  beforeEach(() => {
    useEditorStore.getState().replaceProject(createStarterProject());
  });

  it("stays undoable and restores the same store key", () => {
    useEditorStore.getState().addMediaAssets([asset]);
    expect(useEditorStore.getState().project.entities.media["media-1"]).toBeDefined();

    useEditorStore.getState().removeMediaAsset("media-1");
    expect(useEditorStore.getState().project.entities.media["media-1"]).toBeUndefined();
    expect(useEditorStore.getState().undoLabel()).toBe("Remove media");

    useEditorStore.getState().undo();

    // The key the bytes live under survives with the asset. If removal deleted
    // the blobs, this state would point at media that no longer exists.
    const restored = useEditorStore.getState().project.entities.media["media-1"];
    expect(restored?.source).toEqual({ type: "indexeddb", key: "blob-1" });
    expect(restored?.thumbnailKey).toBe("thumb-1");
  });
});
