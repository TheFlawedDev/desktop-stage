/**
 * Loading validation and repair.
 *
 * Project files are plain JSON on the user's disk. They get hand-edited, synced
 * by tools that mangle them, truncated by full disks, and written by plugins
 * with bugs. So loading is **repair-oriented, not gatekeeping**: salvage every
 * clip that can be salvaged, drop what cannot, and report precisely what was
 * lost. Refusing to open a project because one clip references a deleted track
 * would be the worst possible outcome for someone with hours of work in it.
 *
 * `validateProject` is also **total**: every field it reads is type-checked
 * before use, so no shape of JSON can throw out of it. A returned document is
 * always safe to hand to the renderer (`resolveScene`), the media panel, and the
 * timeline — every clip has a full transform/appearance/mask/effect set, every
 * media asset has metadata, and every caption track has an array of blocks.
 *
 * The Desktop Stage extension is validated here too. Two of its rules differ
 * from the generic ones and are deliberate:
 *
 * - A payload version this build does not know is **dropped**: guessing at a
 *   newer schema would silently misread it, and a wrong window is worse than an
 *   absent one.
 * - An action whose target app instance is missing is **kept and flagged**. The
 *   timing the user authored is real work; the action simply has no effect until
 *   the target exists.
 */

import type {
  Animatable,
  Appearance,
  BlendMode,
  CaptionBlock,
  CaptionTrackData,
  CaptionWord,
  Clip,
  ClipContent,
  ClipTransition,
  ColorGrade,
  ColorWheel,
  CurvePoint,
  Easing,
  EffectInstance,
  EffectParamValue,
  Mask,
  MaskShape,
  Marker,
  MediaAsset,
  MediaKind,
  MediaMetadata,
  MediaSource,
  MotionPath,
  ProjectDocument,
  Track,
  TrackKind,
  Transform,
  Vec2,
} from "@cutaway/types";
import { EASING_LINEAR } from "@cutaway/types";
import {
  createAppearance,
  createClip,
  createColorGrade,
  createProject,
  createTrack,
} from "@cutaway/utils";
import {
  isDesktopPluginContent,
  parseDesktopContent,
  trackKindsForFamily,
} from "@desktop-stage/desktop-engine";

export type IssueSeverity =
  /** Content could not be understood and is gone. */
  | "dropped"
  /** Content was understandable but wrong, and has been corrected. */
  | "repaired"
  /** Content is intact but cannot take effect; reported, never changed. */
  | "flagged";

export interface ValidationIssue {
  severity: IssueSeverity;
  /** What was affected, e.g. `clip:abc123`. */
  subject: string;
  message: string;
}

