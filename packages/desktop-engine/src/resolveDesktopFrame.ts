/**
 * Frame resolution for the simulated desktop.
 *
 * `resolveDesktopFrame` answers one question at one frame: which app windows are
 * on screen, where, in what order, and which timed actions have already taken
 * effect. It is **pure** and **history-independent** — it walks the document from
 * the start every time, so seeking backwards, scrubbing, and exporting all agree
 * on what frame N looks like. Nothing here reads the playhead, the selection, or
 * any other editor state.
 *
 * This is the Desktop Stage extension step shared by preview and export: the
 * generic resolver draws media, text, and shapes, and this one draws the desktop.
 * Cursor, camera, camera-effect, and lens clips are recognised and validated but
 * not yet applied; their interpolation belongs to the camera-cursor milestone,
 * and a second camera model here would only diverge from it.
 */

import type {
  Clip,
  DesktopActionPayload,
  DesktopAppPayload,
  DesktopCameraPayload,
  DesktopCursorPayload,
  DesktopPayload,
  Frame,
  Id,
  ProjectDocument,
  Rect,
  Size,
} from "@cutaway/types";
import { evaluate } from "@cutaway/animation-engine";
import {
  isDesktopPluginContent,
  parseDesktopContent,
  type DesktopParseFailureCode,
} from "./project";

/** One app window, resolved for a single frame. */
export interface ResolvedDesktopApp {
  /** Stable instance id that action clips reference. */
  instanceId: Id;
  /** The app clip that is on screen at this frame. */
  clipId: Id;
  trackId: Id;
  appKind: DesktopAppPayload["appKind"];
  title: string;
  lines: string[];
  look: DesktopAppPayload["look"];
  /** Rendered window rectangle in project pixels, top-left origin. */
  bounds: Rect;
  /** Rendered size: the authored size with the clip's scale applied. */
  size: Size;
  opacity: number;
  /** Draw order within the desktop layer; ascending, higher draws in front. */
  order: number;
}

/** One action clip that has taken effect by this frame. */
export interface ResolvedDesktopAction {
  clipId: Id;
  instanceId: Id;
  action: DesktopActionPayload["action"];
  text: string | null;
  startFrame: Frame;
  durationFrames: number;
  /** True while the clip's half-open range still covers the frame. */
  active: boolean;
}

export interface ResolvedDesktopIssue {
  clipId: Id;
  code: DesktopParseFailureCode | "missing-target";
  message: string;
}

export interface ResolvedDesktopFrame {
  frame: Frame;
  composition: Size;
  /** Visible app windows, back to front. */
  apps: ResolvedDesktopApp[];
  /** Actions in effect, ordered by start frame. Hidden actions never appear. */
  actions: ResolvedDesktopAction[];
  /**
   * Ids of cursor, camera, camera-effect, and lens clips active at this frame.
   * Their payloads are validated by the document parser; applying them to the
   * frame is the camera-cursor milestone.
   */
  deferredClipIds: Id[];
  /** Payloads that could not be read, or that referenced something absent. */
  issues: ResolvedDesktopIssue[];
}

interface AppRecord {
  instanceId: Id;
  clip: Clip;
  trackId: Id;
  payload: DesktopAppPayload;
}

interface ActionRecord {
  clipId: Id;
  clip: Clip;
  payload: DesktopActionPayload;
}

/** A clip covers `[startFrame, startFrame + durationFrames)`; end-exclusive. */
function isActive(clip: Clip, frame: Frame): boolean {
  return frame >= clip.startFrame && frame < clip.startFrame + clip.durationFrames;
}

