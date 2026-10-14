import { describe, expect, it } from "vitest";
import {
  DESKTOP_CONTENT_TYPES,
  type ExportSettings,
  type ProjectDocument,
  type ProjectEntities,
} from "@cutaway/types";
import {
  ExportPlanError,
  describeExport,
  frameDurationMicros,
  frameTimestampMicros,
  planExport,
} from "../plan";

const settings = (over: Partial<ExportSettings> = {}): ExportSettings => ({
  format: "mp4",
  resolution: { width: 1920, height: 1080 },
  frameRate: 30,
  videoBitrate: 8_000_000,
  audioBitrate: 192_000,
  videoCodec: "h264",
  audioCodec: "aac",
  range: null,
  ...over,
});

/**
 * A project with one visible video clip spanning the whole timeline — the
 * ordinary case. `planExport` inspects clips to reject empty renders and the
 * document's own frame rate to reject a mismatched export, so a bare
 * `{ durationFrames }` stub is no longer a valid document.
 */
const project = (
  durationFrames: number,
  over: Partial<ProjectEntities> = {},
  frameRate = 30,
): ProjectDocument =>
  ({
    durationFrames,
    settings: {
      resolution: { width: 1920, height: 1080 },
      aspectRatio: "16:9",
      frameRate,
      backgroundColor: "#000000",
      sampleRate: 48000,
    },
    entities: {
      clips: {
        c1: {
          id: "c1",
          trackId: "t1",
          startFrame: 0,
          durationFrames,
          hidden: false,
          content: { kind: "media", mediaId: "m1", mediaKind: "video" },
        },
      },
      tracks: { t1: { id: "t1", kind: "video", hidden: false } },
      captionTracks: {},
      ...over,
    },
  }) as unknown as ProjectDocument;

/** A project whose timeline is empty — nothing to render at any frame. */
const emptyProject = (durationFrames: number): ProjectDocument =>
  project(durationFrames, { clips: {} });

/** A Desktop Stage plugin clip spanning the whole range. */
const pluginClip = (id: string, trackId: string, contentType: string) => ({
  id,
  trackId,
  startFrame: 0,
  durationFrames: 150,
  hidden: false,
  content: { kind: "plugin", contentType, data: {} },
});

/** Overwrites a test document's clip and track tables with desktop content. */
function withDesktopEntities(
  doc: ProjectDocument,
  clips: Record<string, unknown>,
  tracks: Record<string, unknown>,
): ProjectDocument {
  const entities = doc.entities as unknown as {
    clips: Record<string, unknown>;
    tracks: Record<string, unknown>;
  };
  entities.clips = clips;
  entities.tracks = tracks;
  return doc;
}

/** One app window and one action clip, each on its own track. */
function desktopProject(desktopTrackHidden: boolean): ProjectDocument {
  return withDesktopEntities(
    project(150),
    {
      w1: pluginClip("w1", "t-desktop", DESKTOP_CONTENT_TYPES.app),
      a1: pluginClip("a1", "t-action", DESKTOP_CONTENT_TYPES.action),
    },
    {
      "t-desktop": { id: "t-desktop", kind: "desktop", hidden: desktopTrackHidden },
      "t-action": { id: "t-action", kind: "action", hidden: false },
    },
  );
}

describe("planExport — nonvisual desktop content", () => {
  it("refuses a range left black because only actions remain visible", () => {
    // Hiding the window track leaves the action visible. The renderer would visit
    // that clip and draw nothing, so the range must not pass as "has content".
    expect(() => planExport(desktopProject(true), settings())).toThrow(/no clips/i);
  });

  it("refuses a project that contains nothing but desktop actions", () => {
    const doc = withDesktopEntities(
      project(150),
      { a1: pluginClip("a1", "t-action", DESKTOP_CONTENT_TYPES.action) },
      { "t-action": { id: "t-action", kind: "action", hidden: false } },
    );

    expect(() => planExport(doc, settings())).toThrow(/no clips/i);
  });

  it("still counts a visible app window as picture", () => {
    expect(planExport(desktopProject(false), settings()).warnings).toEqual([]);
  });
});