export interface ValidationResult {
  project: ProjectDocument;
  issues: ValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function isFiniteVec2(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

/**
 * Writes an own property onto a map built from user data.
 *
 * A plain `map["__proto__"] = value` assignment invokes the `Object.prototype`
 * setter instead of storing anything, silently replacing the map's prototype.
 * Entity ids come straight from the file, so they get the explicit write.
 */
function setOwn<T>(map: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(map, key, { value, enumerable: true, writable: true, configurable: true });
}

const BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
];

const MASK_SHAPES = ["rectangle", "ellipse", "path"] as const;
type MaskShapeKind = (typeof MASK_SHAPES)[number];

const MASK_MODES = ["add", "subtract", "intersect", "difference"] as const;

const TRACK_KINDS: readonly TrackKind[] = [
  "video",
  "audio",
  "caption",
  "overlay",
  "desktop",
  "action",
  "cursor",
  "camera",
  "camera-effect",
  "lens",
];

const MEDIA_KINDS: readonly MediaKind[] = ["video", "audio", "image", "gif", "font"];

const TEXT_ALIGNS = ["left", "center", "right"] as const;

const SHAPE_KINDS = ["rectangle", "ellipse", "triangle", "polygon", "star", "line"] as const;

const EASING_KINDS = [
  "hold",
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "bezier",
  "spring",
] as const;

/**
 * Registry key of the fallback caption preset.
 *
 * Kept as a literal rather than imported so `project-io` does not grow a
 * dependency on `caption-engine`; it mirrors `DEFAULT_CAPTION_PRESET_ID`, which
 * `getCaptionPreset` already falls back to.
 */
const DEFAULT_CAPTION_PRESET_ID = "core.captions.tiktok";

const DEFAULT_MEDIA_METADATA: MediaMetadata = {
  durationSeconds: 0,
  frameRate: null,
  dimensions: null,
  hasAudio: false,
  hasVideo: false,
  codec: null,
  sampleRate: null,
  channels: null,
  byteSize: 0,
};

/**
 * Validates and repairs a raw document.
 *
 * Anything unrecoverable falls back to the corresponding piece of a fresh
 * project, so the return value is always a document the editor can open.
 */
export function validateProject(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const fallback = createProject();

  if (!isRecord(raw)) {
    issues.push({
      severity: "dropped",
      subject: "project",
      message: "File is not a project document; opened an empty project instead.",
    });
    return { project: fallback, issues };
  }

  const entities = isRecord(raw.entities) ? raw.entities : {};

  const tracks = validateTracks(entities.tracks, issues, fallback);
  const media = validateMedia(entities.media, issues);
  const { clips, actionTargets, appInstances } = validateClips(
    entities.clips,
    tracks,
    media,
    issues,
  );

  validateActionTargets(actionTargets, appInstances, issues);

  const trackOrder = validateTrackOrder(raw.trackOrder, tracks, issues);
  const settings = validateSettings(raw.settings, fallback);

  const durationFrames = Object.values(clips).reduce(
    (max, clip) => Math.max(max, clip.startFrame + clip.durationFrames),
    0,
  );

  return {
    project: {
      schemaVersion: asFiniteNumber(raw.schemaVersion, fallback.schemaVersion),
      id: asString(raw.id, fallback.id),
      name: asString(raw.name, "Untitled Project"),
      createdAt: asFiniteNumber(raw.createdAt, Date.now()),
      modifiedAt: asFiniteNumber(raw.modifiedAt, Date.now()),
      settings,
      entities: {
        clips,
        tracks,
        media,
        markers: validateMarkers(entities.markers, issues),
        captionTracks: validateCaptionTracks(entities.captionTracks, media, issues),
      },
      trackOrder,
      durationFrames,
      exportSettings: isRecord(raw.exportSettings)
        ? { ...fallback.exportSettings, ...(raw.exportSettings as object) }
        : fallback.exportSettings,
      requiredPlugins: Array.isArray(raw.requiredPlugins)
        ? raw.requiredPlugins.filter((id): id is string => typeof id === "string")
        : [],
    },
    issues,
  };
}

function validateSettings(raw: unknown, fallback: ProjectDocument): ProjectDocument["settings"] {
  if (!isRecord(raw)) return fallback.settings;

  const resolution = isRecord(raw.resolution) ? raw.resolution : {};

  return {
    ...fallback.settings,
    ...raw,
    // Guarded individually: a zero or negative dimension divides by zero in the
    // preview's aspect fit and produces an invisible, un-debuggable canvas.
    resolution: {
      width: Math.max(1, asFiniteNumber(resolution.width, fallback.settings.resolution.width)),
      height: Math.max(1, asFiniteNumber(resolution.height, fallback.settings.resolution.height)),
    },
    frameRate: Math.max(1, asFiniteNumber(raw.frameRate, fallback.settings.frameRate)),
  } as ProjectDocument["settings"];
}

function validateTracks(
  raw: unknown,
  issues: ValidationIssue[],
  fallback: ProjectDocument,
): Record<string, Track> {
  if (!isRecord(raw)) return fallback.entities.tracks;

  const tracks: Record<string, Track> = {};

  for (const [id, value] of Object.entries(raw)) {
    const subject = `track:${id}`;

    if (!isRecord(value) || typeof value.id !== "string") {
      issues.push({
        severity: "dropped",
        subject,
        message: "Track is malformed and was removed.",
      });
      continue;
    }

    const kind = isOneOf(value.kind, TRACK_KINDS) ? value.kind : "video";
    if (kind !== value.kind) {
      issues.push({
        severity: "repaired",
        subject,
        message: "Track kind was not recognisable and was set to video.",
      });
    }

    const base = createTrack({ kind, index: asFiniteNumber(value.index, 0) });

    setOwn(tracks, id, {
      ...base,
      id: value.id,
      name: asString(value.name, base.name),
      kind,
      index: asFiniteNumber(value.index, base.index),
      locked: asBoolean(value.locked, false),
      hidden: asBoolean(value.hidden, false),
      muted: asBoolean(value.muted, false),
      solo: asBoolean(value.solo, false),
      height: Math.max(1, asFiniteNumber(value.height, base.height)),
      volume: Math.min(1, Math.max(0, asFiniteNumber(value.volume, 1))),
      effects: repairEffects(value.effects, subject, issues),
    });
  }

  // A project with clips but no tracks cannot render anything, so give it the
  // default pair rather than opening onto an empty editor.
  if (Object.keys(tracks).length === 0) return fallback.entities.tracks;

  return tracks;
}

function validateMedia(raw: unknown, issues: ValidationIssue[]): Record<string, MediaAsset> {
  if (!isRecord(raw)) return {};

  const media: Record<string, MediaAsset> = {};

  for (const [id, value] of Object.entries(raw)) {
    const subject = `media:${id}`;

    if (!isRecord(value) || typeof value.id !== "string") {
      issues.push({
        severity: "dropped",
        subject,
        message: "Media reference is malformed and was removed.",
      });
      continue;
    }

    const source = repairMediaSource(value.source);
    if (!source) {
      issues.push({
        severity: "dropped",
        subject,
        message: "Media source is malformed and was removed.",
      });
      continue;
    }

    const kind = isOneOf(value.kind, MEDIA_KINDS) ? value.kind : "image";
    if (kind !== value.kind) {
      issues.push({
        severity: "repaired",
        subject,
        message: "Media kind was not recognisable and was set to image.",
      });
    }

    setOwn(media, id, {
      id: value.id,
      name: asString(value.name, id),
      kind,
      mimeType: asString(value.mimeType, "application/octet-stream"),
      source,
      metadata: repairMediaMetadata(value.metadata, subject, issues),
      thumbnailKey: typeof value.thumbnailKey === "string" ? value.thumbnailKey : null,
      waveformKey: typeof value.waveformKey === "string" ? value.waveformKey : null,
      importedAt: asFiniteNumber(value.importedAt, 0),
    });
  }

  return media;
}

/** Recognises a media source, or null when its variant cannot be read. */
function repairMediaSource(raw: unknown): MediaSource | null {
  if (!isRecord(raw)) return null;

  switch (raw.type) {
    case "indexeddb":
      return typeof raw.key === "string" ? { type: "indexeddb", key: raw.key } : null;
    case "filesystem":
      return typeof raw.handleId === "string" && typeof raw.path === "string"
        ? { type: "filesystem", handleId: raw.handleId, path: raw.path }
        : null;
    case "url":
      return typeof raw.url === "string" ? { type: "url", url: raw.url } : null;
    case "builtin":
      return typeof raw.path === "string" ? { type: "builtin", path: raw.path } : null;
    default:
      return null;
  }
}

/**
 * Repairs media metadata.
 *
 * The media panel and the byte-size formatter read fields directly, so a
 * missing `durationSeconds` or `byteSize` renders as `NaN` at best and throws at
 * worst. Every field is defaulted rather than the asset being dropped: losing
 * the reference because its probe crashed would lose the user's media link too.
 */
function repairMediaMetadata(
  raw: unknown,
  subject: string,
  issues: ValidationIssue[],
): MediaMetadata {
  if (!isRecord(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Media metadata was missing and has been filled with defaults.",
    });
    return { ...DEFAULT_MEDIA_METADATA };
  }

  // `dimensions` is a `Size`, not a `Vec2`: read its two fields directly.
  const size =
    isRecord(raw.dimensions) &&
    isFiniteNumber(raw.dimensions.width) &&
    isFiniteNumber(raw.dimensions.height)
      ? { width: raw.dimensions.width, height: raw.dimensions.height }
      : null;

