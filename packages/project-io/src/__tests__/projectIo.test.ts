import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, staticValue } from "@cutaway/types";
import { createClip, createProject, createTrack } from "@cutaway/utils";
import {
  parseProjectFile,
  projectFileName,
  referencedBlobKeys,
  serializeProject,
  PROJECT_FILE_MAGIC,
} from "../serialize";
import { validateProject } from "../validate";
import { migrateDocument } from "../migrate";
import type { Mask, MediaAsset, ProjectDocument } from "@cutaway/types";

function imageAsset(id: string): MediaAsset {
  return {
    id,
    name: `${id}.png`,
    kind: "image",
    mimeType: "image/png",
    source: { type: "indexeddb", key: `${id}:source` },
    metadata: {
      durationSeconds: 0,
      frameRate: null,
      dimensions: { width: 100, height: 100 },
      hasAudio: false,
      hasVideo: true,
      codec: null,
      sampleRate: null,
      channels: null,
      byteSize: 10,
    },
    thumbnailKey: `${id}:thumb`,
    waveformKey: null,
    importedAt: 0,
  };
}

/** A project with one track, one media asset, and one clip wired together. */
function populatedProject(): ProjectDocument {
  const base = createProject("Test");
  const track = createTrack({ kind: "video", index: 0 });
  const asset = imageAsset("m1");
  const clip = createClip({
    trackId: track.id,
    startFrame: 10,
    durationFrames: 50,
    content: { kind: "image", mediaId: asset.id },
  });

  return {
    ...base,
    entities: {
      ...base.entities,
      tracks: { [track.id]: track },
      media: { [asset.id]: asset },
      clips: { [clip.id]: clip },
    },
    trackOrder: [track.id],
    durationFrames: 60,
  };
}

describe("round trip", () => {
  it("preserves the project exactly", () => {
    const project = populatedProject();
    const result = parseProjectFile(serializeProject(project));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.issues).toEqual([]);
    expect(result.project).toEqual(project);
  });

  it("preserves pen-tool mask handles and motion paths", () => {
    // `mask-engine` tessellates the polyline and ignores handles today, so
    // losing them is invisible until the next save rewrites the project
    // without them. Nothing consumes `motionPath` at all yet.
    const mask: Mask = {
      id: "mask-1",
      name: "Path mask",
      enabled: true,
      shape: {
        kind: "path",
        vertices: [
          { type: "static", value: { x: 10, y: 20 } },
          { type: "static", value: { x: 30, y: 40 } },
        ],
        handles: [
          { in: { x: -5, y: 0 }, out: { x: 5, y: 0 } },
          { in: { x: -5, y: 0 }, out: { x: 5, y: 0 } },
        ],
        closed: true,
      },
      mode: "add",
      feather: { type: "static", value: 0 },
      expand: { type: "static", value: 0 },
      opacity: { type: "static", value: 1 },
      inverted: false,
      motionPath: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        handles: [],
        closed: false,
        orientToPath: true,
        progress: { type: "static", value: 1 },
      },
    };

    const project = populatedProject();
    const clipId = Object.keys(project.entities.clips)[0]!;
    const withMask: ProjectDocument = {
      ...project,
      entities: {
        ...project.entities,
        clips: {
          [clipId]: { ...project.entities.clips[clipId]!, masks: [mask] },
        },
      },
    };

    const result = parseProjectFile(serializeProject(withMask));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.issues).toEqual([]);
    expect(result.project.entities.clips[clipId]!.masks).toEqual([mask]);
  });

  it("repairs unreadable mask handles and motion paths with an explicit issue", () => {
    const project = populatedProject();
    const clipId = Object.keys(project.entities.clips)[0]!;
    const clip = project.entities.clips[clipId]!;

    const { project: repaired, issues } = validateProject({
      ...project,
      entities: {
        ...project.entities,
        clips: {
          [clipId]: {
            ...clip,
            masks: [
              {
                id: "mask-1",
                shape: {
                  kind: "path",
                  vertices: [{ type: "static", value: { x: 1, y: 2 } }],
                  handles: [{ in: { x: 0, y: 0 }, out: "nope" }],
                  closed: true,
                },
                motionPath: { points: [{ x: 0, y: 0 }, "nope"], progress: "start" },
              },
            ],
          },
        },
      },
    });

    const mask = repaired.entities.clips[clipId]!.masks[0]!;
    expect(mask.shape).toEqual({
      kind: "path",
      vertices: [{ type: "static", value: { x: 1, y: 2 } }],
      handles: [{ in: { x: 0, y: 0 }, out: { x: 0, y: 0 } }],
      closed: true,
    });
    expect(mask.motionPath).toEqual({
      points: [{ x: 0, y: 0 }],
      handles: [],
      closed: false,
      orientToPath: false,
      progress: { type: "static", value: 1 },
    });
    expect(issues.some((i) => /unreadable handle/i.test(i.message))).toBe(true);
    expect(issues.some((i) => /motion path progress/i.test(i.message))).toBe(true);
  });

  it("writes a self-identifying, human-readable file", () => {
    const text = serializeProject(populatedProject());
    const parsed = JSON.parse(text);

    expect(parsed.magic).toBe(PROJECT_FILE_MAGIC);
    // Indented so the file diffs cleanly in git.
    expect(text).toContain("\n  ");
  });
});

