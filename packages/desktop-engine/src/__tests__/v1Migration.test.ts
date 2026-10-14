import { describe, expect, it } from "vitest";
import { evaluate } from "@cutaway/animation-engine";
import { DESKTOP_CONTENT_TYPES } from "@cutaway/types";
import type { DesktopAppPayload, ProjectDocument } from "@cutaway/types";
import { convertV1Project, convertV1ProjectChecked, v1TimeToFrame } from "../migrateV1";
import { createStarterProject, starterV1Project } from "../starterProject";
import { isV1Project } from "../v1";
import { parseDesktopContent } from "../project";
import type { V1Project } from "../v1-types";

function appPayloads(project: ProjectDocument): DesktopAppPayload[] {
  return Object.values(project.entities.clips).map((clip) => {
    if (clip.content.kind !== "plugin") throw new Error("expected plugin content");
    const parsed = parseDesktopContent(clip.content.contentType, clip.content.data);
    if (!parsed.ok || parsed.family !== "app") throw new Error("expected an app payload");
    return parsed.payload as DesktopAppPayload;
  });
}

/** The bundled fixture with one window animated, for motion assertions. */
function animatedFixture(): V1Project {
  const fixture = starterV1Project();
  return {
    ...fixture,
    keyframes: {
      code: [
        {
          time: 0,
          values: { x: 0, y: 0, width: 100, height: 100, opacity: 1, scale: 1 },
        },
        {
          time: 1000,
          values: { x: 200, y: 100, width: 200, height: 100, opacity: 0.5, scale: 1 },
        },
      ],
    },
  };
}

function clipFor(project: ProjectDocument, instanceId: string) {
  const clip = Object.values(project.entities.clips).find((candidate) => {
    if (candidate.content.kind !== "plugin") return false;
    const parsed = parseDesktopContent(candidate.content.contentType, candidate.content.data);
    return parsed.ok && (parsed.payload as { instanceId?: string }).instanceId === instanceId;
  });

  if (!clip) throw new Error(`no clip for ${instanceId}`);
  return clip;
}

describe("v1TimeToFrame", () => {
  it("rounds milliseconds to 30 fps frames", () => {
    expect(v1TimeToFrame(0)).toBe(0);
    expect(v1TimeToFrame(33)).toBe(1);
    expect(v1TimeToFrame(1000)).toBe(30);
  });

  it("clamps the last frame of the 20-second timeline", () => {
    // Frame 600 does not exist: the range is half-open `[0, 600)`.
    expect(v1TimeToFrame(20_000)).toBe(599);
    expect(v1TimeToFrame(99_999)).toBe(599);
    expect(v1TimeToFrame(-500)).toBe(0);
  });

  it("survives non-finite input", () => {
    expect(v1TimeToFrame(Number.NaN)).toBe(0);
  });
});