  const clean =
    isFiniteNumber(raw.durationSeconds) &&
    (isFiniteNumber(raw.frameRate) || raw.frameRate === null) &&
    (size !== null || raw.dimensions === null) &&
    typeof raw.hasAudio === "boolean" &&
    typeof raw.hasVideo === "boolean" &&
    (typeof raw.codec === "string" || raw.codec === null) &&
    (isFiniteNumber(raw.sampleRate) || raw.sampleRate === null) &&
    (isFiniteNumber(raw.channels) || raw.channels === null) &&
    isFiniteNumber(raw.byteSize);

  if (!clean) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Media metadata was incomplete and has been filled with defaults.",
    });
  }

  return {
    durationSeconds: asFiniteNumber(raw.durationSeconds, 0),
    frameRate: isFiniteNumber(raw.frameRate) ? raw.frameRate : null,
    dimensions: size,
    hasAudio: asBoolean(raw.hasAudio, false),
    hasVideo: asBoolean(raw.hasVideo, false),
    codec: typeof raw.codec === "string" ? raw.codec : null,
    sampleRate: isFiniteNumber(raw.sampleRate) ? raw.sampleRate : null,
    channels: isFiniteNumber(raw.channels) ? raw.channels : null,
    byteSize: asFiniteNumber(raw.byteSize, 0),
  };
}

function validateMarkers(raw: unknown, issues: ValidationIssue[]): Record<string, Marker> {
  if (!isRecord(raw)) return {};

  const markers: Record<string, Marker> = {};

  for (const [id, value] of Object.entries(raw)) {
    if (!isRecord(value) || typeof value.id !== "string") {
      issues.push({
        severity: "dropped",
        subject: `marker:${id}`,
        message: "Marker is malformed and was removed.",
      });
      continue;
    }

    setOwn(markers, id, {
      id: value.id,
      frame: asFiniteNumber(value.frame, 0),
      label: asString(value.label, ""),
      color: asString(value.color, "#ffffff"),
      durationFrames: Math.max(0, asFiniteNumber(value.durationFrames, 0)),
    });
  }

  return markers;
}

/**
 * Repairs caption tracks.
 *
 * `resolveScene` iterates every block of every track and reads block frames and
 * words unconditionally, so a track with a non-array `blocks` or a null block
 * takes the whole preview down. Tracks that survive have a guaranteed array of
 * readable blocks.
 */
function validateCaptionTracks(
  raw: unknown,
  media: Record<string, MediaAsset>,
  issues: ValidationIssue[],
): Record<string, CaptionTrackData> {
  if (!isRecord(raw)) return {};

  const tracks: Record<string, CaptionTrackData> = {};

  for (const [id, value] of Object.entries(raw)) {
    const subject = `captionTrack:${id}`;

    if (!isRecord(value) || typeof value.id !== "string") {
      issues.push({
        severity: "dropped",
        subject,
        message: "Caption track is malformed and was removed.",
      });
      continue;
    }

    let sourceMediaId: string | null = null;
    if (typeof value.sourceMediaId === "string") {
      if (Object.hasOwn(media, value.sourceMediaId)) {
        sourceMediaId = value.sourceMediaId;
      } else {
        issues.push({
          severity: "repaired",
          subject,
          message: "Caption track referenced missing media; the reference was cleared.",
        });
      }
    }

    setOwn(tracks, id, {
      id: value.id,
      sourceMediaId,
      language: asString(value.language, "en"),
      blocks: repairCaptionBlocks(value.blocks, subject, issues),
      presetId: asString(value.presetId, DEFAULT_CAPTION_PRESET_ID),
    });
  }

  return tracks;
}

function repairCaptionBlocks(
  raw: unknown,
  subject: string,
  issues: ValidationIssue[],
): CaptionBlock[] {
  if (!Array.isArray(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Caption blocks were missing or malformed and have been reset.",
    });
    return [];
  }

  const blocks: CaptionBlock[] = [];

  raw.forEach((candidate, index) => {
    const block = repairCaptionBlock(candidate, index, subject, issues);
    if (block) blocks.push(block);
  });

  return blocks;
}

function repairCaptionBlock(
  raw: unknown,
  index: number,
  subject: string,
  issues: ValidationIssue[],
): CaptionBlock | null {
  const label = `block ${index + 1}`;

  if (!isRecord(raw) || typeof raw.id !== "string" || !Array.isArray(raw.words)) {
    issues.push({
      severity: "dropped",
      subject,
      message: `Caption ${label} was malformed and was removed.`,
    });
    return null;
  }

  const words: CaptionWord[] = [];
  for (const candidate of raw.words) {
    if (!isRecord(candidate) || typeof candidate.text !== "string") {
      issues.push({
        severity: "dropped",
        subject,
        message: `Caption ${label} had a malformed word, which was removed.`,
      });
      continue;
    }

    const startFrame = Math.max(0, asFiniteNumber(candidate.startFrame, 0));
    const endFrame = Math.max(startFrame, asFiniteNumber(candidate.endFrame, startFrame));
    words.push({
      text: candidate.text,
      startFrame,
      endFrame,
      confidence: Math.min(1, Math.max(0, asFiniteNumber(candidate.confidence, 1))),
    });
  }

  if (words.length === 0) {
    issues.push({
      severity: "dropped",
      subject,
      message: `Caption ${label} had no readable words and was removed.`,
    });
    return null;
  }

  const firstWord = words[0]!;
  const startFrame = Math.max(0, asFiniteNumber(raw.startFrame, firstWord.startFrame));

  // A loop, not `Math.max(...words.map(…))`: the fallback is evaluated eagerly,
  // and a block with enough words blows the argument limit with a RangeError
  // that fails the whole load. A transcript in one block is a real shape.
  let lastWordEnd = firstWord.endFrame;
  for (const word of words) lastWordEnd = Math.max(lastWordEnd, word.endFrame);

  const rawEnd = asFiniteNumber(raw.endFrame, lastWordEnd);

  return {
    id: raw.id,
    words,
    startFrame,
    endFrame: Math.max(startFrame + 1, rawEnd),
    styleOverrideId: typeof raw.styleOverrideId === "string" ? raw.styleOverrideId : null,
  };
}

