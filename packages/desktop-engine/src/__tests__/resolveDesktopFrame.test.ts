import { describe, expect, it } from "vitest";
import { DESKTOP_CONTENT_TYPES } from "@cutaway/types";
import { createClip } from "@cutaway/utils";
import type { Id, ProjectDocument } from "@cutaway/types";
import { createStarterProject } from "../starterProject";
import { createDesktopProject, createDesktopTrack } from "../project";
import { activeCursorPayload, resolveDesktopFrame } from "../resolveDesktopFrame";
import {
  DESKTOP_WINDOW_CONTENT_TYPE,
  desktopWindowsToSceneNodes,
  isDesktopPlaceholder,
  readDesktopWindowPayload,
  resolveDesktopScene,
} from "../sceneAdapter";

function instanceOrder(project: ProjectDocument, frame: number): string[] {
  return resolveDesktopFrame(project, frame).apps.map((app) => app.instanceId);
}

function withCursorClip(project: ProjectDocument): ProjectDocument {
  const cursorTrack = createDesktopTrack("cursor", 2, { id: "track-cursor" });
  const clip = createClip({
    id: "clip-cursor",
    trackId: cursorTrack.id,
    startFrame: 100,
    durationFrames: 50,
    content: {
      kind: "plugin",
      contentType: DESKTOP_CONTENT_TYPES.cursor,
      data: { waypoints: [{ x: 10, y: 20 }], hotspot: { x: 0, y: 0 }, visible: true },
    },
  });

  return {
    ...project,
    entities: {
      ...project.entities,
      tracks: { ...project.entities.tracks, [cursorTrack.id]: cursorTrack },
      clips: { ...project.entities.clips, [clip.id]: clip },
    },
    trackOrder: [...project.trackOrder, cursorTrack.id],
  };
}

function withOrphanAction(project: ProjectDocument): ProjectDocument {
  const clip = createClip({
    id: "clip-orphan",
    trackId: "track-action",
    startFrame: 0,
    durationFrames: 30,
    content: {
      kind: "plugin",
      contentType: DESKTOP_CONTENT_TYPES.action,
      data: { instanceId: "app-ghost", action: "open" },
    },
  });

  return {
    ...project,
    entities: { ...project.entities, clips: { ...project.entities.clips, [clip.id]: clip } },
  };
}

function withClipHidden(project: ProjectDocument, clipId: Id): ProjectDocument {
  const clip = project.entities.clips[clipId];
  if (!clip) throw new Error(`Fixture has no clip "${clipId}".`);

  return {
    ...project,
    entities: {
      ...project.entities,
      clips: { ...project.entities.clips, [clipId]: { ...clip, hidden: true } },
    },
  };
}

function withTrackHidden(project: ProjectDocument, trackId: Id): ProjectDocument {
  const track = project.entities.tracks[trackId];
  if (!track) throw new Error(`Fixture has no track "${trackId}".`);

  return {
    ...project,
    entities: {
      ...project.entities,
      tracks: { ...project.entities.tracks, [trackId]: { ...track, hidden: true } },
    },
  };
}

