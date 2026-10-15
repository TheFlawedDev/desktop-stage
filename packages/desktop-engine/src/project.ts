/**
 * The Desktop Stage document extension: payload parsing and document factories.
 *
 * The document stays Cutaway's `ProjectDocument`; this module owns the rules for
 * the versioned payloads that ride in its plugin seam. Two responsibilities,
 * kept together because they define the same contract:
 *
 * 1. **Parse** plugin content into a typed payload, or explain exactly why it
 *    cannot be read. Nothing here throws: a project must always open, and an
 *    unreadable payload is reported and skipped rather than fatal.
 * 2. **Build** the Desktop Stage document skeleton — the track set a desktop
 *    scene uses and the app clips inside it.
 */

import type {
  Clip,
  ClipContent,
  DesktopActionKind,
  DesktopActionPayload,
  DesktopStandardActionPayload,
  DesktopAppKind,
  DesktopAppLook,
  DesktopAppPayload,
  DesktopCameraPayload,
  DesktopContentType,
  DesktopCursorPayload,
  DesktopPayload,
  Id,
  PluginContent,
  ProjectDocument,
  ProjectSettings,
  Track,
  TrackKind,
} from "@cutaway/types";
import {
  DESKTOP_CONTENT_TYPES,
} from "@cutaway/types";
import {
  createClip,
  createExportSettings,
  createProject,
  createProjectSettings,
  createTrack,
} from "@cutaway/utils";

/** Every content type the extension knows, at the versions it knows them. */
const KNOWN_CONTENT_TYPES: readonly string[] = Object.values(DESKTOP_CONTENT_TYPES);

/** Prefix that marks a content type as belonging to this extension. */
export const DESKTOP_CONTENT_TYPE_PREFIX = "desktop-stage/";

/** The version this build writes and reads. */
export const DESKTOP_CONTENT_VERSION = 1;

export const DESKTOP_APP_KINDS: readonly DesktopAppKind[] = [
  "browser",
  "code",
  "terminal",
  "legacyText",
];

export const DESKTOP_ACTION_KINDS: readonly DesktopActionKind[] = [
  "open",
  "close",
  "focus",
  "setTitle",
  "appendLine",
  "trackMouse",
];

export const DEFAULT_DESKTOP_LOOK: DesktopAppLook = {
  accentColor: "#7c6cff",
  theme: "dark",
  chrome: "window",
  cornerRadius: 8,
  showTitleBar: true,
};

export type DesktopPayloadFamily = "app" | "action" | "cursor" | "camera";

export type DesktopParseFailureCode = "unknown-type" | "unsupported-version" | "malformed";

export type DesktopParseResult =
  | { ok: true; contentType: DesktopContentType; family: DesktopPayloadFamily; payload: DesktopPayload }
  | { ok: false; code: DesktopParseFailureCode; message: string };

/** True for any content type that claims to belong to Desktop Stage. */
export function isDesktopContentType(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(DESKTOP_CONTENT_TYPE_PREFIX);
}

/** True when a clip carries Desktop Stage plugin content. */
export function isDesktopPluginContent(content: ClipContent): content is PluginContent {
  return content.kind === "plugin" && isDesktopContentType(content.contentType);
}

/**
 * Splits a content type into its family and version.
 *
 * `desktop-stage/app@2` → `{ family: "desktop-stage/app", version: "2" }`.
 * A missing `@` yields a null version, which reads as version 0 — older than
 * everything this build supports, and therefore migrated rather than accepted.
 */
export function splitContentType(contentType: string): { base: string; version: number | null } {
  const separator = contentType.lastIndexOf("@");
  if (separator < 0) return { base: contentType, version: null };

  const parsed = Number(contentType.slice(separator + 1));
  return {
    base: contentType.slice(0, separator),
    version: Number.isInteger(parsed) ? parsed : null,
  };
}