interface ActionTarget {
  clipId: string;
  instanceId: string;
}

interface ClipValidation {
  clips: Record<string, Clip>;
  /** Action clips and the app instance each one names. */
  actionTargets: ActionTarget[];
  /** App instance ids the document actually defines. */
  appInstances: Set<string>;
}

function validateClips(
  raw: unknown,
  tracks: Record<string, Track>,
  media: Record<string, MediaAsset>,
  issues: ValidationIssue[],
): ClipValidation {
  const clips: Record<string, Clip> = {};
  const actionTargets: ActionTarget[] = [];
  const appInstances = new Set<string>();

  if (!isRecord(raw)) return { clips, actionTargets, appInstances };

  for (const [id, value] of Object.entries(raw)) {
    const subject = `clip:${id}`;

    if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.content)) {
      issues.push({
        severity: "dropped",
        subject,
        message: "Clip is malformed and was removed.",
      });
      continue;
    }

    // Referential integrity. An orphaned clip would sit invisibly in the
    // document forever, contributing to duration and never rendering.
    const trackId = typeof value.trackId === "string" ? value.trackId : "";
    // `Object.hasOwn`, not a truthiness check: `tracks["constructor"]` is a
    // function on `Object.prototype`, so a phantom id would pass and the clip
    // would render on a track that does not exist.
    const track = Object.hasOwn(tracks, trackId) ? tracks[trackId] : undefined;
    if (!track) {
      issues.push({
        severity: "dropped",
        subject,
        message: "Clip referenced a missing track and was removed.",
      });
      continue;
    }

    const content = repairContent(value.content, media, subject, issues);
    if (!content) continue;

    if (isDesktopPluginContent(content)) {
      const parsed = parseDesktopContent(content.contentType, content.data);

      if (!parsed.ok) {
        issues.push({
          severity: "dropped",
          subject,
          message: `${parsed.message} The clip was removed.`,
        });
        continue;
      }

      const allowed = trackKindsForFamily(parsed.family);
      if (!allowed.includes(track.kind)) {
        issues.push({
          severity: "flagged",
          subject,
          message: `Clip sits on a "${track.kind}" track, but ${parsed.family} clips belong on ${allowed
            .map((kind) => `"${kind}"`)
            .join(" or ")} tracks.`,
        });
      }

      if (parsed.family === "action") {
        actionTargets.push({
          clipId: id,
          instanceId: (parsed.payload as { instanceId: string }).instanceId,
        });
      }

      if (parsed.family === "app") {
        appInstances.add((parsed.payload as { instanceId: string }).instanceId);
      }
    }

    const startFrame = Math.max(0, Math.round(asFiniteNumber(value.startFrame, 0)));
    const durationFrames = Math.max(1, Math.round(asFiniteNumber(value.durationFrames, 1)));

    if (startFrame !== value.startFrame || durationFrames !== value.durationFrames) {
      issues.push({
        severity: "repaired",
        subject,
        message: "Clip timing was out of range and has been clamped.",
      });
    }

    setOwn(
      clips,
      id,
      sanitizeClip(value, content, trackId, startFrame, durationFrames, subject, issues),
    );
  }

  return { clips, actionTargets, appInstances };
}

/**
 * Reports action clips whose target app instance does not exist.
 *
 * The clip is kept: the user authored real timing, and dropping it would destroy
 * work to fix a reference that may simply live in another project.
 */
function validateActionTargets(
  targets: ActionTarget[],
  appInstances: Set<string>,
  issues: ValidationIssue[],
): void {
  for (const target of targets) {
    if (appInstances.has(target.instanceId)) continue;

    issues.push({
      severity: "flagged",
      subject: `clip:${target.clipId}`,
      message: `Action targets app instance "${target.instanceId}", which is not in this project. It has no effect until that app exists.`,
    });
  }
}

/**
 * True when `value` has the same shape as the property's default and every
 * number in it is finite.
 *
 * The shape check is what keeps `"not-a-point"` out of an `Animatable<Vec2>`:
 * it is a lossless JSON leaf, but `position.x` is then `undefined`, the
 * compositor computes `NaN` geometry, and nothing explains the invisible object.
 */
function matchesValueShape(value: unknown, fallback: unknown): boolean {
  if (isFiniteNumber(fallback)) return isFiniteNumber(value);
  if (typeof fallback === "string") return typeof value === "string";
  if (typeof fallback === "boolean") return typeof value === "boolean";
  if (Array.isArray(fallback)) return Array.isArray(value) && value.every(isFiniteNumber);
  if (isRecord(fallback)) {
    return (
      isRecord(value) &&
      Object.keys(fallback).every((key) => matchesValueShape(value[key], fallback[key]))
    );
  }
  return false;
}

/** Effect parameters are open-ended but stay serializable scalars and vectors. */
function isEffectParamValue(value: unknown): boolean {
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.every(isFiniteNumber);
  return isFiniteNumber(value);
}

/**
 * Repairs one easing descriptor, falling back to linear.
 *
 * `applyEasing` reads `easing.kind` and, for a bezier, its control points —
 * without a guard, one keyframe with a half-written curve throws during
 * rendering rather than during load.
 */
function repairEasing(
  raw: unknown,
  label: string,
  subject: string,
  issues: ValidationIssue[],
): Easing {
  const fallback = (): Easing => {
    issues.push({
      severity: "repaired",
      subject,
      message: `Clip ${label} held an unreadable easing curve; it was set to linear.`,
    });
    return EASING_LINEAR;
  };

  if (!isRecord(raw) || !isOneOf(raw.kind, EASING_KINDS)) return fallback();

  if (raw.kind === "bezier" && (!isFiniteVec2(raw.p1) || !isFiniteVec2(raw.p2))) {
    return fallback();
  }

  if (
    raw.kind === "spring" &&
    (!isFiniteNumber(raw.stiffness) || !isFiniteNumber(raw.damping) || !isFiniteNumber(raw.mass))
  ) {
    return fallback();
  }

  return raw as unknown as Easing;
}

