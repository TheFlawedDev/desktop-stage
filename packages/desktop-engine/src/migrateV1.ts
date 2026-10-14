/**
 * Version 1 (prototype) → current document conversion.
 *
 * The prototype's project was a flat list of CSS-positioned windows plus a
 * per-window keyframe map on a fixed 20-second timeline. The current document is
 * normalized, frame-based, and track-based. This module is the only bridge
 * between them, and it is **pure and deterministic**: the same v1 input always
 * produces the same document, with no timestamps and no random ids. That matters
 * because the migration is user-visible — an import that differed between two
 * runs would make "did my project convert correctly?" impossible to answer.
 *
 * What is preserved, and how:
 *
 * | v1 | converted |
 * | --- | --- |
 * | window `x`, `y`, `width`, `height`, `scale` | clip `transform.position` and `transform.scale` |
 * | window `opacity` | clip `appearance.opacity` |
 * | window `z` | app payload `zIndex` |
 * | window `title`, `content` | app payload `title`, `lines` |
 * | window `color` | app payload `look.accentColor` |
 * | keyframe `time` (ms) | frame via {@link v1TimeToFrame} |
 * | window `kind` | app kind, see {@link appKindForWindow} |
 *
 * Positions are converted from "top-left in a 1000 × 600 stage" to "centre in
 * composition space", and size animation is folded into `transform.scale`
 * relative to the window's first-frame rendered size, because the converted
 * document has no separate width/height property to animate. Every keyframe's
 * rendered geometry is exact; between keyframes, interpolation runs on centre
 * and scale rather than on top-left and size, which is a sub-pixel difference
 * for the moves the prototype could express.
 */

import type {
  Animatable,
  DesktopAppKind,
  DesktopAppPayload,
  Easing,
  Frame,
  Keyframe,
  ProjectDocument,
  Track,
  Unit,
  Vec2,
} from "@cutaway/types";
import { staticValue } from "@cutaway/types";
import { createExportSettings } from "@cutaway/utils";
import {
  DEFAULT_DESKTOP_LOOK,
  createAppClip,
  createDesktopProject,
  createDesktopSettings,
  createDesktopTrack,
} from "./project";
import type { V1AnimatedValues, V1Keyframe, V1Project, V1Window } from "./v1-types";
import { V1_COMPOSITION, isV1Project } from "./v1";

/** The prototype's frame rate, kept for conversion only. */
export const V1_FRAME_RATE = 30;

/** 20 seconds at 30 fps: the prototype's fixed timeline length. */
export const V1_DURATION_FRAMES = 600;

/** Stable track ids a converted project always uses. */
export const V1_DESKTOP_TRACK_ID = "track-desktop";
export const V1_ACTION_TRACK_ID = "track-action";

/** Stable id for a converted document, so repeated conversions are identical. */
export const V1_PROJECT_ID = "project-desktop-stage-v1";

/**
 * The prototype eased every segment with `t²(3 − 2t)` (smoothstep).
 *
 * That curve is exactly the cubic bezier through (1/3, 0) and (2/3, 1), so the
 * converted keyframes carry the same motion rather than an approximation of it.
 */
export const V1_EASING: Easing = { kind: "bezier", p1: { x: 1 / 3, y: 0 }, p2: { x: 2 / 3, y: 1 } };

export interface ConvertV1Options {
  /** Overrides the converted project's name. */
  name?: string;
  /** Overrides the converted project's id. */
  projectId?: string;
  /**
   * Value for `createdAt`/`modifiedAt`.
   *
   * Defaults to 0 — deliberately not `Date.now()`, so converting the same file
   * twice produces the same document and a test can assert it.
   */
  now?: number;
}

/** Milliseconds on the prototype timeline → frames on the converted timeline. */
export function v1TimeToFrame(milliseconds: number): Frame {
  if (!Number.isFinite(milliseconds)) return 0;
  return Math.min(
    V1_DURATION_FRAMES - 1,
    Math.max(0, Math.round((milliseconds * V1_FRAME_RATE) / 1000)),
  );
}