describe("resolveDesktopFrame", () => {
  const project = createStarterProject();

  it("reports the four starter windows in authored z-order", () => {
    expect(instanceOrder(project, 0)).toEqual([
      "app-code",
      "app-chat",
      "app-terminal",
      "app-browser",
    ]);
  });

  it("places windows by their converted geometry", () => {
    const browser = resolveDesktopFrame(project, 0).apps.find(
      (app) => app.instanceId === "app-browser",
    );

    expect(browser).toBeDefined();
    expect(browser!.bounds).toEqual({ x: 520, y: 200, width: 380, height: 285 });
    expect(browser!.title).toBe("Studio Dashboard");
    expect(browser!.opacity).toBe(1);
    expect(browser!.order).toBe(3);
  });

  it("raises a focused window while its action clip is active", () => {
    // `action-focus-terminal` covers frames [90, 120).
    expect(instanceOrder(project, 89)).toEqual(["app-code", "app-chat", "app-terminal", "app-browser"]);
    expect(instanceOrder(project, 100)).toEqual(["app-code", "app-chat", "app-browser", "app-terminal"]);
    expect(instanceOrder(project, 120)).toEqual(["app-code", "app-chat", "app-terminal", "app-browser"]);
  });

  it("applies persistent action effects from their start frame onwards", () => {
    const before = resolveDesktopFrame(project, 239).apps.find(
      (app) => app.instanceId === "app-browser",
    );
    const after = resolveDesktopFrame(project, 240).apps.find(
      (app) => app.instanceId === "app-browser",
    );

    expect(before!.title).toBe("Studio Dashboard");
    expect(after!.title).toBe("Studio Dashboard — live");
  });

  it("is independent of the seek path", () => {
    // Two different orders of evaluation must agree: nothing is cached between
    // calls, so the frame is a pure function of the document.
    const forward = [0, 100, 240, 400].map((frame) => resolveDesktopFrame(project, frame).apps);
    const backward = [400, 240, 100, 0].map((frame) => resolveDesktopFrame(project, frame).apps);

    expect(forward).toEqual([...backward].reverse());
  });

  it("lists the actions in effect and whether each is still running", () => {
    const actions = resolveDesktopFrame(project, 300).actions;

    expect(actions.map((action) => action.clipId)).toEqual(["action-focus-terminal", "action-rename-browser"]);
    expect(actions[0]!.active).toBe(false);
    expect(actions[1]!.active).toBe(true);
    expect(actions[1]!.text).toBe("Studio Dashboard — live");
  });

  it("does not run a hidden action clip", () => {
    const hidden = withClipHidden(project, "action-focus-terminal");

    // Without the focus action, the windows fall back to their authored order.
    expect(instanceOrder(hidden, 100)).toEqual([
      "app-code",
      "app-chat",
      "app-terminal",
      "app-browser",
    ]);
    expect(resolveDesktopFrame(hidden, 100).actions.map((action) => action.clipId)).not.toContain(
      "action-focus-terminal",
    );
  });

  it("does not run actions on a hidden track", () => {
    const hidden = withTrackHidden(project, "track-action");

    expect(instanceOrder(hidden, 100)).toEqual([
      "app-code",
      "app-chat",
      "app-terminal",
      "app-browser",
    ]);
    expect(resolveDesktopFrame(hidden, 100).actions).toEqual([]);
  });

  it("does not let a hidden action rewrite a window title", () => {
    const hidden = withClipHidden(project, "action-rename-browser");
    const browser = resolveDesktopFrame(hidden, 300).apps.find(
      (app) => app.instanceId === "app-browser",
    );

    expect(browser!.title).toBe("Studio Dashboard");
  });

  it("keeps a window with initiallyVisible false hidden until an open action", () => {
    const hidden: ProjectDocument = {
      ...project,
      entities: {
        ...project.entities,
        clips: Object.fromEntries(
          Object.entries(project.entities.clips).map(([id, clip]) => {
            if (clip.id !== "clip-app-chat" || clip.content.kind !== "plugin") return [id, clip];
            const data = clip.content.data as Record<string, unknown>;
            return [id, { ...clip, content: { ...clip.content, data: { ...data, initiallyVisible: false } } }];
          }),
        ),
      },
    };

    expect(resolveDesktopFrame(hidden, 0).apps.map((app) => app.instanceId)).not.toContain("app-chat");

    const opened = createClip({
      id: "clip-open-chat",
      trackId: "track-action",
      startFrame: 50,
      durationFrames: 10,
      content: {
        kind: "plugin",
        contentType: DESKTOP_CONTENT_TYPES.action,
        data: { instanceId: "app-chat", action: "open" },
      },
    });

    const withOpen: ProjectDocument = {
      ...hidden,
      entities: {
        ...hidden.entities,
        clips: { ...hidden.entities.clips, [opened.id]: opened },
      },
    };

    expect(resolveDesktopFrame(withOpen, 49).apps.map((app) => app.instanceId)).not.toContain("app-chat");
    expect(resolveDesktopFrame(withOpen, 50).apps.map((app) => app.instanceId)).toContain("app-chat");
  });

  it("defers cursor and camera clips instead of drawing them", () => {
    const withCursor = withCursorClip(project);

    expect(resolveDesktopFrame(withCursor, 100).deferredClipIds).toEqual(["clip-cursor"]);
    expect(resolveDesktopFrame(withCursor, 150).deferredClipIds).toEqual([]);

    const scene = resolveDesktopScene(withCursor, 100);
    expect(scene.nodes.some((node) => node.clipId === "clip-cursor")).toBe(false);
  });

  it("does not defer a cursor clip on a hidden track", () => {
    const withCursor = withCursorClip(project);
    const hidden = withTrackHidden(withCursor, "track-cursor");

    expect(resolveDesktopFrame(hidden, 100).deferredClipIds).toEqual([]);
    expect(activeCursorPayload(hidden, 100)).toBeNull();
  });

  it("flags an action whose target does not exist, and still resolves", () => {
    const { apps, issues } = resolveDesktopFrame(withOrphanAction(project), 10);

    expect(apps).toHaveLength(4);
    expect(issues.some((issue) => issue.code === "missing-target" && issue.clipId === "clip-orphan")).toBe(true);
  });

  it("reports an unreadable payload rather than throwing", () => {
    const broken = createClip({
      id: "clip-broken",
      trackId: "track-desktop",
      startFrame: 0,
      durationFrames: 30,
      content: {
        kind: "plugin",
        contentType: "desktop-stage/app@9",
        data: {},
      },
    });

    const withBroken: ProjectDocument = {
      ...project,
      entities: { ...project.entities, clips: { ...project.entities.clips, [broken.id]: broken } },
    };

    const frame = resolveDesktopFrame(withBroken, 0);
    expect(frame.issues.some((issue) => issue.code === "unsupported-version")).toBe(true);
    expect(frame.apps).toHaveLength(4);
  });

  it("omits windows whose desktop track is hidden", () => {
    const hiddenTrack: ProjectDocument = {
      ...project,
      entities: {
        ...project.entities,
        tracks: {
          ...project.entities.tracks,
          "track-desktop": { ...project.entities.tracks["track-desktop"]!, hidden: true },
        },
      },
    };

    expect(resolveDesktopFrame(hiddenTrack, 0).apps).toHaveLength(0);
  });
});