/**
 * Repairs one animatable: drops keyframes with a non-finite frame or a value
 * that does not match the property, and restores a static value when nothing
 * survives.
 *
 * A single `NaN` in a keyframe poisons every frame it influences — the rendered
 * object disappears and nothing in the UI explains why — so values are checked
 * rather than trusted, and every repair is reported. `accepts` defaults to the
 * shape of `fallback`, which is what pins a scalar property to a finite number.
 */
function repairAnimatable<T>(
  raw: unknown,
  fallback: T,
  label: string,
  subject: string,
  issues: ValidationIssue[],
  accepts: (value: unknown) => boolean = (value) => matchesValueShape(value, fallback),
): Animatable<T> {
  if (!isRecord(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: `Clip ${label} was missing or unreadable and was reset.`,
    });
    return { type: "static", value: fallback };
  }

  if (raw.type === "static") {
    if ("value" in raw && accepts(raw.value)) return raw as unknown as Animatable<T>;

    issues.push({
      severity: "repaired",
      subject,
      message: `Clip ${label} held an unreadable value and was reset.`,
    });
    return { type: "static", value: fallback };
  }

  if (raw.type === "animated" && Array.isArray(raw.keyframes)) {
    const kept: { frame: number; value: T; easing: Easing }[] = [];
    let removed = 0;

    for (const candidate of raw.keyframes) {
      if (
        !isRecord(candidate) ||
        !isFiniteNumber(candidate.frame) ||
        !("value" in candidate) ||
        !accepts(candidate.value)
      ) {
        removed += 1;
        continue;
      }

      kept.push({
        frame: candidate.frame,
        value: candidate.value as T,
        easing: repairEasing(candidate.easing, label, subject, issues),
      });
    }

    kept.sort((a, b) => a.frame - b.frame);

    if (removed > 0) {
      issues.push({
        severity: "repaired",
        subject,
        message: `Clip ${label} had ${removed} invalid keyframe${removed === 1 ? "" : "s"}, which were removed.`,
      });
    }

    if (kept.length === 0) return { type: "static", value: fallback };
    return { type: "animated", keyframes: kept };
  }

  issues.push({
    severity: "repaired",
    subject,
    message: `Clip ${label} was not a readable animatable and was reset.`,
  });
  return { type: "static", value: fallback };
}

function repairTransform(raw: unknown, subject: string, issues: ValidationIssue[]): Transform {
  if (!isRecord(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Clip transform was missing and has been reset.",
    });
    return {
      position: { type: "static", value: { x: 0, y: 0 } },
      scale: { type: "static", value: { x: 1, y: 1 } },
      rotation: { type: "static", value: 0 },
      anchor: { type: "static", value: { x: 0.5, y: 0.5 } },
      skew: { type: "static", value: { x: 0, y: 0 } },
    };
  }

  return {
    position: repairAnimatable(raw.position, { x: 0, y: 0 }, "position", subject, issues),
    scale: repairAnimatable(raw.scale, { x: 1, y: 1 }, "scale", subject, issues),
    rotation: repairAnimatable(raw.rotation, 0, "rotation", subject, issues),
    anchor: repairAnimatable(raw.anchor, { x: 0.5, y: 0.5 }, "anchor", subject, issues),
    skew: repairAnimatable(raw.skew, { x: 0, y: 0 }, "skew", subject, issues),
  };
}

function repairAppearance(raw: unknown, subject: string, issues: ValidationIssue[]): Appearance {
  const defaults = createAppearance();

  if (!isRecord(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Clip appearance was missing and has been reset.",
    });
    return defaults;
  }

  const shadowRaw = isRecord(raw.shadow) ? raw.shadow : null;
  if (!shadowRaw) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Clip appearance shadow was missing and has been reset.",
    });
  }

  const blendMode = isOneOf(raw.blendMode, BLEND_MODES) ? raw.blendMode : "normal";
  if (blendMode !== raw.blendMode) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Clip blend mode was not recognisable and was set to normal.",
    });
  }

  return {
    opacity: repairAnimatable(raw.opacity, 1, "opacity", subject, issues),
    blur: repairAnimatable(raw.blur, 0, "blur", subject, issues),
    cornerRadius: repairAnimatable(raw.cornerRadius, 0, "corner radius", subject, issues),
    shadow: {
      enabled: shadowRaw ? asBoolean(shadowRaw.enabled, false) : false,
      color: repairAnimatable(shadowRaw?.color, "#000000", "shadow colour", subject, issues),
      offset: repairAnimatable(shadowRaw?.offset, { x: 0, y: 4 }, "shadow offset", subject, issues),
      blur: repairAnimatable(shadowRaw?.blur, 12, "shadow blur", subject, issues),
      opacity: repairAnimatable(shadowRaw?.opacity, 0.5, "shadow opacity", subject, issues),
    },
    crop: repairAnimatable(
      raw.crop,
      { top: 0, right: 0, bottom: 0, left: 0 },
      "crop",
      subject,
      issues,
    ),
    blendMode,
  };
}

function repairTransition(
  raw: unknown,
  subject: string,
  issues: ValidationIssue[],
): ClipTransition | null {
  if (raw === null || raw === undefined) return null;

  if (!isRecord(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Clip transition was malformed and was removed.",
    });
    return null;
  }

  const duration = raw.durationFrames;
  const kind = raw.kind === "dip" || raw.kind === "crossfade" ? raw.kind : "crossfade";

  if (kind === raw.kind && isFiniteNumber(duration) && duration >= 0 && Number.isInteger(duration)) {
    return raw as unknown as ClipTransition;
  }

  issues.push({
    severity: "repaired",
    subject,
    message: "Clip transition duration was not a finite frame count and was corrected.",
  });

  return {
    kind,
    durationFrames: isFiniteNumber(duration) ? Math.max(0, Math.round(duration)) : 0,
  };
}

