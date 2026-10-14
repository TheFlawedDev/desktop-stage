/**
 * Core timeline editing operations.
 *
 * Every function here is **pure**: it takes clips and returns new clips, never
 * mutating its input and never touching global state. That is what lets the
 * history engine treat an edit as a value, and what lets these operations be
 * tested in Node in microseconds without a browser.
 *
 * Operations return `null` (or an unchanged array) when the edit is a no-op,
 * so callers can skip pushing a meaningless undo entry.
 */

import {
  DESKTOP_CONTENT_TYPES,
  type Clip,
  type Frame,
  type FrameDuration,
  type Id,
} from "@cutaway/types";
import { rangeOf } from "./range";

/** Minimum clip length. Zero-length clips are unselectable and unrenderable. */
export const MIN_CLIP_FRAMES = 1;

/**
 * Base of a versioned content type: `desktop-stage/action@1` → `desktop-stage/action`.
 *
 * The payload version lives inside the content-type string, so recognising a
 * family means comparing bases; an exact string match would stop matching the
 * moment a `@2` payload ships.
 */
function contentTypeBase(contentType: string): string {
  const separator = contentType.lastIndexOf("@");
  return separator < 0 ? contentType : contentType.slice(0, separator);
}

const DESKTOP_ACTION_CONTENT_BASE = contentTypeBase(DESKTOP_CONTENT_TYPES.action);

/**
 * True for a Desktop Stage action clip.
 *
 * Actions are one-shot state changes — `appendLine` appends a line, `open`
 * reveals a window — that the desktop resolver applies once per clip from the
 * clip's start frame onwards. Two clips carrying one action means running it
 * twice.
 */
function isDesktopActionClip(clip: Clip): boolean {
  const { content } = clip;
  return (
    content.kind === "plugin" && contentTypeBase(content.contentType) === DESKTOP_ACTION_CONTENT_BASE
  );
}

/**
 * Advances a clip's source in-point, for content kinds that read from media.
 *
 * Trimming the head of a video must also skip forward in the source, otherwise
 * the clip would re-show frames the user just trimmed away. Content kinds
 * without a source (text, shapes) are returned untouched.
 */
function advanceSource(clip: Clip, byFrames: number): Clip["content"] {
  const { content } = clip;
  if (content.kind === "video" || content.kind === "audio") {
    return {
      ...content,
      sourceInFrame: content.sourceInFrame + Math.round(byFrames * content.speed),
    };
  }
  return content;
}

/**
 * Why `splitClip` refuses this clip, or `null` when it can be split.
 *
 * `splitClip` answers `null` both for "there is nothing to split here" and for
 * "this clip must not be split", which is the right answer for a pure operation
 * but useless to a person. The UI asks this first so it can explain the refusal
 * instead of appearing to do nothing.
 *
 * A split point outside the clip, or on its very edge, is deliberately not
 * reported: that is not an error, so there is nothing to tell the user.
 */
export function splitClipRefusal(clip: Clip, atFrame: Frame): string | null {
  const { start, end } = rangeOf(clip);
  if (atFrame <= start || atFrame >= end) return null;
  if (atFrame - start < MIN_CLIP_FRAMES || end - atFrame < MIN_CLIP_FRAMES) return null;

  if (isDesktopActionClip(clip)) {
    return "Action clips can't be split — both halves would apply the action, running it twice. Move or trim it instead.";
  }

  return null;
}

/**
 * Splits a clip at an absolute timeline frame.
 *
 * Returns `null` if the frame falls on or outside the clip's boundaries — there
 * is nothing to split there, and producing a zero-length half would be worse
 * than refusing — or if the clip is one {@link splitClipRefusal} refuses.
 */
export function splitClip(clip: Clip, atFrame: Frame, newId: Id): [Clip, Clip] | null {
  // A rule refusal comes first, so both refusal paths return through the one
  // `null` the callers already understand.
  if (splitClipRefusal(clip, atFrame) !== null) return null;

  const { start, end } = rangeOf(clip);
  if (atFrame <= start || atFrame >= end) return null;

  const leftDuration = atFrame - start;
  const rightDuration = end - atFrame;
  if (leftDuration < MIN_CLIP_FRAMES || rightDuration < MIN_CLIP_FRAMES) return null;

  const left: Clip = { ...clip, durationFrames: leftDuration };
  const right: Clip = {
    ...clip,
    id: newId,
    startFrame: atFrame,
    durationFrames: rightDuration,
    content: advanceSource(clip, leftDuration),
    // Masks and effects are shared by value on both halves; ids stay unique
    // because the clip id is what scopes them.
  };

  return [left, right];
}