describe("scene adapter", () => {
  const project = createStarterProject();

  it("replaces plugin placeholders with drawable window nodes", () => {
    const scene = resolveDesktopScene(project, 0);

    expect(scene.nodes).toHaveLength(4);
    expect(scene.nodes.every((node) => !isDesktopPlaceholder(node))).toBe(true);
    expect(scene.nodes.every((node) => node.content.kind === "plugin")).toBe(true);

    for (const node of scene.nodes) {
      if (node.content.kind !== "plugin") continue;
      expect(node.content.contentType).toBe(DESKTOP_WINDOW_CONTENT_TYPE);
    }
  });

  it("keeps the drawable window node and strips only authored placeholders", () => {
    const [windowNode] = desktopWindowsToSceneNodes(resolveDesktopFrame(project, 0), project);

    expect(windowNode).toBeDefined();
    expect(windowNode!.content).toMatchObject({ kind: "plugin", contentType: DESKTOP_WINDOW_CONTENT_TYPE });
    expect(isDesktopPlaceholder(windowNode!)).toBe(false);

    // An authored family clip is still a placeholder the adapter replaces.
    expect(
      isDesktopPlaceholder({
        ...windowNode!,
        content: { kind: "plugin", contentType: DESKTOP_CONTENT_TYPES.cursor, data: {} },
      }),
    ).toBe(true);
  });

  it("keys nodes by instance id so a split clip keeps one display object", () => {
    const ids = resolveDesktopScene(project, 0).nodes.map((node) => node.clipId).sort();
    expect(ids).toEqual([
      "desktop-window:app-browser",
      "desktop-window:app-chat",
      "desktop-window:app-code",
      "desktop-window:app-terminal",
    ]);
  });

  it("carries the resolved rectangle and title into the drawable payload", () => {
    const node = resolveDesktopScene(project, 0).nodes.find(
      (candidate) => candidate.clipId === "desktop-window:app-browser",
    );

    expect(node).toBeDefined();
    const payload = readDesktopWindowPayload(
      node!.content.kind === "plugin" ? node!.content.data : null,
    );

    expect(payload).toMatchObject({ instanceId: "app-browser", title: "Studio Dashboard", width: 380, height: 285 });
    // Composition space is centred, so the node sits at the rectangle's centre
    // offset by half the 1000 × 600 stage.
    expect(node!.transform.position).toEqual({ x: 210, y: 42.5 });
    expect(node!.appearance.opacity).toBe(1);
  });

  it("returns null for data that is not a window payload", () => {
    expect(readDesktopWindowPayload(null)).toBeNull();
    expect(readDesktopWindowPayload({})).toBeNull();
    expect(readDesktopWindowPayload({ window: { instanceId: "x" } })).toBeNull();
  });

  it("draws in the same back-to-front order the resolver sorted", () => {
    const scene = resolveDesktopScene(project, 0);
    const zIndexes = scene.nodes.map((node) => node.zIndex);

    expect([...zIndexes].sort((a, b) => a - b)).toEqual(zIndexes);
    expect(scene.nodes.map((node) => node.clipId)).toEqual([
      "desktop-window:app-code",
      "desktop-window:app-chat",
      "desktop-window:app-terminal",
      "desktop-window:app-browser",
    ]);
  });

  it("puts a track earlier in trackOrder in front of a later one", () => {
    const desktopFirst = createDesktopProject();
    const nodes = desktopWindowsToSceneNodes(resolveDesktopFrame(project, 0), project);

    expect(nodes.every((node) => node.trackId === "track-desktop")).toBe(true);
    // 2 tracks, desktop at index 0 → the frontmost band.
    expect(nodes[0]!.zIndex).toBe(2 * 1_000_000);
    expect(desktopFirst.trackOrder[0]).toBe("track-desktop");
  });

  it("preserves audio and captions from the generic resolver", () => {
    const scene = resolveDesktopScene(project, 0);
    expect(scene.audio).toEqual([]);
    expect(scene.caption).toBeNull();
    expect(scene.resolution).toEqual({ width: 1000, height: 600 });
    expect(scene.frame).toBe(0);
  });
});
