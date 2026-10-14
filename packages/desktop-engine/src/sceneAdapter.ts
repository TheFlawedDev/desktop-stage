/**
 * Desktop Stage scene adapter.
 *
 * The generic resolver decides what a frame contains; this module turns the
 * resolved desktop into nodes the compositor can draw, and drops the
 * placeholders the generic resolver emits for Desktop Stage plugin clips.
 *
 * `resolveDesktopScene` is the single entry point preview and export share. Both
 * draw the same nodes for the same frame because both call this one function —
 * there is no second "what does the desktop look like" implementation to drift.
 *
 * App windows are emitted as one node each, keyed by `instanceId` rather than by
 * clip id: an app whose lifetime is split across clips keeps one display object,
 * so splitting a clip does not tear down and rebuild the window's textures on
 * every seek across the cut.
 */

import { DESKTOP_WINDOW_CONTENT_TYPE, type ProjectDocument, type Size } from "@cutaway/types";
// `Scene` and `SceneNode` are the resolver's output types, so they come from the
// render engine that defines them — `@cutaway/types` deliberately has no
// dependency on a resolved frame.
import { resolveScene, type Scene, type SceneNode } from "@cutaway/render-engine";
import { isDesktopContentType } from "./project";
import { resolveDesktopFrame, type ResolvedDesktopApp, type ResolvedDesktopFrame } from "./resolveDesktopFrame";

/**
 * The content type stamped onto every node this adapter emits.
 *
 * Re-exported so a consumer that receives a node from here can recognise it
 * without a second import from `@cutaway/types`.
 */
export { DESKTOP_WINDOW_CONTENT_TYPE };

/**
 * Per-track z stride.
 *
 * Matches the generic resolver, where track order dominates and the clip's own
 * timing only breaks ties inside a track. Keeping the same stride here is what
 * lets desktop windows interleave correctly with media, text, and shape nodes
 * from the generic resolver in one sorted list.
 */
const TRACK_Z_STRIDE = 1_000_000;

/** Drawable description of one app window, carried in the node's plugin data. */
export interface DesktopWindowNodePayload {
  instanceId: string;
  appKind: ResolvedDesktopApp["appKind"];
  title: string;
  lines: string[];
  look: ResolvedDesktopApp["look"];
  width: number;
  height: number;
}

/** Key the window payload sits under inside `content.data`. */
export const DESKTOP_WINDOW_DATA_KEY = "window";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a window payload out of node data.
 *
 * Defensive because the data crosses into the renderer as `unknown`: a node
 * whose payload is not what this build expects is skipped rather than drawn
 * wrong.
 */
export function readDesktopWindowPayload(data: unknown): DesktopWindowNodePayload | null {
  if (!isRecord(data)) return null;

  const window = data[DESKTOP_WINDOW_DATA_KEY];
  if (!isRecord(window)) return null;

  const { instanceId, appKind, title, lines, look, width, height } = window;

  if (typeof instanceId !== "string" || typeof appKind !== "string") return null;
  if (typeof title !== "string" || !Array.isArray(lines)) return null;
  if (!lines.every((line) => typeof line === "string")) return null;
  if (!isRecord(look) || typeof look.accentColor !== "string") return null;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  return {
    instanceId,
    appKind: appKind as DesktopWindowNodePayload["appKind"],
    title,
    lines: lines as string[],
    look: look as unknown as DesktopWindowNodePayload["look"],
    width,
    height,
  };
}

/** True for a generic-resolver placeholder that this adapter replaces. */
export function isDesktopPlaceholder(node: SceneNode): boolean {
  return node.content.kind === "plugin" && isDesktopContentType(node.content.contentType);
}

/** Drawable nodes for the desktop's visible app windows, back to front. */
export function desktopWindowsToSceneNodes(
  frame: ResolvedDesktopFrame,
  project: ProjectDocument,
): SceneNode[] {
  const trackCount = project.trackOrder.length;

  return frame.apps.map((app) => {
    const trackIndex = Math.max(0, project.trackOrder.indexOf(app.trackId));
    const size: Size = app.size;

    const payload: DesktopWindowNodePayload = {
      instanceId: app.instanceId,
      appKind: app.appKind,
      title: app.title,
      lines: app.lines,
      look: app.look,
      width: size.width,
      height: size.height,
    };

    return {
      clipId: `desktop-window:${app.instanceId}`,
      trackId: app.trackId,
      zIndex: (trackCount - trackIndex) * TRACK_Z_STRIDE + app.order,
      transform: {
        // The window rectangle is already resolved in project pixels, so the
        // node is placed by its centre and drawn at scale 1.
        position: {
          x: app.bounds.x + size.width / 2 - frame.composition.width / 2,
          y: app.bounds.y + size.height / 2 - frame.composition.height / 2,
        },
        scale: { x: 1, y: 1 },
        rotation: 0,
        anchor: { x: 0.5, y: 0.5 },
        skew: { x: 0, y: 0 },
      },
      appearance: {
        opacity: app.opacity,
        blur: 0,
        cornerRadius: app.look.cornerRadius,
        blendMode: "normal",
        shadow: {
          enabled: false,
          color: "#000000",
          offset: { x: 0, y: 4 },
          blur: 12,
          opacity: 0.5,
        },
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
      },
      content: {
        kind: "plugin",
        contentType: DESKTOP_WINDOW_CONTENT_TYPE,
        data: { [DESKTOP_WINDOW_DATA_KEY]: payload },
      },
      masks: [],
      grade: null,
      effects: [],
    } satisfies SceneNode;
  });
}

/**
 * The frame's full scene: generic content plus the desktop, in one draw order.
 *
 * Nonvisual Desktop Stage clips (actions, and the cursor/camera/lens rows until
 * their milestone lands) contribute no nodes; their generic plugin placeholders
 * are filtered out here rather than in each backend.
 */
export function resolveDesktopScene(project: ProjectDocument, frame: number): Scene {
  const scene = resolveScene(project, frame);
  const desktop = resolveDesktopFrame(project, frame);

  const nodes = scene.nodes.filter((node) => !isDesktopPlaceholder(node));
  nodes.push(...desktopWindowsToSceneNodes(desktop, project));
  nodes.sort((a, b) => a.zIndex - b.zIndex);

  return { ...scene, nodes };
}
