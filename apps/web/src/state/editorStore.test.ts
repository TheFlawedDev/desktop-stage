/**
 * Tests for document ids that collide with `Object.prototype` members.
 *
 * A project file is JSON, and `JSON.parse('{"__proto__": …}')` produces an
 * *own* `"__proto__"` key that `Object.keys`/`JSON.stringify` both see. The
 * validator deliberately keeps such ids, so every store action that writes a
 * clip or asset back into its map has to write an own property: a plain
 * `clips[id] = clip` assignment invokes the `Object.prototype` setter, and the
 * result of the edit disappears from the timeline.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createStarterProject } from "@desktop-stage/desktop-engine";
import type { Clip, MediaAsset, ProjectDocument } from "@cutaway/types";
import { createClip, createProject, createTrack } from "@cutaway/utils";
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

/**
 * A project with the given clips on one video track.
 *
 * `Object.fromEntries` would be the obvious build, but a plain assignment of
 * the `"__proto__"` key makes it the map's prototype — which is the very defect
 * these tests are about, so the fixture has to get it right too.
 */
function projectWithClips(trackId: string, ...clips: Clip[]): ProjectDocument {
  const clipsById: Record<string, Clip> = {};
  for (const clip of clips) {
    Object.defineProperty(clipsById, clip.id, {
      value: clip,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  const base = createProject("Proto test");

  return {
    ...base,
    entities: {
      ...base.entities,
      tracks: { [trackId]: createTrack({ id: trackId, kind: "video", index: 0 }) },
      clips: clipsById,
    },
    trackOrder: [trackId],
    durationFrames: 60,
  };
}

function videoClip(id: string, trackId: string, startFrame: number, durationFrames: number): Clip {
  return createClip({
    id,
    trackId,
    startFrame,
    durationFrames,
    content: {
      kind: "video",
      mediaId: asset.id,
      sourceInFrame: 0,
      speed: 1,
      volume: { type: "static", value: 1 },
      muted: false,
    },
  });
}

describe("clips keyed __proto__", () => {
  beforeEach(() => {
    useEditorStore.getState().replaceProject(createStarterProject());
  });

  it("splits a clip whose id is __proto__ without losing a half", () => {
    useEditorStore.getState().replaceProject(projectWithClips("track-1", videoClip("__proto__", "track-1", 0, 30)));
    useEditorStore.setState({ playhead: 10 });

    useEditorStore.getState().splitAtPlayhead();

    const { clips } = useEditorStore.getState().project.entities;
    expect(Object.getPrototypeOf(clips)).toBe(Object.prototype);
    expect(Object.hasOwn(clips, "__proto__")).toBe(true);
    expect(Object.keys(clips)).toHaveLength(2);

    const left = clips["__proto__"];
    expect(left?.id).toBe("__proto__");
    expect(left?.startFrame).toBe(0);
    expect(left?.durationFrames).toBe(10);
    // The result has to survive serialization, which is what a lost own key
    // cannot do.
    expect(JSON.parse(JSON.stringify(clips))["__proto__"]).toBeDefined();
  });

  it("ripples past a clip whose id is __proto__ without losing the survivor", () => {
    useEditorStore
      .getState()
      .replaceProject(
        projectWithClips(
          "track-1",
          videoClip("__proto__", "track-1", 0, 10),
          videoClip("clip-2", "track-1", 10, 10),
        ),
      );
    useEditorStore.setState({ selectedClipIds: ["__proto__"] });

    useEditorStore.getState().deleteSelected();

    const { clips } = useEditorStore.getState().project.entities;
    expect(Object.getPrototypeOf(clips)).toBe(Object.prototype);
    expect(Object.hasOwn(clips, "clip-2")).toBe(true);
    expect(Object.keys(clips)).toEqual(["clip-2"]);
    // The ripple only closes the gap if the `"__proto__"` clip was carried as an
    // own key: a lost key means `deleteSelected` never finds it, and the
    // survivor stays at frame 10. The rewrite then has to store `clip-2` as an
    // own key too.
    expect(clips["clip-2"]!.startFrame).toBe(0);
  });

  it("imports an asset whose id is __proto__ as an own key", () => {
    useEditorStore.getState().addMediaAssets([{ ...asset, id: "__proto__" }]);

    const { media } = useEditorStore.getState().project.entities;
    expect(Object.getPrototypeOf(media)).toBe(Object.prototype);
    expect(Object.hasOwn(media, "__proto__")).toBe(true);
    expect(Object.keys(media)).toEqual(["__proto__"]);
    expect(media["__proto__"]!.source).toEqual({ type: "indexeddb", key: "blob-1" });
  });
});

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