function repairMasks(raw: unknown, subject: string, issues: ValidationIssue[]): Mask[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) {
      issues.push({
        severity: "repaired",
        subject,
        message: "Clip mask list was not an array and has been reset.",
      });
    }
    return [];
  }

  const masks: Mask[] = [];

  raw.forEach((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.id !== "string") {
      issues.push({
        severity: "dropped",
        subject,
        message: `Mask ${index + 1} was malformed and was removed.`,
      });
      return;
    }

    const shape = repairMaskShape(candidate.shape, candidate.id, subject, issues);
    if (!shape) return;

    const motionPath = repairMotionPath(candidate.motionPath, subject, issues);

    masks.push({
      id: candidate.id,
      name: asString(candidate.name, "Mask"),
      enabled: asBoolean(candidate.enabled, true),
      shape,
      mode: isOneOf(candidate.mode, MASK_MODES) ? candidate.mode : "add",
      feather: repairAnimatable(candidate.feather, 0, "mask feather", subject, issues),
      expand: repairAnimatable(candidate.expand, 0, "mask expand", subject, issues),
      opacity: repairAnimatable(candidate.opacity, 1, "mask opacity", subject, issues),
      inverted: asBoolean(candidate.inverted, false),
      ...(motionPath ? { motionPath } : {}),
    });
  });

  return masks;
}

/**
 * Repairs an optional mask motion path.
 *
 * Nothing consumes `Mask.motionPath` yet, which is exactly why losing it would
 * go unnoticed: the loss only shows up on the *next* save, once the project on
 * disk has been rewritten without it.
 */
function repairMotionPath(
  raw: unknown,
  subject: string,
  issues: ValidationIssue[],
): MotionPath | null {
  if (raw === null || raw === undefined) return null;

  if (!isRecord(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Mask motion path was malformed and was removed.",
    });
    return null;
  }

  const points = Array.isArray(raw.points)
    ? raw.points.filter(isFiniteVec2).map((point) => ({ x: point.x, y: point.y }))
    : [];

  if (points.length === 0) {
    issues.push({
      severity: "dropped",
      subject,
      message: "Mask motion path had no readable points and was removed.",
    });
    return null;
  }

  return {
    points,
    handles: repairHandles(raw.handles, "motion path", subject, issues),
    closed: asBoolean(raw.closed, false),
    orientToPath: asBoolean(raw.orientToPath, false),
    progress: repairAnimatable(raw.progress, 1, "motion path progress", subject, issues),
  };
}

/**
 * Repairs Bezier handles, one `{in, out}` pair per point.
 *
 * These are authored pen-tool data. `mask-engine` tessellates the polyline and
 * ignores them today, so replacing the array with `[]` looks harmless right
 * after load and permanently discards the author's curves on the next save.
 */
function repairHandles(
  raw: unknown,
  label: string,
  subject: string,
  issues: ValidationIssue[],
): { in: Vec2; out: Vec2 }[] {
  if (raw === undefined) return [];

  if (!Array.isArray(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: `Mask ${label} handles were not an array and have been reset.`,
    });
    return [];
  }

  let repaired = 0;

  const handles = raw.map((candidate): { in: Vec2; out: Vec2 } => {
    if (isRecord(candidate) && isFiniteVec2(candidate.in) && isFiniteVec2(candidate.out)) {
      return {
        in: { x: candidate.in.x, y: candidate.in.y },
        out: { x: candidate.out.x, y: candidate.out.y },
      };
    }

    repaired += 1;
    return { in: { x: 0, y: 0 }, out: { x: 0, y: 0 } };
  });

  if (repaired > 0) {
    issues.push({
      severity: "repaired",
      subject,
      message: `Mask ${label} had ${repaired} unreadable handle${
        repaired === 1 ? "" : "s"
      }, which were reset.`,
    });
  }

  return handles;
}

function repairMaskShape(
  raw: unknown,
  maskId: string,
  subject: string,
  issues: ValidationIssue[],
): MaskShape | null {
  const drop = (): null => {
    issues.push({
      severity: "dropped",
      subject,
      message: `Mask "${maskId}" had an unreadable shape and was removed.`,
    });
    return null;
  };

  if (!isRecord(raw) || !isOneOf(raw.kind, MASK_SHAPES)) return drop();

  const kind: MaskShapeKind = raw.kind;

  if (kind === "rectangle") {
    return {
      kind: "rectangle",
      center: repairAnimatable(raw.center, { x: 0, y: 0 }, "mask centre", subject, issues),
      size: repairAnimatable(raw.size, { x: 0, y: 0 }, "mask size", subject, issues),
      cornerRadius: repairAnimatable(raw.cornerRadius, 0, "mask corner radius", subject, issues),
      rotation: repairAnimatable(raw.rotation, 0, "mask rotation", subject, issues),
    };
  }

  if (kind === "ellipse") {
    return {
      kind: "ellipse",
      center: repairAnimatable(raw.center, { x: 0, y: 0 }, "mask centre", subject, issues),
      radii: repairAnimatable(raw.radii, { x: 0, y: 0 }, "mask radii", subject, issues),
      rotation: repairAnimatable(raw.rotation, 0, "mask rotation", subject, issues),
    };
  }

  const vertices = Array.isArray(raw.vertices)
    ? raw.vertices.map((vertex) =>
        repairAnimatable(vertex, { x: 0, y: 0 }, "mask vertex", subject, issues),
      )
    : [];

  if (vertices.length === 0) return drop();

  return {
    kind: "path",
    vertices,
    handles: repairHandles(raw.handles, "path", subject, issues),
    closed: asBoolean(raw.closed, true),
  };
}

