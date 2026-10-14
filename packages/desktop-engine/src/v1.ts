/**
 * The Desktop Stage version 1 document — the prototype's saved shape.
 *
 * This is a **read-only** legacy format, kept so that existing projects keep
 * working: `src/types.ts` and `src/utils/project.ts` in the original prototype
 * defined it, and users have copies in browser storage and exported JSON files.
 * Nothing in the editor writes it any more; {@link convertV1Project} maps it onto
 * the normalized frame-based document.
 *
 * It lives beside the converter rather than in the editor so that the shape and
 * its validation rules are versioned together and cannot drift apart.
 */

import type { V1Project } from "./v1-types";

export const V1_STORAGE_KEY = "desktop-stage-project-v1";

/** The prototype's timeline was fixed at 20 seconds. */
export const V1_DURATION_MS = 20_000;

/** The prototype's stage was a fixed 1000 × 600 CSS space. */
export const V1_COMPOSITION = { width: 1000, height: 600 } as const;

/**
 * Gate for anything claiming to be a v1 project.
 *
 * A direct port of the prototype's `isProject`, so a value that opened in the
 * old editor is exactly the set of values the converter accepts. The converter
 * then assumes well-formed input and stays readable; anything a stricter
 * validator would reject never reaches it.
 */
export function isV1Project(value: unknown): value is V1Project {
  if (!value || typeof value !== "object") return false;

  const project = value as Partial<V1Project>;
  if (
    project.version !== 1 ||
    !Array.isArray(project.windows) ||
    !project.keyframes ||
    typeof project.keyframes !== "object"
  ) {
    return false;
  }

  const animatedFields = ["x", "y", "width", "height", "opacity", "scale"] as const;

  const isFiniteNumber = (candidate: unknown): candidate is number =>
    typeof candidate === "number" && Number.isFinite(candidate);

  const validWindow = (window: unknown): boolean => {
    if (!window || typeof window !== "object") return false;
    const candidate = window as Record<string, unknown>;

    if (
      typeof candidate.id !== "string" ||
      !["browser", "code", "note"].includes(String(candidate.kind)) ||
      typeof candidate.title !== "string" ||
      typeof candidate.content !== "string" ||
      typeof candidate.color !== "string"
    ) {
      return false;
    }

    return (
      animatedFields.every((field) => isFiniteNumber(candidate[field])) && isFiniteNumber(candidate.z)
    );
  };

  const validKeyframe = (keyframe: unknown): boolean => {
    if (!keyframe || typeof keyframe !== "object") return false;
    const candidate = keyframe as Record<string, unknown>;
    if (!isFiniteNumber(candidate.time)) return false;

    const values = candidate.values as Record<string, unknown> | undefined;
    if (!values || typeof values !== "object") return false;

    return animatedFields.every((field) => isFiniteNumber(values[field]));
  };

  return (
    project.windows.every(validWindow) &&
    Object.values(project.keyframes).every(
      (frames) => Array.isArray(frames) && frames.every(validKeyframe),
    )
  );
}