describe("parseProjectFile", () => {
  it("rejects non-JSON", () => {
    const result = parseProjectFile("not json {{{");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/valid JSON/i);
  });

  it("rejects a JSON file that is not an Cutaway project", () => {
    const result = parseProjectFile(JSON.stringify({ magic: "something.else" }));
    expect(result.ok).toBe(false);
  });

  it("accepts a bare document with no envelope", () => {
    // Users hand-edit and paste these around; refusing one for lacking an
    // envelope would be pedantry.
    const result = parseProjectFile(JSON.stringify(populatedProject()));
    expect(result.ok).toBe(true);
  });

  it("never throws on arbitrary junk", () => {
    for (const input of ["null", "[]", "42", '"str"', "{}", '{"entities":null}']) {
      expect(() => parseProjectFile(input)).not.toThrow();
    }
  });
});

describe("validateProject repair", () => {
  it("drops clips referencing a missing track", () => {
    const project = populatedProject();
    const broken = {
      ...project,
      entities: {
        ...project.entities,
        clips: {
          ...project.entities.clips,
          ghost: {
            ...Object.values(project.entities.clips)[0]!,
            id: "ghost",
            trackId: "does-not-exist",
          },
        },
      },
    };

    const { project: repaired, issues } = validateProject(broken);

    expect(repaired.entities.clips.ghost).toBeUndefined();
    expect(issues.some((i) => i.subject === "clip:ghost" && i.severity === "dropped")).toBe(true);
  });

  it("drops clips referencing missing media", () => {
    const project = populatedProject();
    const broken = {
      ...project,
      entities: { ...project.entities, media: {} },
    };

    const { project: repaired, issues } = validateProject(broken);

    expect(Object.keys(repaired.entities.clips)).toHaveLength(0);
    expect(issues.some((i) => i.message.match(/missing media/i))).toBe(true);
  });

  it("appends tracks missing from the render order", () => {
    const project = populatedProject();
    const broken = { ...project, trackOrder: [] };

    const { project: repaired, issues } = validateProject(broken);

    // A track absent from the order would exist but never render.
    expect(repaired.trackOrder).toHaveLength(1);
    expect(issues.some((i) => i.severity === "repaired")).toBe(true);
  });

  it("removes duplicate and unknown ids from the render order", () => {
    const project = populatedProject();
    const trackId = project.trackOrder[0]!;
    const broken = { ...project, trackOrder: [trackId, trackId, "bogus"] };

    expect(validateProject(broken).project.trackOrder).toEqual([trackId]);
  });

  it("clamps negative and zero clip timing", () => {
    const project = populatedProject();
    const clipId = Object.keys(project.entities.clips)[0]!;
    const broken = {
      ...project,
      entities: {
        ...project.entities,
        clips: {
          [clipId]: {
            ...project.entities.clips[clipId]!,
            startFrame: -50,
            durationFrames: 0,
          },
        },
      },
    };

    const { project: repaired, issues } = validateProject(broken);
    const clip = repaired.entities.clips[clipId]!;

    expect(clip.startFrame).toBe(0);
    // A zero-length clip is unselectable and unrenderable.
    expect(clip.durationFrames).toBeGreaterThanOrEqual(1);
    expect(issues.some((i) => i.severity === "repaired")).toBe(true);
  });

  it("rejects a zero resolution that would break the preview", () => {
    const project = populatedProject();
    const broken = {
      ...project,
      settings: { ...project.settings, resolution: { width: 0, height: 0 } },
    };

    const { project: repaired } = validateProject(broken);
    expect(repaired.settings.resolution.width).toBeGreaterThan(0);
    expect(repaired.settings.resolution.height).toBeGreaterThan(0);
  });

  it("falls back to an empty project for non-object input", () => {
    const { project, issues } = validateProject("nonsense");
    expect(project.schemaVersion).toBe(SCHEMA_VERSION);
    expect(issues[0]!.severity).toBe("dropped");
  });

  it("recomputes duration from the surviving clips", () => {
    const project = populatedProject();
    const lying = { ...project, durationFrames: 999_999 };

    expect(validateProject(lying).project.durationFrames).toBe(60);
  });

  it("rejects ids that only resolve through the prototype chain", () => {
    // `tracks["constructor"]` is `Object`, `media["toString"]` is a function, so
    // a truthiness check keeps a clip whose track and media do not exist.
    const { project: repaired, issues } = validateProject({
      schemaVersion: SCHEMA_VERSION,
      trackOrder: ["constructor", "__proto__", "t1", "hasOwnProperty"],
      entities: {
        tracks: { t1: { id: "t1", kind: "video" } },
        media: { m1: { id: "m1", source: { type: "indexeddb", key: "k" } } },
        clips: {
          good: {
            id: "good",
            trackId: "t1",
            startFrame: 0,
            durationFrames: 5,
            content: { kind: "image", mediaId: "m1" },
          },
          phantomTrack: {
            id: "phantomTrack",
            trackId: "constructor",
            startFrame: 0,
            durationFrames: 5,
            content: { kind: "image", mediaId: "m1" },
          },
          phantomProto: {
            id: "phantomProto",
            trackId: "__proto__",
            startFrame: 0,
            durationFrames: 5,
            content: { kind: "image", mediaId: "m1" },
          },
          phantomMedia: {
            id: "phantomMedia",
            trackId: "t1",
            startFrame: 0,
            durationFrames: 5,
            content: { kind: "image", mediaId: "toString" },
          },
        },
        captionTracks: {
          ct: {
            id: "ct",
            sourceMediaId: "hasOwnProperty",
            language: "en",
            presetId: "core.captions.tiktok",
            blocks: [],
          },
        },
      },
    });

    expect(repaired.trackOrder).toEqual(["t1"]);
    expect(Object.keys(repaired.entities.clips)).toEqual(["good"]);
    expect(repaired.entities.captionTracks.ct!.sourceMediaId).toBeNull();

    for (const id of ["phantomTrack", "phantomProto", "phantomMedia"]) {
      expect(issues.some((i) => i.severity === "dropped" && i.subject === `clip:${id}`)).toBe(true);
    }
  });
});

