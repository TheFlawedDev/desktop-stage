/**
 * Timeline structure.
 *
 * Tracks are an ordered list. Render order is settled by
 * `ProjectDocument.trackOrder`, which the runtime resolves so that **earlier
 * entries draw in front**; see `packages/types/src/project.ts`. Clips live in a
 * flat map on the project rather than nested inside tracks, so that moving a
 * clip between tracks is a single field write instead of a splice on two
 * arrays — which matters because that operation happens on every drag frame.
 */

import type { EffectInstance } from "./effects";
import type { Frame, Id, Unit } from "./primitives";

/**
 * Track kinds.
 *
 * `video`, `audio`, `caption`, and `overlay` come from the editor foundation.
 * The Desktop Stage kinds are:
 *
 * - `desktop` — app windows; clips span their visible lifetime.
 * - `action` — timed effects on an app instance; nonvisual.
 * - `cursor` — the simulated pointer.
 * - `camera`, `camera-effect`, `lens` — camera rows. The three share the
 *   `desktop-stage/camera@1` payload family, discriminated by `action`.
 *
 * A timeline may *group* related rows visually (the three camera rows, say), but
 * the document stores real tracks: nothing downstream has to infer a row's
 * meaning from its position in a group.
 */
export type TrackKind =
  | "video"
  | "audio"
  | "caption"
  | "overlay"
  | "desktop"
  | "action"
  | "cursor"
  | "camera"
  | "camera-effect"
  | "lens";

/** Track kinds that never produce a visual node. */
export const NONVISUAL_TRACK_KINDS: readonly TrackKind[] = ["audio", "action"];

export interface Track {
  id: Id;
  name: string;
  kind: TrackKind;
  /**
   * The track's own ordering number, mirroring its position in
   * `ProjectDocument.trackOrder`.
   *
   * The runtime resolves render order from `trackOrder`, where earlier entries
   * draw in front — so the first row of the timeline is the frontmost layer.
   */
  index: number;
  locked: boolean;
  hidden: boolean;
  muted: boolean;
  /** Solo overrides mute on all other tracks of the same kind. */
  solo: boolean;
  height: number;
  volume: Unit;
  effects: EffectInstance[];
}

/** A named point on the timeline, used for navigation and chapters. */
export interface Marker {
  id: Id;
  frame: Frame;
  label: string;
  color: string;
  /** Non-zero length turns a marker into a region. */
  durationFrames: number;
}