describe("planExport — empty renders", () => {
  it("refuses a range with no clips at all rather than rendering a blank file", () => {
    expect(() => planExport(emptyProject(150), settings())).toThrow(ExportPlanError);
    expect(() => planExport(emptyProject(150), settings())).toThrow(/no clips/i);
  });

  it("refuses a sub-range that falls entirely outside every clip", () => {
    // One clip covering 0..50, exporting 100..150 — geometrically valid, empty.
    const doc = project(50);
    (doc as unknown as { durationFrames: number }).durationFrames = 200;
    expect(() => planExport(doc, settings({ range: { start: 100, end: 150 } }))).toThrow(
      /no clips/i,
    );
  });

  it("refuses when the only clip is hidden", () => {
    const doc = project(150);
    const clips = doc.entities.clips as Record<string, { hidden: boolean }>;
    clips.c1!.hidden = true;
    expect(() => planExport(doc, settings())).toThrow(/no clips/i);
  });

  it("refuses when the only clip sits on a hidden track", () => {
    const doc = project(150);
    const tracks = doc.entities.tracks as Record<string, { hidden: boolean }>;
    tracks.t1!.hidden = true;
    expect(() => planExport(doc, settings())).toThrow(/no clips/i);
  });

  it("allows an audio-only range but warns that the picture will be black", () => {
    const doc = project(150, {
      clips: {
        a1: {
          id: "a1",
          trackId: "t1",
          startFrame: 0,
          durationFrames: 150,
          hidden: false,
          content: { kind: "audio", mediaId: "m1" },
        },
      } as never,
    });
    const plan = planExport(doc, settings());
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/black/i);
  });

  it("allows a caption-only range — captions draw something", () => {
    const doc = project(150, {
      clips: {},
      captionTracks: {
        ct1: { blocks: [{ startFrame: 10, endFrame: 40 }] },
      } as never,
    });
    expect(() => planExport(doc, settings())).not.toThrow();
  });

  it("reports no warnings for an ordinary export with visible clips", () => {
    expect(planExport(project(150), settings()).warnings).toEqual([]);
  });
});

describe("planExport", () => {
  it("plans the full timeline when no range is set", () => {
    const plan = planExport(project(150), settings());
    expect(plan.startFrame).toBe(0);
    expect(plan.endFrame).toBe(150);
    expect(plan.totalFrames).toBe(150);
    expect(plan.durationSeconds).toBeCloseTo(5);
  });

  it("honours an explicit range", () => {
    const plan = planExport(project(300), settings({ range: { start: 30, end: 90 } }));
    expect(plan.totalFrames).toBe(60);
    expect(plan.durationSeconds).toBeCloseTo(2);
  });

  it("rejects an empty timeline", () => {
    expect(() => planExport(project(0), settings())).toThrow(ExportPlanError);
  });

  it("rejects a zero-length or inverted range", () => {
    expect(() => planExport(project(300), settings({ range: { start: 50, end: 50 } }))).toThrow(
      ExportPlanError,
    );
    expect(() => planExport(project(300), settings({ range: { start: 90, end: 30 } }))).toThrow(
      ExportPlanError,
    );
  });

  it("rejects odd dimensions that codecs cannot encode", () => {
    expect(() =>
      planExport(project(30), settings({ resolution: { width: 1921, height: 1080 } })),
    ).toThrow(/even/);
  });

  it("rejects a non-positive frame rate", () => {
    expect(() => planExport(project(30), settings({ frameRate: 0 }))).toThrow(ExportPlanError);
  });

  it("rejects an export rate that differs from the project's", () => {
    expect(() => planExport(project(150), settings({ frameRate: 60 }))).toThrow(ExportPlanError);
    expect(() => planExport(project(150), settings({ frameRate: 60 }))).toThrow(/match the project/i);
  });

  it("accepts the project's own rate and keeps the duration right", () => {
    const plan = planExport(project(150, {}, 30), settings({ frameRate: 30 }));

    expect(plan.frameRate).toBe(30);
    expect(plan.durationSeconds).toBeCloseTo(5);
  });

  it("keeps a non-30 project's duration in its own rate", () => {
    // 25 fps is the reason the check compares to the project rather than
    // demanding a fixed rate: a 100-frame project is 4 seconds, not 3.33.
    const plan = planExport(project(100, {}, 25), settings({ frameRate: 25 }));

    expect(plan.durationSeconds).toBeCloseTo(4);
  });

  it("carries codec and bitrate settings into the plan", () => {
    const plan = planExport(project(30), settings({ videoCodec: "vp9", videoBitrate: 12_000_000 }));
    expect(plan.videoCodec).toBe("vp9");
    expect(plan.videoBitrate).toBe(12_000_000);
  });
});

describe("frame timing", () => {
  it("derives timestamps from the index so they never drift", () => {
    const plan = planExport(project(90), settings({ frameRate: 30 }));
    expect(frameTimestampMicros(plan, 0)).toBe(0);
    expect(frameTimestampMicros(plan, 30)).toBe(1_000_000);
    expect(frameTimestampMicros(plan, 90)).toBe(3_000_000);
  });

  it("computes a nominal frame duration", () => {
    const plan = planExport(project(90, {}, 25), settings({ frameRate: 25 }));
    expect(frameDurationMicros(plan)).toBe(40_000);
  });
});

describe("describeExport", () => {
  it("summarises size, rate, duration, and frame count", () => {
    const plan = planExport(project(150), settings());
    expect(describeExport(plan)).toBe("1920×1080 · 30 fps · 0:05 · 150 frames");
  });
});