describe("validateProject totality on malformed JSON", () => {
  it("rebuilds a clip whose transform and appearance are missing", () => {
    const project = populatedProject();
    const clipId = Object.keys(project.entities.clips)[0]!;

    const partial: Record<string, unknown> = { ...project.entities.clips[clipId]! };
    delete partial.transform;
    delete partial.appearance;

    const { project: repaired, issues } = validateProject({
      ...project,
      entities: { ...project.entities, clips: { [clipId]: partial } },
    });

    const clip = repaired.entities.clips[clipId]!;
    expect(clip.transform.position).toEqual({ type: "static", value: { x: 0, y: 0 } });
    expect(clip.transform.anchor).toEqual({ type: "static", value: { x: 0.5, y: 0.5 } });
    expect(clip.appearance.opacity).toEqual({ type: "static", value: 1 });
    expect(clip.appearance.shadow.blur).toEqual({ type: "static", value: 12 });
    expect(issues.some((i) => i.severity === "repaired")).toBe(true);
  });

  it("replaces an animated property whose keyframes are all unusable", () => {
    const project = populatedProject();
    const clipId = Object.keys(project.entities.clips)[0]!;
    const clip = project.entities.clips[clipId]!;

    const { project: repaired } = validateProject({
      ...project,
      entities: {
        ...project.entities,
        clips: {
          [clipId]: {
            ...clip,
            appearance: {
              ...clip.appearance,
              opacity: { type: "animated", keyframes: [{ frame: "nope", value: 1 }] },
            },
          },
        },
      },
    });

    // An animated value with zero usable keyframes throws in `evaluate`, so it
    // must be collapsed to a static value rather than kept.
    expect(repaired.entities.clips[clipId]!.appearance.opacity).toEqual({
      type: "static",
      value: 1,
    });
  });

  it("resets a null mask list and drops a null mask entry", () => {
    const project = populatedProject();
    const clipId = Object.keys(project.entities.clips)[0]!;
    const clip = project.entities.clips[clipId]!;

    const nullList = validateProject({
      ...project,
      entities: { ...project.entities, clips: { [clipId]: { ...clip, masks: null } } },
    });
    expect(nullList.project.entities.clips[clipId]!.masks).toEqual([]);
    expect(nullList.issues.some((i) => /mask list/i.test(i.message))).toBe(true);

    const nullEntry = validateProject({
      ...project,
      entities: { ...project.entities, clips: { [clipId]: { ...clip, masks: [null] } } },
    });
    expect(nullEntry.project.entities.clips[clipId]!.masks).toEqual([]);
    expect(nullEntry.issues.some((i) => i.severity === "dropped")).toBe(true);
  });

  it("fills in missing media metadata instead of leaving the panel to crash", () => {
    const project = populatedProject();
    const asset = project.entities.media.m1!;

    const { project: repaired, issues } = validateProject({
      ...project,
      entities: { ...project.entities, media: { m1: { ...asset, metadata: undefined } } },
    });

    expect(repaired.entities.media.m1!.metadata).toEqual({
      durationSeconds: 0,
      frameRate: null,
      dimensions: null,
      hasAudio: false,
      hasVideo: false,
      codec: null,
      sampleRate: null,
      channels: null,
      byteSize: 0,
    });
    expect(issues.some((i) => i.subject === "media:m1" && i.severity === "repaired")).toBe(true);
    expect(() => referencedBlobKeys(repaired)).not.toThrow();
  });

  it("repairs malformed caption tracks and blocks", () => {
    const project = createProject();

    const { project: repaired, issues } = validateProject({
      ...project,
      entities: {
        ...project.entities,
        captionTracks: {
          good: {
            id: "good",
            sourceMediaId: null,
            language: "en",
            presetId: "core.captions.tiktok",
            blocks: [
              {
                id: "b1",
                words: [{ text: "hello", startFrame: 0, endFrame: 5, confidence: 0.9 }],
                startFrame: 0,
                endFrame: 5,
                styleOverrideId: null,
              },
            ],
          },
          gone: null,
          notBlocks: { id: "notBlocks", blocks: "nope" },
          nullBlock: { id: "nullBlock", blocks: [null] },
        },
      },
    });

    expect(repaired.entities.captionTracks.gone).toBeUndefined();
    expect(repaired.entities.captionTracks.notBlocks!.blocks).toEqual([]);
    expect(repaired.entities.captionTracks.nullBlock!.blocks).toEqual([]);
    expect(repaired.entities.captionTracks.good!.blocks[0]!.words[0]!.text).toBe("hello");
    expect(issues.some((i) => i.severity === "dropped")).toBe(true);
  });

  it("loads a caption block with more words than a spread could carry", () => {
    // The end-of-block fallback used to be `Math.max(...words.map(…))`, which is
    // evaluated eagerly and throws a RangeError once the argument limit is hit —
    // failing the whole load for one oversized block. A full transcript in one
    // block is a real shape, not a hostile one.
    const wordCount = 150_000;
    const words = Array.from({ length: wordCount }, (_value, index) => ({
      text: `w${index}`,
      startFrame: index,
      endFrame: index + 1,
      confidence: 1,
    }));

    const project = createProject();
    const { project: repaired, issues } = validateProject({
      ...project,
      entities: {
        ...project.entities,
        captionTracks: {
          big: {
            id: "big",
            sourceMediaId: null,
            language: "en",
            presetId: "core.captions.tiktok",
            // No `endFrame`: the last word supplies it.
            blocks: [{ id: "b1", words, startFrame: 0, styleOverrideId: null }],
          },
        },
      },
    });

    const block = repaired.entities.captionTracks.big!.blocks[0]!;
    expect(block.words).toHaveLength(wordCount);
    expect(block.endFrame).toBe(wordCount);
    expect(issues).toEqual([]);
  });

  it("never throws and always returns a render-safe project for arbitrary junk", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      0,
      "x",
      [],
      { entities: null },
      { entities: { clips: null, tracks: null, media: null, markers: null, captionTracks: null } },
      { entities: { clips: { c: null }, tracks: { t: null }, media: { m: 3 } } },
      {
        schemaVersion: "x",
        settings: { resolution: { width: 0, height: -1 }, frameRate: 0 },
        entities: {
          tracks: { t1: { id: "t1" } },
          media: { m1: { id: "m1", source: { type: "indexeddb", key: "k" } } },
          clips: {
            c1: {
              id: "c1",
              trackId: "t1",
              startFrame: 0,
              durationFrames: 5,
              content: { kind: "text" },
            },
          },
        },
      },
    ];

    for (const input of inputs) {
      expect(() => validateProject(input)).not.toThrow();

      const { project } = validateProject(input);
      expect(project.settings.resolution.width).toBeGreaterThan(0);
      expect(project.settings.resolution.height).toBeGreaterThan(0);

      for (const clip of Object.values(project.entities.clips)) {
        expect(Array.isArray(clip.masks)).toBe(true);
        expect(Array.isArray(clip.effects)).toBe(true);
        expect(clip.transform.position).toBeDefined();
        expect(clip.appearance.opacity).toBeDefined();
      }

      for (const asset of Object.values(project.entities.media)) {
        expect(asset.metadata).toBeDefined();
        expect(typeof asset.metadata.byteSize).toBe("number");
      }

      for (const track of Object.values(project.entities.captionTracks)) {
        expect(Array.isArray(track.blocks)).toBe(true);
      }
    }
  });
});

