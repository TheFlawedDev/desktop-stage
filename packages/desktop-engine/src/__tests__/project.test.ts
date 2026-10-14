import { describe, expect, it } from "vitest";
import { DESKTOP_CONTENT_TYPES } from "@cutaway/types";
import {
  createAppClip,
  createDesktopProject,
  createDesktopTrack,
  desktopFamilyFor,
  expectedTrackKind,
  isDesktopContentType,
  isKnownDesktopContentType,
  parseDesktopContent,
  splitContentType,
  trackKindsForFamily,
} from "../project";

function appData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    instanceId: "app-one",
    appKind: "browser",
    title: "Docs",
    lines: ["first line", ""],
    size: { width: 100, height: 80 },
    look: {
      accentColor: "#5ca9ff",
      theme: "dark",
      chrome: "window",
      cornerRadius: 8,
      showTitleBar: true,
    },
    zIndex: 2,
    initiallyVisible: true,
    ...overrides,
  };
}

describe("content type recognition", () => {
  it("identifies Desktop Stage types", () => {
    expect(isDesktopContentType(DESKTOP_CONTENT_TYPES.app)).toBe(true);
    expect(isDesktopContentType("cutaway/text")).toBe(false);
    expect(isKnownDesktopContentType(DESKTOP_CONTENT_TYPES.action)).toBe(true);
    expect(isKnownDesktopContentType("desktop-stage/app@2")).toBe(false);
  });

  it("splits family from version", () => {
    expect(splitContentType("desktop-stage/app@1")).toEqual({ base: "desktop-stage/app", version: 1 });
    expect(splitContentType("desktop-stage/app")).toEqual({ base: "desktop-stage/app", version: null });
    expect(splitContentType("desktop-stage/app@nope")).toEqual({
      base: "desktop-stage/app",
      version: null,
    });
  });

  it("maps families to their rows", () => {
    expect(desktopFamilyFor(DESKTOP_CONTENT_TYPES.camera)).toBe("camera");
    expect(desktopFamilyFor("desktop-stage/other@1")).toBeNull();

    expect(expectedTrackKind("app")).toBe("desktop");
    // The three camera rows share one payload family.
    expect(trackKindsForFamily("camera")).toEqual(["camera", "camera-effect", "lens"]);
    expect(trackKindsForFamily("app")).toEqual(["desktop"]);
  });
});