/** Deterministic clip order: earlier start first, then id. */
function byTimingThenId(a: Clip, b: Clip): number {
  if (a.startFrame !== b.startFrame) return a.startFrame - b.startFrame;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Resolves the desktop at `frame`.
 *
 * Never throws: an unreadable payload is reported in `issues` and skipped, so a
 * project with one bad clip still renders everything else.
 */
export function resolveDesktopFrame(project: ProjectDocument, frame: Frame): ResolvedDesktopFrame {
  const composition = project.settings.resolution;
  const issues: ResolvedDesktopIssue[] = [];

  const appRecords = new Map<Id, AppRecord[]>();
  const actionRecords: ActionRecord[] = [];
  const deferredClips: Clip[] = [];

  // --- Pass 1: read every Desktop Stage clip in the document -------------
  for (const trackId of project.trackOrder) {
    const track = project.entities.tracks[trackId];
    if (!track) continue;

    const clips = Object.values(project.entities.clips)
      .filter((clip) => clip.trackId === trackId)
      .sort(byTimingThenId);

    for (const clip of clips) {
      if (!isDesktopPluginContent(clip.content)) continue;

      const parsed = parseDesktopContent(clip.content.contentType, clip.content.data);
      if (!parsed.ok) {
        issues.push({ clipId: clip.id, code: parsed.code, message: parsed.message });
        continue;
      }

      if (parsed.family === "app") {
        const payload = parsed.payload as DesktopAppPayload;
        const records = appRecords.get(payload.instanceId) ?? [];
        records.push({ instanceId: payload.instanceId, clip, trackId, payload });
        appRecords.set(payload.instanceId, records);
      } else if (parsed.family === "action") {
        // Hiding is how the user switches an action off, so a hidden action clip
        // — or one on a hidden track — must not run. The check has to happen
        // here, before the fold: an action mutates window state from its start
        // frame onwards, and skipping only the visible listing would still let
        // it rewrite titles and visibility.
        if (clip.hidden || track.hidden) continue;

        actionRecords.push({
          clipId: clip.id,
          clip,
          payload: parsed.payload as DesktopActionPayload,
        });
      } else {
        deferredClips.push(clip);
      }
    }
  }

  // --- Pass 2: fold each instance's state from the start of the timeline --
  const knownInstances = new Set(appRecords.keys());
  const orderedActions = [...actionRecords].sort((a, b) => byTimingThenId(a.clip, b.clip));

  const apps: ResolvedDesktopApp[] = [];
  /** Frame at which each focused instance was raised; absent means unfocused. */
  const raisedAt = new Map<Id, number>();
  /** Authored z-order of the payload that is on screen, for the final sort. */
  const zIndexOnScreen = new Map<Id, number>();

  for (const [instanceId, records] of appRecords) {
    // The clip that is on screen: the most recently started one covering this
    // frame. Splitting an app's lifetime across clips keeps pointing at the same
    // instance, and the later clip carries the state that applies now.
    const activeRecords = records
      .filter((record) => isActive(record.clip, frame) && !record.clip.hidden)
      .sort((a, b) => byTimingThenId(a.clip, b.clip));
    const active = activeRecords[activeRecords.length - 1];
    if (!active) continue;

    const track = project.entities.tracks[active.trackId];
    if (!track || track.hidden) continue;

    const { payload, clip } = active;

    let title = payload.title;
    let lines = [...payload.lines];
    let visible = payload.initiallyVisible;

    for (const record of orderedActions) {
      const action = record.payload;
      if (action.instanceId !== instanceId) continue;

      const running = isActive(record.clip, frame);
      const started = record.clip.startFrame <= frame;

      switch (action.action) {
        case "open":
          if (started) visible = true;
          break;
        case "close":
          if (started) visible = false;
          break;
        case "setTitle":
          if (started && action.text) title = action.text;
          break;
        case "appendLine":
          if (started && action.text) lines = [...lines, action.text];
          break;
        case "focus": {
          // Focus is an emphasis, not a state change: it lasts exactly as long
          // as its clip. A later focus raises a window above an earlier one.
          if (running) {
            const previous = raisedAt.get(instanceId);
            if (previous === undefined || record.clip.startFrame > previous) {
              raisedAt.set(instanceId, record.clip.startFrame);
            }
          }
          break;
        }
        default:
          break;
      }
    }

    if (!visible) continue;

    const position = evaluate(clip.transform.position, frame);
    const scale = evaluate(clip.transform.scale, frame);
    const anchor = evaluate(clip.transform.anchor, frame);

    const size: Size = {
      width: payload.size.width * scale.x,
      height: payload.size.height * scale.y,
    };

    // A clip's position is its anchor point in composition space, whose origin
    // is the centre of the frame. Convert back to a top-left rectangle, which is
    // what the renderer and any future hit-test wants.
    const bounds: Rect = {
      x: position.x + composition.width / 2 - size.width * anchor.x,
      y: position.y + composition.height / 2 - size.height * anchor.y,
      width: size.width,
      height: size.height,
    };

    zIndexOnScreen.set(instanceId, payload.zIndex);
    apps.push({
      instanceId,
      clipId: clip.id,
      trackId: active.trackId,
      appKind: payload.appKind,
      title,
      lines,
      look: payload.look,
      bounds,
      size,
      opacity: Math.min(1, Math.max(0, evaluate(clip.appearance.opacity, frame))),
      order: 0,
    });
  }

  // Authored z-order decides the stack. Focused windows move to the front, in
  // the order they were raised, so a focus can only ever reorder the front.
  apps.sort((a, b) => {
    const aRaised = raisedAt.get(a.instanceId);
    const bRaised = raisedAt.get(b.instanceId);

    if (aRaised !== bRaised) {
      if (aRaised === undefined) return -1;
      if (bRaised === undefined) return 1;
      return aRaised - bRaised;
    }

    const aZ = zIndexOnScreen.get(a.instanceId) ?? 0;
    const bZ = zIndexOnScreen.get(b.instanceId) ?? 0;
    if (aZ !== bZ) return aZ - bZ;

    return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
  });

  apps.forEach((app, index) => {
    app.order = index;
  });

  // --- Actions and issues ------------------------------------------------
  const actions: ResolvedDesktopAction[] = orderedActions
    .filter((record) => record.clip.startFrame <= frame)
    .map((record) => ({
      clipId: record.clipId,
      instanceId: record.payload.instanceId,
      action: record.payload.action,
      text: record.payload.text ?? null,
      startFrame: record.clip.startFrame,
      durationFrames: record.clip.durationFrames,
      active: isActive(record.clip, frame),
    }));

  for (const record of orderedActions) {
    if (!knownInstances.has(record.payload.instanceId)) {
      issues.push({
        clipId: record.clipId,
        code: "missing-target",
        message: `Action targets app instance "${record.payload.instanceId}", which is not in this project.`,
      });
    }
  }

  // Deferred families report only what is actually on screen: a hidden clip, or
  // one on a hidden track, is not "active" for anything downstream either.
  const deferredClipIds = deferredClips
    .filter(
      (clip) =>
        isActive(clip, frame) && !clip.hidden && !project.entities.tracks[clip.trackId]?.hidden,
    )
    .map((clip) => clip.id);

  return { frame, composition, apps, actions, deferredClipIds, issues };
}

/** The cursor clip active at a frame, or null. Consumed by the cursor milestone. */
export function activeCursorPayload(
  project: ProjectDocument,
  frame: Frame,
): { clipId: Id; payload: DesktopCursorPayload } | null {
  return firstActivePayload<DesktopCursorPayload>(project, frame, "cursor");
}

/** The camera clip active at a frame, or null. Consumed by the camera milestone. */
export function activeCameraPayload(
  project: ProjectDocument,
  frame: Frame,
): { clipId: Id; payload: DesktopCameraPayload } | null {
  return firstActivePayload<DesktopCameraPayload>(project, frame, "camera");
}

function firstActivePayload<T extends DesktopPayload>(
  project: ProjectDocument,
  frame: Frame,
  family: "cursor" | "camera",
): { clipId: Id; payload: T } | null {
  const clips = Object.values(project.entities.clips).sort(byTimingThenId);

  for (const clip of clips) {
    if (!isDesktopPluginContent(clip.content) || clip.hidden || !isActive(clip, frame)) continue;
    if (project.entities.tracks[clip.trackId]?.hidden) continue;

    const parsed = parseDesktopContent(clip.content.contentType, clip.content.data);
    if (parsed.ok && parsed.family === family) {
      return { clipId: clip.id, payload: parsed.payload as T };
    }
  }

  return null;
}
