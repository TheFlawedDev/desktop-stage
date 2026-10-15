/**
 * Desktop Stage document extension.
 *
 * Desktop Stage authors a *simulated* desktop: windows, timed actions, a cursor,
 * and a camera that are drawn by this editor. Nothing here talks to the real
 * operating system, browser, shell, files, contacts, microphone, or camera, and
 * nothing here is capable of it — the payloads below are plain JSON that a
 * renderer draws.
 *
 * ## Where this lives in the document
 *
 * Cutaway's `ProjectDocument` stays the single source of truth. Desktop Stage
 * content rides in its existing plugin seam: a clip with
 * `content.kind: "plugin"`, a versioned `contentType` from
 * {@link DESKTOP_CONTENT_TYPES}, and a typed `data` payload declared here. That
 * keeps every generic capability — timing, transform, appearance, masks,
 * effects, undo, serialization — working on desktop content without a parallel
 * object model.
 *
 * ## Versioning rules
 *
 * The version is part of the content type string (`…/app@1`), not a separate
 * field, so an unsupported payload can never be mistaken for a supported one: a
 * reader either recognises the exact string or reports it as unsupported.
 * Additive changes keep the same version; a breaking change to a payload's shape
 * introduces `@2`, and the previous version keeps a migration path.
 *
 * ## Identity rules
 *
 * `instanceId` identifies one authored app *instance* and is what action clips
 * reference. It is stable for the life of the document and never derived from an
 * array position, so splitting an app clip across two clips or reordering the
 * timeline cannot silently re-point an action at a different window.
 */

import type { Id, Unit, Vec2 } from "./primitives";

/** Versioned content types of the Desktop Stage extension. */
export const DESKTOP_CONTENT_TYPES = {
  /** A desktop app instance (window) and its content. */
  app: "desktop-stage/app@1",
  /** A timed effect applied to an app instance. */
  action: "desktop-stage/action@1",
  /** The simulated pointer. */
  cursor: "desktop-stage/cursor@1",
  /** Camera pose, shake, and lens data, discriminated by `action`. */
  camera: "desktop-stage/camera@1",
} as const;

export type DesktopContentType =
  (typeof DESKTOP_CONTENT_TYPES)[keyof typeof DESKTOP_CONTENT_TYPES];

/**
 * Authored app kinds.
 *
 * Extending this union is additive and does not bump a payload version. The
 * simulated-app milestone adds the remaining authored app types; the four here
 * are the ones the existing prototype's windows convert to, including
 * `legacyText`, which exists so an old free-text window stays renderable without
 * this editor pretending to know what application it was.
 */
export type DesktopAppKind = "browser" | "code" | "terminal" | "legacyText";

export type DesktopTheme = "dark" | "light";

/** Serialisable look settings for an app window. */
export interface DesktopAppLook {
  /** Accent used for the window's highlight elements. */
  accentColor: string;
  theme: DesktopTheme;
  /** Window chrome drawn around the content; `plain` draws no title bar. */
  chrome: "window" | "plain";
  cornerRadius: number;
  showTitleBar: boolean;
}

/**
 * A desktop app instance.
 *
 * `size` is the authored window size in project pixels; animation of the window
 * size lives on the clip's `transform.scale` so it reuses the generic animatable
 * plumbing instead of inventing a second keyframe system. The rendered size at a
 * frame is therefore `size * transform.scale`. `zIndex` orders app instances
 * against each other; track order still dominates, so an app can never be drawn
 * above a clip on a higher track.
 */
export interface DesktopAppPayload {
  instanceId: Id;
  appKind: DesktopAppKind;
  title: string;
  /** Body lines, one entry per rendered line. Empty lines are preserved. */
  lines: string[];
  size: { width: number; height: number };
  look: DesktopAppLook;
  zIndex: number;
  /** Whether the instance is visible before any action opens or closes it. */
  initiallyVisible: boolean;
}

/** Timed effects an action clip can apply to a standard app instance. */
export type DesktopStandardActionKind =
  | "open"
  | "close"
  | "focus"
  | "setTitle"
  | "appendLine";

/** Timed effects an action clip can apply to an app instance or camera tracking. */
export type DesktopActionKind = DesktopStandardActionKind | "trackMouse";

export interface DesktopStandardActionPayload {
  /** The app instance this action targets. Must exist in the document. */
  instanceId: Id;
  action: DesktopStandardActionKind;
  /**
   * Text argument for `setTitle` and `appendLine`; absent for actions that take
   * none. Kept as a plain string so the payload stays JSON-only.
   */
  text?: string;
}

export interface DesktopTrackMouseActionPayload {
  action: "trackMouse";
  /** Optional app instance; trackMouse acts on the coincident video clip. */
  instanceId?: Id;
  /** Zoom factor during mouse tracking; defaults to 1.5. */
  zoom?: number;
  /** Camera follow smoothing window in ms; defaults to 180. */
  smoothingMs?: number;
}

export type DesktopActionPayload =
  | DesktopStandardActionPayload
  | DesktopTrackMouseActionPayload;

/** The simulated pointer, expressed as waypoints it travels through. */
export interface DesktopCursorPayload {
  /** At least one waypoint. A single waypoint pins the pointer in place. */
  waypoints: Vec2[];
  /** Offset from the pointer's tip to its hotspot, in project pixels. */
  hotspot: Vec2;
  visible: boolean;
}

/**
 * Camera row payload family.
 *
 * Pose, shake, and lens share one versioned payload with a discriminated
 * `action` so that the three timeline rows cannot drift into three subtly
 * different schemas.
 */
export interface DesktopCameraPoseAction {
  action: "pose";
  /** Camera offset from the composition centre, in project pixels. */
  offset: Vec2;
  scale: number;
  rotationDegrees: number;
}

export interface DesktopCameraShakeAction {
  action: "shake";
  amplitude: number;
  frequency: number;
  seed: number;
}

export interface DesktopCameraLensAction {
  action: "lens";
  /** Simulated focal length in millimetres. */
  focalLengthMm: number;
  /** Depth-of-field strength, 0..1. */
  aperture: Unit;
}

export type DesktopCameraPayload =
  | DesktopCameraPoseAction
  | DesktopCameraShakeAction
  | DesktopCameraLensAction;

/** Every payload shape the Desktop Stage extension can carry. */
export type DesktopPayload =
  | DesktopAppPayload
  | DesktopActionPayload
  | DesktopCursorPayload
  | DesktopCameraPayload;

/** True for the app-window content type the preview and export both draw. */
export const DESKTOP_WINDOW_CONTENT_TYPE = "desktop-stage/app-window@1";

/**
 * What the renderer needs to draw one app window at one frame.
 *
 * Emitted by the Desktop Stage scene adapter, not stored in the document: a
 * document says what is authored, a resolved frame says what is drawn.
 */
export interface DesktopWindowDrawable {
  instanceId: Id;
  appKind: DesktopAppKind;
  title: string;
  lines: string[];
  look: DesktopAppLook;
}