describe("parseDesktopContent", () => {
  it("accepts a well-formed app payload", () => {
    const result = parseDesktopContent(DESKTOP_CONTENT_TYPES.app, appData());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.family).toBe("app");
    expect(result.payload).toMatchObject({ instanceId: "app-one", appKind: "browser" });
  });

  it("reports an unsupported version instead of guessing", () => {
    const result = parseDesktopContent("desktop-stage/app@2", appData());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("unsupported-version");
    expect(result.message).toMatch(/version 2/);
  });

  it("treats an unversioned type as unsupported rather than as current", () => {
    const result = parseDesktopContent("desktop-stage/app", appData());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("unsupported-version");
  });

  it("rejects content types outside the extension and unknown families", () => {
    expect(parseDesktopContent("cutaway/text", {})).toMatchObject({ ok: false, code: "unknown-type" });
    expect(parseDesktopContent("desktop-stage/teleporter@1", {})).toMatchObject({
      ok: false,
      code: "unknown-type",
    });
  });

  it("rejects non-finite geometry and unknown app kinds", () => {
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.app, appData({ size: { width: Number.NaN, height: 80 } }))).toMatchObject({ ok: false, code: "malformed" });
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.app, appData({ appKind: "spreadsheet" }))).toMatchObject({ ok: false, code: "malformed" });
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.app, appData({ zIndex: Number.POSITIVE_INFINITY }))).toMatchObject({ ok: false, code: "malformed" });
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.app, appData({ lines: ["ok", 3] }))).toMatchObject({ ok: false, code: "malformed" });
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.app, null)).toMatchObject({ ok: false, code: "malformed" });
  });

  it("requires the text argument for text-carrying actions", () => {
    const base = { instanceId: "app-one", action: "setTitle" };
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.action, base)).toMatchObject({ ok: false });
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.action, { ...base, text: "New title" })).toMatchObject({ ok: true });
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.action, { instanceId: "app-one", action: "focus" })).toMatchObject({ ok: true });
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.action, { instanceId: "app-one", action: "explode" })).toMatchObject({ ok: false });
  });

  it("validates cursor waypoints", () => {
    const cursor = { waypoints: [{ x: 1, y: 2 }], hotspot: { x: 0, y: 0 }, visible: true };
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.cursor, cursor)).toMatchObject({ ok: true });
    expect(
      parseDesktopContent(DESKTOP_CONTENT_TYPES.cursor, {
        ...cursor,
        waypoints: [{ x: Number.NaN, y: 2 }],
      }),
    ).toMatchObject({ ok: false });
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.cursor, { ...cursor, waypoints: [] })).toMatchObject({
      ok: false,
    });
  });

  it("validates each camera action in the shared family", () => {
    expect(
      parseDesktopContent(DESKTOP_CONTENT_TYPES.camera, {
        action: "pose",
        offset: { x: 10, y: -5 },
        scale: 1.2,
        rotationDegrees: 3,
      }),
    ).toMatchObject({ ok: true });

    expect(
      parseDesktopContent(DESKTOP_CONTENT_TYPES.camera, {
        action: "shake",
        amplitude: 6,
        frequency: 12,
        seed: 3,
      }),
    ).toMatchObject({ ok: true });

    expect(
      parseDesktopContent(DESKTOP_CONTENT_TYPES.camera, {
        action: "lens",
        focalLengthMm: 50,
        aperture: 0.4,
      }),
    ).toMatchObject({ ok: true });

    expect(
      parseDesktopContent(DESKTOP_CONTENT_TYPES.camera, {
        action: "lens",
        focalLengthMm: 50,
        aperture: 1.5,
      }),
    ).toMatchObject({ ok: false });
    expect(parseDesktopContent(DESKTOP_CONTENT_TYPES.camera, { action: "zoom" })).toMatchObject({
      ok: false,
    });
  });
});

describe("desktop document factories", () => {
  it("builds a project with the rows a desktop scene uses", () => {
    const project = createDesktopProject("Test");
    const tracks = Object.values(project.entities.tracks);

    expect(tracks).toHaveLength(2);
    expect(tracks.map((track) => track.kind).sort()).toEqual(["action", "desktop"]);
    expect(project.trackOrder).toEqual(["track-desktop", "track-action"]);
    expect(project.settings.frameRate).toBe(30);
    expect(project.settings.resolution).toEqual({ width: 1000, height: 600 });
  });

  it("sizes rows by kind", () => {
    expect(createDesktopTrack("desktop", 0).height).toBe(72);
    expect(createDesktopTrack("action", 1).height).toBe(48);
    expect(createDesktopTrack("cursor", 2).height).toBe(48);
    expect(createDesktopTrack("lens", 3).height).toBe(44);
    expect(createDesktopTrack("video", 4).height).toBe(64);
  });

  it("wraps an app payload in a clip with a neutral envelope", () => {
    const project = createDesktopProject();
    const clip = createAppClip({
      id: "clip-one",
      trackId: "track-desktop",
      startFrame: 10,
      durationFrames: 90,
      payload: {
        instanceId: "app-one",
        appKind: "browser",
        title: "Docs",
        lines: ["hi"],
        size: { width: 100, height: 80 },
        look: {
          accentColor: "#5ca9ff",
          theme: "dark",
          chrome: "window",
          cornerRadius: 8,
          showTitleBar: true,
        },
        zIndex: 1,
        initiallyVisible: true,
      },
    });

    expect(clip.startFrame).toBe(10);
    expect(clip.durationFrames).toBe(90);
    expect(clip.transform.position).toEqual({ type: "static", value: { x: 0, y: 0 } });
    expect(clip.content).toMatchObject({ kind: "plugin", contentType: DESKTOP_CONTENT_TYPES.app });
    expect(project.entities.tracks["track-desktop"]).toBeDefined();
  });
});