/**
 * Trims the head of a clip to a new absolute start frame.
 *
 * The clip's *end* stays fixed — this is a trim, not a move. The source
 * in-point advances by the same amount so the visible content does not shift.
 */
export function trimClipStart(clip: Clip, newStartFrame: Frame): Clip | null {
  const { start, end } = rangeOf(clip);
  const clamped = Math.min(Math.max(newStartFrame, 0), end - MIN_CLIP_FRAMES);
  const delta = clamped - start;
  if (delta === 0) return null;

  return {
    ...clip,
    startFrame: clamped,
    durationFrames: clip.durationFrames - delta,
    content: advanceSource(clip, delta),
  };
}

/** Trims the tail of a clip to a new absolute end frame. Start stays fixed. */
export function trimClipEnd(clip: Clip, newEndFrame: Frame): Clip | null {
  const { start, end } = rangeOf(clip);
  const clamped = Math.max(newEndFrame, start + MIN_CLIP_FRAMES);
  if (clamped === end) return null;

  return { ...clip, durationFrames: clamped - start };
}

/** Moves a clip to a new start frame, optionally onto a different track. */
export function moveClip(clip: Clip, newStartFrame: Frame, newTrackId?: Id): Clip {
  return {
    ...clip,
    startFrame: Math.max(0, newStartFrame),
    trackId: newTrackId ?? clip.trackId,
  };
}

/**
 * Deletes a clip and pulls every later clip on the same track back by the
 * deleted clip's duration, closing the gap.
 *
 * Only clips that begin *at or after* the deleted clip's end move. A clip that
 * merely overlaps the deleted range keeps its authored start: pulling it back by
 * the whole duration could land it before frame 0, and a clip whose entire span
 * sits before zero is never drawn — it would silently disappear from the
 * timeline instead of closing a gap.
 *
 * `trackClips` must contain only clips from one track. Order is irrelevant —
 * the result is sorted by start frame, which callers can rely on.
 */
export function rippleDelete(trackClips: readonly Clip[], clipId: Id): Clip[] {
  const target = trackClips.find((c) => c.id === clipId);
  if (!target) return [...trackClips];

  const gap = target.durationFrames;
  // A clip starting at or after this frame can move back by `gap` and still
  // land inside the deleted clip's own (non-negative) start.
  const firstShiftable = target.startFrame + gap;

  return trackClips
    .filter((c) => c.id !== clipId)
    .map((c) =>
      c.startFrame < firstShiftable
        ? { ...c }
        : // Clamped rather than assumed: a start frame is document data and a
          // negative one would break every consumer that trusts `startFrame >= 0`.
          { ...c, startFrame: Math.max(0, c.startFrame - gap) },
    )
    .sort((a, b) => a.startFrame - b.startFrame);
}

/**
 * Inserts a gap of `durationFrames` at `atFrame`, pushing later clips right.
 *
 * A clip straddling the insertion point is *not* split here; splitting is a
 * separate, explicitly-invoked operation. Straddling clips move whole, which
 * matches how editors expect "insert gap" to behave on locked-together content.
 */
export function rippleInsert(
  trackClips: readonly Clip[],
  atFrame: Frame,
  durationFrames: FrameDuration,
): Clip[] {
  if (durationFrames <= 0) return [...trackClips];

  return trackClips
    .map((c) => (c.startFrame >= atFrame ? { ...c, startFrame: c.startFrame + durationFrames } : c))
    .sort((a, b) => a.startFrame - b.startFrame);
}

/** Total timeline length: the furthest end frame across all clips. */
export function computeDuration(clips: readonly Clip[]): FrameDuration {
  let max = 0;
  for (const clip of clips) {
    const end = clip.startFrame + clip.durationFrames;
    if (end > max) max = end;
  }
  return max;
}

/** Clips overlapping `[start, end)` on the given track, sorted by start frame. */
export function clipsInRange(
  clips: readonly Clip[],
  trackId: Id,
  start: Frame,
  end: Frame,
): Clip[] {
  return clips
    .filter(
      (c) => c.trackId === trackId && c.startFrame < end && c.startFrame + c.durationFrames > start,
    )
    .sort((a, b) => a.startFrame - b.startFrame);
}