describe("convertV1Project", () => {
  it("accepts the bundled fixture", () => {
    expect(isV1Project(starterV1Project())).toBe(true);
  });

  it("is deterministic", () => {
    const first = convertV1Project(starterV1Project());
    const second = convertV1Project(starterV1Project());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.id).toBe("project-desktop-stage-v1");
    expect(first.createdAt).toBe(0);
  });

  it("keeps the four starter windows as app clips on a desktop track", () => {
    const project = convertV1Project(starterV1Project());
    const desktopTrack = project.entities.tracks["track-desktop"]!;

    expect(desktopTrack.kind).toBe("desktop");
    expect(project.entities.tracks["track-action"]!.kind).toBe("action");
    expect(Object.keys(project.entities.clips)).toHaveLength(4);

    for (const clip of Object.values(project.entities.clips)) {
      expect(clip.trackId).toBe("track-desktop");
      expect(clip.startFrame).toBe(0);
      expect(clip.durationFrames).toBe(600);
    }
  });

  it("gives every clip a stable, unique id derived from the window", () => {
    const ids = Object.keys(convertV1Project(starterV1Project()).entities.clips).sort();
    expect(ids).toEqual(["clip-app-browser", "clip-app-chat", "clip-app-code", "clip-app-terminal"]);
  });

  it("maps window kinds without inventing app behaviour", () => {
    const payloads = appPayloads(convertV1Project(starterV1Project()));
    const byInstance = new Map(payloads.map((payload) => [payload.instanceId, payload]));

    expect(byInstance.get("app-code")!.appKind).toBe("code");
    // The starter scene's terminal is the one code window the prototype named.
    expect(byInstance.get("app-terminal")!.appKind).toBe("terminal");
    expect(byInstance.get("app-browser")!.appKind).toBe("browser");
    // A free-text note is not guessed to be a chat client.
    expect(byInstance.get("app-chat")!.appKind).toBe("legacyText");
  });

  it("preserves titles, text, accent colours, and relative z-order", () => {
    const payloads = appPayloads(convertV1Project(starterV1Project()));
    const byInstance = new Map(payloads.map((payload) => [payload.instanceId, payload]));

    expect(byInstance.get("app-browser")!.title).toBe("Studio Dashboard");
    expect(byInstance.get("app-browser")!.look.accentColor).toBe("#fa9d4c");
    expect(byInstance.get("app-chat")!.lines[0]).toBe("M. Boss  — check it out ✨");

    const zOrder = payloads
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((payload) => payload.instanceId);

    expect(zOrder).toEqual(["app-code", "app-chat", "app-terminal", "app-browser"]);
  });

  it("converts top-left window geometry into composition-space centre and scale", () => {
    const project = convertV1Project(starterV1Project());
    const browser = clipFor(project, "app-browser");

    // 520 × 200 window of 380 × 285 inside a 1000 × 600 stage.
    expect(evaluate(browser.transform.position, 0)).toEqual({ x: 210, y: 42.5 });
    expect(evaluate(browser.transform.scale, 0)).toEqual({ x: 1, y: 1 });
    expect(evaluate(browser.appearance.opacity, 0)).toBe(1);
  });

  it("animates position, size, and opacity from milliseconds to frames", () => {
    const project = convertV1Project(animatedFixture());
    const code = clipFor(project, "app-code");

    expect(code.transform.position.type).toBe("animated");
    expect(code.transform.scale.type).toBe("animated");
    expect(code.appearance.opacity.type).toBe("animated");

    // First keyframe: 100 × 100 at (0, 0) → centre (-450, -250).
    expect(evaluate(code.transform.position, 0)).toEqual({ x: -450, y: -250 });
    // Second keyframe at 1000 ms → frame 30: 200 × 100 at (200, 100) → (-200, -150).
    expect(evaluate(code.transform.position, 30)).toEqual({ x: -200, y: -150 });
    // Size animation is carried as a scale relative to the first keyframe.
    expect(evaluate(code.transform.scale, 30)).toEqual({ x: 2, y: 1 });
    expect(evaluate(code.appearance.opacity, 30)).toBe(0.5);

    // Midpoint: the prototype's smoothstep is symmetric, so this is the centre.
    expect(evaluate(code.transform.position, 15).x).toBeCloseTo(-325, 6);
    expect(evaluate(code.transform.position, 15).y).toBeCloseTo(-200, 6);
  });

  it("clamps end-of-timeline keyframes and keeps the later of two that collide", () => {
    const fixture = starterV1Project();
    const project = convertV1Project({
      ...fixture,
      keyframes: {
        code: [
          { time: 0, values: { x: 0, y: 0, width: 100, height: 100, opacity: 1, scale: 1 } },
          { time: 20_000, values: { x: 100, y: 0, width: 100, height: 100, opacity: 1, scale: 1 } },
          // 20_000 ms and 20_400 ms both round past the last frame, so both
          // clamp to 599; the later prototype keyframe wins.
          { time: 20_400, values: { x: 200, y: 0, width: 100, height: 100, opacity: 1, scale: 1 } },
        ],
      },
    });
    const code = clipFor(project, "app-code");
    const position = code.transform.position;

    expect(position.type).toBe("animated");
    if (position.type !== "animated") return;

    expect(position.keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 599]);
    // 100 × 100 at x = 200: centre-of-composition is (200 + 50 − 500, 0 + 50 − 300).
    expect(position.keyframes[1]!.value).toEqual({ x: -250, y: -250 });
  });

  it("reproduces the prototype's smoothstep easing exactly", () => {
    const project = convertV1Project(animatedFixture());
    const code = clipFor(project, "app-code");

    // smoothstep(0.25) = 0.15625; the migrated curve is the same cubic bezier,
    // so a quarter of the way through the segment reaches the same place.
    const start = evaluate(code.transform.position, 0);
    const end = evaluate(code.transform.position, 30);
    const quarter = evaluate(code.transform.position, 7.5);

    expect(quarter.x).toBeCloseTo(start.x + (end.x - start.x) * 0.15625, 5);
  });

  it("ignores prototype window values when keyframes exist, as the prototype did", () => {
    const project = convertV1Project(animatedFixture());
    const code = clipFor(project, "app-code");

    // The fixture's `code` window sits at 82,102 with no keyframe saying so.
    expect(evaluate(code.transform.position, 0)).not.toEqual({ x: -243, y: -43 });
    expect(evaluate(code.transform.position, 0)).toEqual({ x: -450, y: -250 });
  });

  it("keeps the authored frame rate and duration", () => {
    const project = convertV1Project(starterV1Project());
    expect(project.settings.frameRate).toBe(30);
    expect(project.settings.resolution).toEqual({ width: 1000, height: 600 });
    expect(project.durationFrames).toBe(600);
  });

  it("reports a reason instead of converting junk", () => {
    expect(convertV1ProjectChecked({ version: 2 }).ok).toBe(false);
    expect(convertV1ProjectChecked(null).ok).toBe(false);
  });
});