function repairEffects(
  raw: unknown,
  subject: string,
  issues: ValidationIssue[],
): EffectInstance[] {
  if (!Array.isArray(raw)) return [];

  const effects: EffectInstance[] = [];

  raw.forEach((candidate, index) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      typeof candidate.effectId !== "string"
    ) {
      issues.push({
        severity: "dropped",
        subject,
        message: `Effect ${index + 1} was malformed and was removed.`,
      });
      return;
    }

    const params: Record<string, Animatable<EffectParamValue>> = {};
    if (isRecord(candidate.params)) {
      for (const [key, value] of Object.entries(candidate.params)) {
        setOwn(
          params,
          key,
          repairAnimatable(
            value,
            0,
            `effect parameter "${key}"`,
            subject,
            issues,
            isEffectParamValue,
          ),
        );
      }
    }

    effects.push({
      id: candidate.id,
      effectId: candidate.effectId,
      enabled: asBoolean(candidate.enabled, true),
      params,
    });
  });

  return effects;
}

function repairGrade(
  raw: unknown,
  subject: string,
  issues: ValidationIssue[],
): ColorGrade | null {
  if (raw === null || raw === undefined) return null;

  if (!isRecord(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: "Clip colour grade was malformed and was removed.",
    });
    return null;
  }

  const defaults = createColorGrade();
  const wheels = isRecord(raw.wheels) ? raw.wheels : {};
  const vignette = isRecord(raw.vignette) ? raw.vignette : {};
  const grain = isRecord(raw.grain) ? raw.grain : {};

  const grade: ColorGrade = {
    ...defaults,
    enabled: asBoolean(raw.enabled, false),
    brightness: repairAnimatable(raw.brightness, 0, "grade brightness", subject, issues),
    contrast: repairAnimatable(raw.contrast, 0, "grade contrast", subject, issues),
    exposure: repairAnimatable(raw.exposure, 0, "grade exposure", subject, issues),
    shadows: repairAnimatable(raw.shadows, 0, "grade shadows", subject, issues),
    highlights: repairAnimatable(raw.highlights, 0, "grade highlights", subject, issues),
    whites: repairAnimatable(raw.whites, 0, "grade whites", subject, issues),
    blacks: repairAnimatable(raw.blacks, 0, "grade blacks", subject, issues),
    temperature: repairAnimatable(raw.temperature, 0, "grade temperature", subject, issues),
    tint: repairAnimatable(raw.tint, 0, "grade tint", subject, issues),
    saturation: repairAnimatable(raw.saturation, 0, "grade saturation", subject, issues),
    vibrance: repairAnimatable(raw.vibrance, 0, "grade vibrance", subject, issues),
    curves: {
      master: repairCurvePoints(raw.curves, "master", defaults.curves.master),
      red: repairCurvePoints(raw.curves, "red", defaults.curves.red),
      green: repairCurvePoints(raw.curves, "green", defaults.curves.green),
      blue: repairCurvePoints(raw.curves, "blue", defaults.curves.blue),
    },
    wheels: {
      lift: repairWheel(wheels.lift, defaults.wheels.lift, "lift", subject, issues),
      gamma: repairWheel(wheels.gamma, defaults.wheels.gamma, "gamma", subject, issues),
      gain: repairWheel(wheels.gain, defaults.wheels.gain, "gain", subject, issues),
    },
    vignette: {
      amount: repairAnimatable(vignette.amount, 0, "grade vignette amount", subject, issues),
      radius: repairAnimatable(vignette.radius, 0.7, "grade vignette radius", subject, issues),
      softness: repairAnimatable(vignette.softness, 0.5, "grade vignette softness", subject, issues),
    },
    grain: {
      amount: repairAnimatable(grain.amount, 0, "grade grain amount", subject, issues),
      size: repairAnimatable(grain.size, 1, "grade grain size", subject, issues),
    },
  };

  return grade;
}

function repairWheel(
  raw: unknown,
  fallback: ColorWheel,
  label: string,
  subject: string,
  issues: ValidationIssue[],
): ColorWheel {
  if (!isRecord(raw)) {
    issues.push({
      severity: "repaired",
      subject,
      message: `Clip colour grade ${label} wheel was missing and has been reset.`,
    });
    return fallback;
  }

  return {
    offset: repairAnimatable(raw.offset, { x: 0, y: 0 }, `grade ${label} offset`, subject, issues),
    level: repairAnimatable(raw.level, 0, `grade ${label} level`, subject, issues),
  };
}

function repairCurvePoints(
  raw: unknown,
  channel: "master" | "red" | "green" | "blue",
  fallback: CurvePoint[],
): CurvePoint[] {
  if (!isRecord(raw) || !Array.isArray(raw[channel])) return fallback;

  const points = raw[channel].filter(isFiniteVec2).map((point) => ({ x: point.x, y: point.y }));
  return points.length > 0 ? points : fallback;
}

/**
 * Repairs one clip's content payload.
 *
 * Returns null when the payload cannot be understood, so the caller drops the
 * clip with one clear issue rather than storing a clip that throws during
 * rendering. Media references are checked here so a dangling reference produces
 * the same single "missing media" outcome as before.
 */
