/**
 * `@cutaway/timeline-engine` — pure timeline logic.
 *
 * No React, no DOM, no canvas. Everything here runs in Node, which is why the
 * export pipeline can reuse it verbatim and why its tests run in milliseconds.
 */

export * from "./time";
export * from "./range";
export * from "./operations";
// Named re-export kept alongside the star above: webpack resolves the named
// import in `apps/web` through this entry, and the explicit binding gives it
// the export regardless of how it flattens the star.
export { splitClipRefusal } from "./operations";
export * from "./snapping";