describe("prototype-chain safety", () => {
  it("treats a window id that shadows a prototype member as having no keyframes", () => {
    const fixture = starterV1Project();
    const hostile: V1Project = {
      version: 1,
      windows: [{ ...fixture.windows[0]!, id: "constructor" }],
      keyframes: {},
    };

    expect(isV1Project(hostile)).toBe(true);
    // `keyframes["constructor"]` resolves to Object.prototype.constructor unless
    // the lookup is guarded; the converter would then iterate a function.
    expect(() => convertV1Project(hostile)).not.toThrow();

    const clip = Object.values(convertV1Project(hostile).entities.clips)[0]!;
    expect(clip.transform.position.type).toBe("static");
  });

  it("still reads an own keyframe entry whose id shadows a prototype member", () => {
    const fixture = starterV1Project();
    const values = { x: 0, y: 0, width: 100, height: 100, opacity: 1, scale: 1 };
    const project: V1Project = {
      version: 1,
      windows: [{ ...fixture.windows[0]!, id: "constructor" }],
      keyframes: {
        constructor: [
          { time: 0, values },
          { time: 1000, values: { ...values, x: 200 } },
        ],
      },
    };

    const clip = Object.values(convertV1Project(project).entities.clips)[0]!;
    expect(clip.transform.position.type).toBe("animated");
  });
});

describe("createStarterProject", () => {
  it("contains the converted windows plus authored action clips", () => {
    const project = createStarterProject();

    expect(project.name).toBe("Desktop Stage starter");
    expect(project.durationFrames).toBe(600);
    expect(project.entities.tracks["track-desktop"]!.kind).toBe("desktop");
    expect(project.entities.tracks["track-action"]!.kind).toBe("action");

    const actionClips = Object.values(project.entities.clips).filter(
      (clip) => clip.content.kind === "plugin" && clip.content.contentType === DESKTOP_CONTENT_TYPES.action,
    );

    expect(actionClips).toHaveLength(3);
  });

  it("returns a fresh object each call", () => {
    expect(createStarterProject()).not.toBe(createStarterProject());
  });
});