/** The payload family a content type names, or null for anything unknown. */
export function desktopFamilyFor(contentType: string): DesktopPayloadFamily | null {
  const { base } = splitContentType(contentType);
  switch (base) {
    case "desktop-stage/app":
      return "app";
    case "desktop-stage/action":
      return "action";
    case "desktop-stage/cursor":
      return "cursor";
    case "desktop-stage/camera":
      return "camera";
    default:
      return null;
  }
}

/** The track kind a payload family belongs on, for row-mismatch reporting. */
export function expectedTrackKind(family: DesktopPayloadFamily): TrackKind {
  switch (family) {
    case "app":
      return "desktop";
    case "action":
      return "action";
    case "cursor":
      return "cursor";
    case "camera":
      return "camera";
  }
}

/**
 * Every track kind a payload family may sit on.
 *
 * The camera family is the reason this is a list rather than one kind: pose,
 * shake, and lens clips share one payload schema and occupy three sibling rows.
 */
export function trackKindsForFamily(family: DesktopPayloadFamily): readonly TrackKind[] {
  switch (family) {
    case "app":
      return ["desktop"];
    case "action":
      return ["action"];
    case "cursor":
      return ["cursor"];
    case "camera":
      return ["camera", "camera-effect", "lens"];
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readVec2(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;
  return { x: value.x, y: value.y };
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Parses plugin content into a Desktop Stage payload.
 *
 * Failure is explicit and typed rather than a thrown error: the loader reports
 * which clip was skipped and why, and the rest of the project opens.
 */
export function parseDesktopContent(contentType: string, data: unknown): DesktopParseResult {
  if (!isDesktopContentType(contentType)) {
    return { ok: false, code: "unknown-type", message: `"${contentType}" is not a Desktop Stage content type.` };
  }

  const family = desktopFamilyFor(contentType);
  if (!family) {
    return {
      ok: false,
      code: "unknown-type",
      message: `Desktop Stage content type "${contentType}" is not one this build knows.`,
    };
  }

  const { version } = splitContentType(contentType);
  if (version !== DESKTOP_CONTENT_VERSION) {
    // Named explicitly so a project written by a newer build is reported as
    // such, instead of looking like corrupt data.
    return {
      ok: false,
      code: "unsupported-version",
      message: `Desktop Stage ${family} payload version ${version ?? "none"} is not supported (this build reads version ${DESKTOP_CONTENT_VERSION}).`,
    };
  }

  if (!isRecord(data)) {
    return { ok: false, code: "malformed", message: `Desktop Stage ${family} payload is not an object.` };
  }

  const parsed =
    family === "app"
      ? parseAppPayload(data)
      : family === "action"
        ? parseActionPayload(data)
        : family === "cursor"
          ? parseCursorPayload(data)
          : parseCameraPayload(data);

  if (!parsed.ok) {
    return { ok: false, code: "malformed", message: `Desktop Stage ${family} payload: ${parsed.message}` };
  }

  return {
    ok: true,
    contentType: contentType as DesktopContentType,
    family,
    payload: parsed.payload,
  };
}

type PayloadResult<T> = { ok: true; payload: T } | { ok: false; message: string };

function parseAppPayload(data: Record<string, unknown>): PayloadResult<DesktopAppPayload> {
  const instanceId = readString(data.instanceId);
  if (!instanceId) return { ok: false, message: "instanceId must be a non-empty string." };

  const appKind = readString(data.appKind);
  if (!appKind || !DESKTOP_APP_KINDS.includes(appKind as DesktopAppKind)) {
    return { ok: false, message: `appKind must be one of ${DESKTOP_APP_KINDS.join(", ")}.` };
  }

  const title = readString(data.title);
  if (title === null) return { ok: false, message: "title must be a string." };

  if (!Array.isArray(data.lines) || !data.lines.every((line) => typeof line === "string")) {
    return { ok: false, message: "lines must be an array of strings." };
  }

  const size = isRecord(data.size) ? data.size : null;
  if (
    !size ||
    !isFiniteNumber(size.width) ||
    !isFiniteNumber(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    return { ok: false, message: "size must have finite, positive width and height." };
  }

  const look = isRecord(data.look) ? data.look : null;
  if (!look) return { ok: false, message: "look must be an object." };

  const accentColor = readString(look.accentColor);
  if (!accentColor) return { ok: false, message: "look.accentColor must be a non-empty string." };

  const theme = readString(look.theme);
  if (theme !== "dark" && theme !== "light") {
    return { ok: false, message: "look.theme must be dark or light." };
  }

  const chrome = readString(look.chrome);
  if (chrome !== "window" && chrome !== "plain") {
    return { ok: false, message: "look.chrome must be window or plain." };
  }

  if (!isFiniteNumber(look.cornerRadius) || look.cornerRadius < 0) {
    return { ok: false, message: "look.cornerRadius must be a finite, non-negative number." };
  }

  if (typeof look.showTitleBar !== "boolean") {
    return { ok: false, message: "look.showTitleBar must be a boolean." };
  }

  if (!isFiniteNumber(data.zIndex)) {
    return { ok: false, message: "zIndex must be a finite number." };
  }

  if (typeof data.initiallyVisible !== "boolean") {
    return { ok: false, message: "initiallyVisible must be a boolean." };
  }

  return {
    ok: true,
    payload: {
      instanceId,
      appKind: appKind as DesktopAppKind,
      title,
      lines: [...data.lines] as string[],
      size: { width: size.width, height: size.height },
      look: {
        accentColor,
        theme,
        chrome,
        cornerRadius: look.cornerRadius,
        showTitleBar: look.showTitleBar,
      },
      zIndex: data.zIndex,
      initiallyVisible: data.initiallyVisible,
    },
  };
}

function parseActionPayload(data: Record<string, unknown>): PayloadResult<DesktopActionPayload> {
  const action = readString(data.action);
  if (!action || !DESKTOP_ACTION_KINDS.includes(action as DesktopActionKind)) {
    return { ok: false, message: `action must be one of ${DESKTOP_ACTION_KINDS.join(", ")}.` };
  }

  if (action === "trackMouse") {
    let zoom: number | undefined;
    if (data.zoom !== undefined) {
      if (!isFiniteNumber(data.zoom) || data.zoom < 1.0) {
        return { ok: false, message: "zoom must be a finite number >= 1.0." };
      }
      zoom = data.zoom;
    }

    let smoothingMs: number | undefined;
    if (data.smoothingMs !== undefined) {
      if (!isFiniteNumber(data.smoothingMs) || data.smoothingMs < 0) {
        return { ok: false, message: "smoothingMs must be a finite, non-negative number." };
      }
      smoothingMs = data.smoothingMs;
    }

    const instanceId = readString(data.instanceId) ?? undefined;
    return {
      ok: true,
      payload: {
        action: "trackMouse",
        ...(instanceId ? { instanceId } : {}),
        ...(zoom !== undefined ? { zoom } : {}),
        ...(smoothingMs !== undefined ? { smoothingMs } : {}),
      },
    };
  }

  const instanceId = readString(data.instanceId);
  if (!instanceId) return { ok: false, message: "instanceId must be a non-empty string." };

  const text = data.text;
  if (text !== undefined && typeof text !== "string") {
    return { ok: false, message: "text must be a string when present." };
  }

  // The two text-carrying actions are meaningless without their argument, and
  // accepting them silently would produce an action that does nothing.
  if ((action === "setTitle" || action === "appendLine") && !text) {
    return { ok: false, message: `action "${action}" requires text.` };
  }

  return {
    ok: true,
    payload: {
      instanceId,
      action: action as DesktopStandardActionPayload["action"],
      ...(text ? { text } : {}),
    },
  };
}

function parseCursorPayload(data: Record<string, unknown>): PayloadResult<DesktopCursorPayload> {
  if (!Array.isArray(data.waypoints) || data.waypoints.length === 0) {
    return { ok: false, message: "waypoints must be a non-empty array." };
  }

  const waypoints: { x: number; y: number }[] = [];
  for (const candidate of data.waypoints) {
    const point = readVec2(candidate);
    if (!point) return { ok: false, message: "every waypoint must have finite x and y." };
    waypoints.push(point);
  }

  const hotspot = readVec2(data.hotspot);
  if (!hotspot) return { ok: false, message: "hotspot must have finite x and y." };

  if (typeof data.visible !== "boolean") {
    return { ok: false, message: "visible must be a boolean." };
  }

  return { ok: true, payload: { waypoints, hotspot, visible: data.visible } };
}

function parseCameraPayload(data: Record<string, unknown>): PayloadResult<DesktopCameraPayload> {
  const action = readString(data.action);

  if (action === "pose") {
    const offset = readVec2(data.offset);
    if (!offset) return { ok: false, message: "pose.offset must have finite x and y." };
    if (!isFiniteNumber(data.scale) || data.scale <= 0) {
      return { ok: false, message: "pose.scale must be a finite, positive number." };
    }
    if (!isFiniteNumber(data.rotationDegrees)) {
      return { ok: false, message: "pose.rotationDegrees must be a finite number." };
    }
    return {
      ok: true,
      payload: { action: "pose", offset, scale: data.scale, rotationDegrees: data.rotationDegrees },
    };
  }

  if (action === "shake") {
    if (!isFiniteNumber(data.amplitude) || data.amplitude < 0) {
      return { ok: false, message: "shake.amplitude must be a finite, non-negative number." };
    }
    if (!isFiniteNumber(data.frequency) || data.frequency <= 0) {
      return { ok: false, message: "shake.frequency must be a finite, positive number." };
    }
    if (!isFiniteNumber(data.seed)) {
      return { ok: false, message: "shake.seed must be a finite number." };
    }
    return {
      ok: true,
      payload: { action: "shake", amplitude: data.amplitude, frequency: data.frequency, seed: data.seed },
    };
  }

  if (action === "lens") {
    if (!isFiniteNumber(data.focalLengthMm) || data.focalLengthMm <= 0) {
      return { ok: false, message: "lens.focalLengthMm must be a finite, positive number." };
    }
    if (!isFiniteNumber(data.aperture) || data.aperture < 0 || data.aperture > 1) {
      return { ok: false, message: "lens.aperture must be a number between 0 and 1." };
    }
    return {
      ok: true,
      payload: { action: "lens", focalLengthMm: data.focalLengthMm, aperture: data.aperture },
    };
  }

  return { ok: false, message: "action must be pose, shake, or lens." };
}

/** True when the content type is one this build writes. */
export function isKnownDesktopContentType(contentType: string): boolean {
  return KNOWN_CONTENT_TYPES.includes(contentType);
}

// ---------------------------------------------------------------------------
// Document factories
// ---------------------------------------------------------------------------

/** Row heights, in timeline pixels. */
const TRACK_HEIGHTS: Partial<Record<TrackKind, number>> = {
  audio: 56,
  desktop: 72,
  action: 48,
  cursor: 48,
  camera: 44,
  "camera-effect": 44,
  lens: 44,
};

export const DESKTOP_TRACK_NAMES: Partial<Record<TrackKind, string>> = {
  desktop: "Desktop",
  action: "Actions",
  cursor: "Cursor",
  camera: "Camera",
  "camera-effect": "Camera shake",
  lens: "Lens",
};

/** Creates a track with Desktop Stage naming and row size for its kind. */
export function createDesktopTrack(
  kind: TrackKind,
  index: number,
  overrides: { id?: Id; name?: string } = {},
): Track {
  const name = overrides.name ?? DESKTOP_TRACK_NAMES[kind];

  const base = createTrack({
    kind,
    index,
    ...(overrides.id ? { id: overrides.id } : {}),
    ...(name ? { name } : {}),
  });

  return { ...base, height: TRACK_HEIGHTS[kind] ?? base.height };
}

/** Desktop Stage's default composition: a 1000 × 600 stage at 30 fps. */
export function createDesktopSettings(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return createProjectSettings({
    resolution: { width: 1000, height: 600 },
    aspectRatio: "custom",
    frameRate: 30,
    backgroundColor: "#1b242c",
    ...overrides,
  });
}

/**
 * A new, empty Desktop Stage project.
 *
 * Upstream `createProject` opens with a video and an audio track, which is the
 * right default for a video editor and the wrong one for authoring a fictional
 * desktop. This keeps the same document shape with the rows a desktop scene
 * actually uses, so an empty project can accept app clips immediately.
 */
export function createDesktopProject(name = "Untitled desktop"): ProjectDocument {
  const base = createProject(name);
  const settings = createDesktopSettings();

  const desktopTrack = createDesktopTrack("desktop", 0, { id: "track-desktop" });
  const actionTrack = createDesktopTrack("action", 1, { id: "track-action" });

  return {
    ...base,
    settings,
    exportSettings: createExportSettings(settings),
    entities: {
      ...base.entities,
      tracks: { [desktopTrack.id]: desktopTrack, [actionTrack.id]: actionTrack },
    },
    trackOrder: [desktopTrack.id, actionTrack.id],
    durationFrames: 0,
  };
}

export interface CreateAppClipOptions {
  id: Id;
  trackId: Id;
  startFrame: number;
  durationFrames: number;
  payload: DesktopAppPayload;
  name?: string;
}

/**
 * Wraps an app payload in a clip.
 *
 * The visual envelope (transform, appearance) is created neutral; callers that
 * have authored animation — the v1 converter — replace the parts they animate.
 */
export function createAppClip(options: CreateAppClipOptions): Clip {
  return createClip({
    id: options.id,
    trackId: options.trackId,
    startFrame: options.startFrame,
    durationFrames: options.durationFrames,
    content: {
      kind: "plugin",
      contentType: DESKTOP_CONTENT_TYPES.app,
      data: options.payload as unknown as Record<string, unknown>,
    },
    ...(options.name ? { name: options.name } : {}),
  });
}

export interface CreateTrackMouseClipOptions {
  id: Id;
  trackId: Id;
  startFrame: number;
  durationFrames: number;
  zoom?: number;
  smoothingMs?: number;
  name?: string;
}

/**
 * Creates an action clip that triggers smoothed mouse camera tracking over coincident video.
 */
export function createTrackMouseClip(options: CreateTrackMouseClipOptions): Clip {
  return createClip({
    id: options.id,
    trackId: options.trackId,
    startFrame: options.startFrame,
    durationFrames: options.durationFrames,
    content: {
      kind: "plugin",
      contentType: DESKTOP_CONTENT_TYPES.action,
      data: {
        action: "trackMouse",
        ...(options.zoom !== undefined ? { zoom: options.zoom } : {}),
        ...(options.smoothingMs !== undefined ? { smoothingMs: options.smoothingMs } : {}),
      },
    },
    name: options.name ?? "Track Mouse",
  });
}

/** App instance ids present in a project, for referential checks. */
export function appInstanceIds(project: ProjectDocument): Set<Id> {
  const ids = new Set<Id>();

  for (const clip of Object.values(project.entities.clips)) {
    if (!isDesktopPluginContent(clip.content)) continue;
    const parsed = parseDesktopContent(clip.content.contentType, clip.content.data);
    if (parsed.ok && parsed.family === "app") {
      ids.add((parsed.payload as DesktopAppPayload).instanceId);
    }
  }

  return ids;
}