describe("parseProjectFile malformed documents", () => {
  it("repairs a deeply malformed document instead of failing the load", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      settings: { resolution: { width: 640, height: 360 }, frameRate: 30 },
      entities: {
        tracks: { t1: { id: "t1" } },
        media: { m1: { id: "m1", source: { type: "indexeddb", key: "k" } } },
        clips: {
          c1: {
            id: "c1",
            trackId: "t1",
            startFrame: 0,
            durationFrames: 10,
            content: { kind: "image", mediaId: "m1" },
          },
        },
      },
    });

    const result = parseProjectFile(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.project.entities.clips.c1!.transform.rotation).toEqual({
      type: "static",
      value: 0,
    });
    expect(result.project.entities.media.m1!.metadata.byteSize).toBe(0);
    expect(result.project.entities.captionTracks).toEqual({});
  });
});

describe("migrateDocument", () => {
  it("stamps the current version on an unversioned document", () => {
    expect(migrateDocument({}).document.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("flags documents from a newer build instead of downgrading them", () => {
    const result = migrateDocument({ schemaVersion: SCHEMA_VERSION + 5 });
    expect(result.fromFuture).toBe(true);
  });

  it("leaves a current document untouched", () => {
    const result = migrateDocument({ schemaVersion: SCHEMA_VERSION, name: "x" });
    expect(result.applied).toEqual([]);
    expect(result.document.name).toBe("x");
  });
});

describe("referencedBlobKeys", () => {
  it("collects source, thumbnail, and waveform keys", () => {
    const keys = referencedBlobKeys(populatedProject());
    expect(keys.has("m1:source")).toBe(true);
    expect(keys.has("m1:thumb")).toBe(true);
  });

  it("is empty for a project with no media", () => {
    expect(referencedBlobKeys(createProject()).size).toBe(0);
  });
});

describe("projectFileName", () => {
  it("produces a filesystem-safe name", () => {
    // Disallowed characters are stripped, then whitespace runs collapse to a
    // single dash — so "/ " does not leave a double dash behind.
    expect(projectFileName("My Video / 2026!")).toBe("My-Video-2026.cutaway");
    expect(projectFileName("   ")).toBe("untitled.cutaway");
  });
});

describe("serialization safety", () => {
  it("survives a project containing an animated property", () => {
    const project = populatedProject();
    const clipId = Object.keys(project.entities.clips)[0]!;
    const animated: ProjectDocument = {
      ...project,
      entities: {
        ...project.entities,
        clips: {
          [clipId]: {
            ...project.entities.clips[clipId]!,
            appearance: {
              ...project.entities.clips[clipId]!.appearance,
              opacity: {
                type: "animated",
                keyframes: [
                  { frame: 0, value: 0, easing: { kind: "linear" } },
                  {
                    frame: 30,
                    value: 1,
                    easing: { kind: "spring", stiffness: 180, damping: 12, mass: 1 },
                  },
                ],
              },
            },
          },
        },
      },
    };

    const result = parseProjectFile(serializeProject(animated));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.project).toEqual(animated);
  });

  it("keeps static values intact", () => {
    const value = staticValue({ x: 1, y: 2 });
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
});