/**
 * Maps a prototype window kind onto an authored app kind.
 *
 * `note` becomes `legacyText`: the prototype's note window held arbitrary free
 * text, and guessing that it was a chat client — or any other specific app —
 * would invent information the document never had. `legacyText` renders the
 * window with its chrome and text intact and claims nothing more.
 *
 * A `code` window whose id is `terminal` is the starter scene's terminal. That
 * id is the only case where the prototype itself distinguished the two, so it is
 * the only one converted with that knowledge.
 */
export function appKindForWindow(window: V1Window): DesktopAppKind {
  if (window.kind === "browser") return "browser";
  if (window.kind === "note") return "legacyText";
  return window.id === "terminal" ? "terminal" : "code";
}

/** Filesystem- and id-safe form of a prototype id. */
function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "window";
}

/** Deduplicating id factory: stable for a given input order. */
function createIdFactory() {
  const taken = new Set<string>();

  return (base: string): string => {
    let candidate = base;
    let suffix = 2;
    while (taken.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    taken.add(candidate);
    return candidate;
  };
}

/**
 * Keyframes for one window, deduplicated by frame and sorted ascending.
 *
 * Two prototype keyframes can land on the same frame once milliseconds are
 * rounded to 30 fps; the later one wins, matching the prototype, where the later
 * keyframe governed.
 */
function orderedKeyframes(
  frames: V1Keyframe[] | undefined,
): { frame: Frame; values: V1AnimatedValues }[] {
  if (!Array.isArray(frames) || frames.length === 0) return [];

  const byFrame = new Map<Frame, V1AnimatedValues>();
  for (const keyframe of [...frames].sort((a, b) => a.time - b.time)) {
    byFrame.set(v1TimeToFrame(keyframe.time), keyframe.values);
  }

  return [...byFrame.entries()]
    .map(([frame, values]) => ({ frame, values }))
    .sort((a, b) => a.frame - b.frame);
}

/** Rendered size of a prototype window at one of its keyframe states. */
function renderedSize(values: V1AnimatedValues): { width: number; height: number } {
  // A zero size would divide by zero when it becomes a scale factor; the
  // prototype allowed one, so it is clamped rather than rejected.
  return {
    width: Math.max(1, Math.abs(values.width * values.scale)),
    height: Math.max(1, Math.abs(values.height * values.scale)),
  };
}

/** Centre-of-composition position for a prototype window state. */
function toCentre(values: V1AnimatedValues): Vec2 {
  const size = renderedSize(values);
  return {
    x: values.x + size.width / 2 - V1_COMPOSITION.width / 2,
    y: values.y + size.height / 2 - V1_COMPOSITION.height / 2,
  };
}

/**
 * Builds an animatable from per-keyframe values.
 *
 * A single keyframe collapses to a static value: the prototype held one
 * keyframe's values across the whole timeline, and an animated track with one
 * keyframe would only make the timeline UI busier for the same result.
 */
function toAnimatable<T>(entries: { frame: Frame; value: T }[]): Animatable<T> {
  const first = entries[0];
  if (!first) throw new Error("toAnimatable requires at least one entry");
  if (entries.length === 1) return staticValue(first.value);

  const keyframes: Keyframe<T>[] = entries.map((entry) => ({
    frame: entry.frame,
    value: entry.value,
    easing: V1_EASING,
  }));

  return { type: "animated", keyframes };
}

function clampUnit(value: number): Unit {
  return Math.min(1, Math.max(0, value));
}

/**
 * Converts a validated v1 project into the current document.
 *
 * Callers must gate on {@link isV1Project}; this function assumes well-formed
 * input and does not re-validate. {@link convertV1ProjectChecked} is the safe
 * wrapper for untrusted input such as a file.
 */
export function convertV1Project(
  project: V1Project,
  options: ConvertV1Options = {},
): ProjectDocument {
  const now = options.now ?? 0;
  const name = options.name ?? "Imported desktop project";
  const projectId = options.projectId ?? V1_PROJECT_ID;

  const base = createDesktopProject(name);
  const settings = createDesktopSettings();

  const desktopTrack: Track = createDesktopTrack("desktop", 0, { id: V1_DESKTOP_TRACK_ID });
  const actionTrack: Track = createDesktopTrack("action", 1, { id: V1_ACTION_TRACK_ID });

  const nextId = createIdFactory();
  const clips = { ...base.entities.clips };

  for (const window of project.windows) {
    const instanceId = nextId(`app-${slugify(window.id)}`);
    const clipId = nextId(`clip-${instanceId}`);

    // Window ids are user data and may collide with `Object.prototype` names
    // such as "constructor". Reading through the prototype chain would hand the
    // converter a function where a keyframe list belongs, so only an *own*
    // property counts.
    const windowKeyframes = Object.prototype.hasOwnProperty.call(project.keyframes, window.id)
      ? project.keyframes[window.id]
      : undefined;
    const keyframes = orderedKeyframes(windowKeyframes);

    // With keyframes the prototype ignored the window's own values entirely;
    // without them it used them as constants. Both cases are reproduced here.
    const states =
      keyframes.length > 0
        ? keyframes
        : [
            {
              frame: 0,
              values: {
                x: window.x,
                y: window.y,
                width: window.width,
                height: window.height,
                opacity: window.opacity,
                scale: window.scale,
              },
            },
          ];

    const baseSize = renderedSize(states[0]!.values);

    const payload: DesktopAppPayload = {
      instanceId,
      appKind: appKindForWindow(window),
      title: window.title,
      lines: window.content.split("\n"),
      size: baseSize,
      look: { ...DEFAULT_DESKTOP_LOOK, accentColor: window.color },
      zIndex: window.z,
      initiallyVisible: true,
    };

    const clip = createAppClip({
      id: clipId,
      trackId: desktopTrack.id,
      startFrame: 0,
      durationFrames: V1_DURATION_FRAMES,
      payload,
      name: window.title.trim() || payload.appKind,
    });

    clips[clip.id] = {
      ...clip,
      transform: {
        ...clip.transform,
        position: toAnimatable(
          states.map((state) => ({ frame: state.frame, value: toCentre(state.values) })),
        ),
        scale: toAnimatable(
          states.map((state) => {
            const size = renderedSize(state.values);
            return {
              frame: state.frame,
              value: { x: size.width / baseSize.width, y: size.height / baseSize.height },
            };
          }),
        ),
      },
      appearance: {
        ...clip.appearance,
        opacity: toAnimatable(
          states.map((state) => ({ frame: state.frame, value: clampUnit(state.values.opacity) })),
        ),
      },
    };
  }

  return {
    ...base,
    id: projectId,
    name,
    createdAt: now,
    modifiedAt: now,
    settings,
    exportSettings: createExportSettings(settings),
    entities: {
      ...base.entities,
      tracks: { [desktopTrack.id]: desktopTrack, [actionTrack.id]: actionTrack },
      clips,
    },
    trackOrder: [desktopTrack.id, actionTrack.id],
    durationFrames: V1_DURATION_FRAMES,
    requiredPlugins: [],
  };
}

export type ConvertV1Outcome =
  | { ok: true; project: ProjectDocument }
  | { ok: false; error: string };

/**
 * Safe entry point: validates first, converts second.
 *
 * This is what import paths call, so a stray JSON file is rejected with a
 * message instead of producing a half-converted document.
 */
export function convertV1ProjectChecked(
  value: unknown,
  options: ConvertV1Options = {},
): ConvertV1Outcome {
  if (!isV1Project(value)) {
    return { ok: false, error: "File is not a Desktop Stage version 1 project." };
  }

  return { ok: true, project: convertV1Project(value, options) };
}
