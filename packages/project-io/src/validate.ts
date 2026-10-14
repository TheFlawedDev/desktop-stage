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
  Clip,
  ClipTransition,
  MediaAsset,
  ProjectDocument,
  Track,
} from "@cutaway/types";
import { createProject } from "@cutaway/utils";
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

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

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
        markers: isRecord(entities.markers)
          ? (entities.markers as ProjectDocument["entities"]["markers"])
          : {},
        captionTracks: isRecord(entities.captionTracks)
          ? (entities.captionTracks as ProjectDocument["entities"]["captionTracks"])
          : {},
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
    if (!isRecord(value) || typeof value.id !== "string") {
      issues.push({
        severity: "dropped",
        subject: `track:${id}`,
        message: "Track is malformed and was removed.",
      });
      continue;
    }
    tracks[id] = value as unknown as Track;
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
    if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.source)) {
      issues.push({
        severity: "dropped",
        subject: `media:${id}`,
        message: "Media reference is malformed and was removed.",
      });
      continue;
    }
    media[id] = value as unknown as MediaAsset;
  }

  return media;
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

    const clip = value as unknown as Clip;

    // Referential integrity. An orphaned clip would sit invisibly in the
    // document forever, contributing to duration and never rendering.
    const track = tracks[clip.trackId];
    if (!track) {
      issues.push({
        severity: "dropped",
        subject,
        message: "Clip referenced a missing track and was removed.",
      });
      continue;
    }

    const mediaId = "mediaId" in clip.content ? clip.content.mediaId : null;
    if (mediaId && !media[mediaId]) {
      issues.push({
        severity: "dropped",
        subject,
        message: "Clip referenced missing media and was removed.",
      });
      continue;
    }

    if (isDesktopPluginContent(clip.content)) {
      const parsed = parseDesktopContent(clip.content.contentType, clip.content.data);

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

    const startFrame = Math.max(0, Math.round(asFiniteNumber(clip.startFrame, 0)));
    const durationFrames = Math.max(1, Math.round(asFiniteNumber(clip.durationFrames, 1)));

    if (startFrame !== clip.startFrame || durationFrames !== clip.durationFrames) {
      issues.push({
        severity: "repaired",
        subject,
        message: "Clip timing was out of range and has been clamped.",
      });
    }

    clips[id] = sanitizeClip({ ...clip, startFrame, durationFrames }, subject, issues);
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

/** True when every number inside a value is finite. */
function isFiniteValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isFiniteValue);
  if (isRecord(value)) return Object.values(value).every(isFiniteValue);
  return true;
}

/**
 * Repairs one animatable: drops keyframes with a non-finite frame or value, and
 * restores a static value when nothing survives.
 *
 * Returns the original object when nothing needed fixing, so a clean project
 * loads without a single allocation changing.
 */
function sanitizeAnimatable<T>(
  animatable: Animatable<T>,
  fallback: T,
  label: string,
  subject: string,
  issues: ValidationIssue[],
): Animatable<T> {
  if (animatable.type === "static") {
    if (isFiniteValue(animatable.value)) return animatable;

    issues.push({
      severity: "repaired",
      subject,
      message: `Clip ${label} held a non-finite value and was reset.`,
    });
    return { type: "static", value: fallback };
  }

  const kept = animatable.keyframes
    .filter((keyframe) => Number.isFinite(keyframe.frame) && isFiniteValue(keyframe.value))
    .sort((a, b) => a.frame - b.frame);

  if (kept.length === animatable.keyframes.length) {
    // Only rebuild when the order actually changed.
    const ordered = animatable.keyframes.every((keyframe, index) => keyframe === kept[index]);
    if (ordered) return animatable;
  }

  const removed = animatable.keyframes.length - kept.length;
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

function sanitizeTransition(
  transition: ClipTransition | null,
  subject: string,
  issues: ValidationIssue[],
): ClipTransition | null {
  if (!transition) return transition;

  const duration = transition.durationFrames;
  if (Number.isFinite(duration) && duration >= 0 && Number.isInteger(duration)) return transition;

  issues.push({
    severity: "repaired",
    subject,
    message: "Clip transition duration was not a finite frame count and was corrected.",
  });

  return {
    ...transition,
    durationFrames: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0,
  };
}

/**
 * Repairs non-finite animation data on a clip.
 *
 * A single `NaN` in a keyframe poisons every frame it influences — the rendered
 * object disappears and nothing in the UI explains why — so values are checked
 * rather than trusted, and every repair is reported.
 */
function sanitizeClip(clip: Clip, subject: string, issues: ValidationIssue[]): Clip {
  const before = issues.length;

  const transform = { ...clip.transform };
  const shadow = { ...clip.appearance.shadow };
  const appearance = { ...clip.appearance, shadow };

  transform.position = sanitizeAnimatable(clip.transform.position, { x: 0, y: 0 }, "position", subject, issues);
  transform.scale = sanitizeAnimatable(clip.transform.scale, { x: 1, y: 1 }, "scale", subject, issues);
  transform.rotation = sanitizeAnimatable(clip.transform.rotation, 0, "rotation", subject, issues);
  transform.anchor = sanitizeAnimatable(clip.transform.anchor, { x: 0.5, y: 0.5 }, "anchor", subject, issues);
  transform.skew = sanitizeAnimatable(clip.transform.skew, { x: 0, y: 0 }, "skew", subject, issues);

  appearance.opacity = sanitizeAnimatable(clip.appearance.opacity, 1, "opacity", subject, issues);
  appearance.blur = sanitizeAnimatable(clip.appearance.blur, 0, "blur", subject, issues);
  appearance.cornerRadius = sanitizeAnimatable(
    clip.appearance.cornerRadius,
    0,
    "corner radius",
    subject,
    issues,
  );
  shadow.color = sanitizeAnimatable(clip.appearance.shadow.color, "#000000", "shadow colour", subject, issues);
  shadow.offset = sanitizeAnimatable(clip.appearance.shadow.offset, { x: 0, y: 4 }, "shadow offset", subject, issues);
  shadow.blur = sanitizeAnimatable(clip.appearance.shadow.blur, 12, "shadow blur", subject, issues);
  shadow.opacity = sanitizeAnimatable(clip.appearance.shadow.opacity, 0.5, "shadow opacity", subject, issues);
  appearance.crop = sanitizeAnimatable(
    clip.appearance.crop,
    { top: 0, right: 0, bottom: 0, left: 0 },
    "crop",
    subject,
    issues,
  );

  const transitionIn = sanitizeTransition(clip.transitionIn, subject, issues);

  if (issues.length === before) return clip;
  return { ...clip, transform, appearance, transitionIn };
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
    if (!tracks[id] || seen.has(id)) continue;
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
