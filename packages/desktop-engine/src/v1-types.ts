/**
 * Structural types of the Desktop Stage version 1 prototype document.
 *
 * Split from `v1.ts` so that the validation code can import types without the
 * types file importing a value module — which keeps `verbatimModuleSyntax` happy
 * and the import graph acyclic.
 */

export type V1WindowKind = "browser" | "code" | "note";

/** The six properties the prototype could animate, plus nothing else. */
export interface V1AnimatedValues {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  scale: number;
}

export interface V1Window extends V1AnimatedValues {
  id: string;
  kind: V1WindowKind;
  title: string;
  content: string;
  color: string;
  /** Paint order; higher is nearer the viewer. */
  z: number;
}

/** A keyframe in milliseconds from the start of the 20-second timeline. */
export interface V1Keyframe {
  time: number;
  values: V1AnimatedValues;
}

export interface V1Project {
  version: 1;
  windows: V1Window[];
  /** Per-window keyframes, keyed by window id. */
  keyframes: Record<string, V1Keyframe[]>;
}