function repairContent(
  raw: Record<string, unknown>,
  media: Record<string, MediaAsset>,
  subject: string,
  issues: ValidationIssue[],
): ClipContent | null {
  const missingMedia = (): null => {
    issues.push({
      severity: "dropped",
      subject,
      message: "Clip referenced missing media and was removed.",
    });
    return null;
  };

  const mediaIdFor = (): string | null => {
    const mediaId = typeof raw.mediaId === "string" ? raw.mediaId : "";
    // Own-property check, not truthiness: `media["constructor"]` resolves to a
    // function, which would keep a dangling reference to a phantom asset.
    return mediaId && Object.hasOwn(media, mediaId) ? mediaId : null;
  };

  switch (raw.kind) {
    case "video": {
      const mediaId = mediaIdFor();
      if (!mediaId) return missingMedia();
      return {
        kind: "video",
        mediaId,
        sourceInFrame: asFiniteNumber(raw.sourceInFrame, 0),
        speed: asFiniteNumber(raw.speed, 1),
        volume: repairAnimatable(raw.volume, 1, "volume", subject, issues),
        muted: asBoolean(raw.muted, false),
      };
    }

    case "audio": {
      const mediaId = mediaIdFor();
      if (!mediaId) return missingMedia();
      return {
        kind: "audio",
        mediaId,
        sourceInFrame: asFiniteNumber(raw.sourceInFrame, 0),
        speed: asFiniteNumber(raw.speed, 1),
        volume: repairAnimatable(raw.volume, 1, "volume", subject, issues),
        muted: asBoolean(raw.muted, false),
        fadeInFrames: Math.max(0, asFiniteNumber(raw.fadeInFrames, 0)),
        fadeOutFrames: Math.max(0, asFiniteNumber(raw.fadeOutFrames, 0)),
      };
    }

    case "image": {
      const mediaId = mediaIdFor();
      if (!mediaId) return missingMedia();
      return { kind: "image", mediaId };
    }

    case "gif": {
      const mediaId = mediaIdFor();
      if (!mediaId) return missingMedia();
      return { kind: "gif", mediaId, loop: asBoolean(raw.loop, true) };
    }

    case "sticker": {
      const mediaId = mediaIdFor();
      if (!mediaId) return missingMedia();
      return { kind: "sticker", mediaId };
    }

    case "text": {
      const stroke = isRecord(raw.stroke) ? raw.stroke : {};
      const background = isRecord(raw.background) ? raw.background : {};

      return {
        kind: "text",
        text: asString(raw.text, ""),
        fontFamily: asString(raw.fontFamily, "Inter"),
        fontSize: repairAnimatable(raw.fontSize, 48, "font size", subject, issues),
        fontWeight: asFiniteNumber(raw.fontWeight, 400),
        italic: asBoolean(raw.italic, false),
        color: repairAnimatable(raw.color, "#ffffff", "text colour", subject, issues),
        align: isOneOf(raw.align, TEXT_ALIGNS) ? raw.align : "center",
        lineHeight: asFiniteNumber(raw.lineHeight, 1.2),
        letterSpacing: repairAnimatable(raw.letterSpacing, 0, "letter spacing", subject, issues),
        stroke: {
          enabled: asBoolean(stroke.enabled, false),
          color: asString(stroke.color, "#000000"),
          width: repairAnimatable(stroke.width, 2, "text stroke width", subject, issues),
        },
        background: {
          enabled: asBoolean(background.enabled, false),
          color: asString(background.color, "#000000"),
          padding: Math.max(0, asFiniteNumber(background.padding, 0)),
          cornerRadius: Math.max(0, asFiniteNumber(background.cornerRadius, 0)),
        },
        maxWidth: isFiniteNumber(raw.maxWidth) ? raw.maxWidth : null,
      };
    }

    case "shape": {
      const stroke = isRecord(raw.stroke) ? raw.stroke : {};

      return {
        kind: "shape",
        shape: isOneOf(raw.shape, SHAPE_KINDS) ? raw.shape : "rectangle",
        fill: repairAnimatable(raw.fill, "#ffffff", "shape fill", subject, issues),
        stroke: {
          enabled: asBoolean(stroke.enabled, false),
          color: repairAnimatable(stroke.color, "#000000", "shape stroke colour", subject, issues),
          width: repairAnimatable(stroke.width, 2, "shape stroke width", subject, issues),
        },
        sides: Math.max(3, Math.round(asFiniteNumber(raw.sides, 6))),
        size: repairAnimatable(raw.size, { x: 100, y: 100 }, "shape size", subject, issues),
      };
    }

    case "svg":
      return {
        kind: "svg",
        markup: asString(raw.markup, ""),
        fillOverrides: isRecord(raw.fillOverrides)
          ? Object.fromEntries(
              Object.entries(raw.fillOverrides).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : {},
      };

    case "emoji":
      return {
        kind: "emoji",
        emoji: asString(raw.emoji, ""),
        size: repairAnimatable(raw.size, 64, "emoji size", subject, issues),
      };

    case "plugin": {
      if (typeof raw.contentType !== "string" || !isRecord(raw.data)) {
        issues.push({
          severity: "dropped",
          subject,
          message: "Clip plugin payload was malformed and the clip was removed.",
        });
        return null;
      }

      return { kind: "plugin", contentType: raw.contentType, data: raw.data };
    }

    default:
      issues.push({
        severity: "dropped",
        subject,
        message: `Clip content kind "${String(raw.kind)}" is not one this build knows and the clip was removed.`,
      });
      return null;
  }
}

/**
 * Builds a complete, safe clip envelope.
 *
 * Everything a renderer reads is rebuilt from a known-good base, so no amount of
 * missing fields can leave a half-formed clip in the document.
 */
function sanitizeClip(
  raw: Record<string, unknown>,
  content: ClipContent,
  trackId: string,
  startFrame: number,
  durationFrames: number,
  subject: string,
  issues: ValidationIssue[],
): Clip {
  const base = createClip({
    id: typeof raw.id === "string" ? raw.id : undefined,
    trackId,
    startFrame,
    durationFrames,
    content,
  });

  return {
    ...base,
    name: asString(raw.name, base.name),
    trackId,
    startFrame,
    durationFrames,
    content,
    transform: repairTransform(raw.transform, subject, issues),
    appearance: repairAppearance(raw.appearance, subject, issues),
    masks: repairMasks(raw.masks, subject, issues),
    effects: repairEffects(raw.effects, subject, issues),
    grade: repairGrade(raw.grade, subject, issues),
    transitionIn: repairTransition(raw.transitionIn, subject, issues),
    locked: asBoolean(raw.locked, false),
    hidden: asBoolean(raw.hidden, false),
    groupId: typeof raw.groupId === "string" ? raw.groupId : null,
  };
}

function validateTrackOrder(
  raw: unknown,
  tracks: Record<string, Track>,
  issues: ValidationIssue[],
): string[] {
  const known = Object.keys(tracks);
  const order = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of order) {
    if (!Object.hasOwn(tracks, id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  // Tracks missing from the order would exist but never render. Appending them
  // is always better than dropping the user's content.
  for (const id of known) {
    if (seen.has(id)) continue;
    result.push(id);
    issues.push({
      severity: "repaired",
      subject: `track:${id}`,
      message: "Track was missing from the render order and was appended.",
    });
  }

  return result;
}
