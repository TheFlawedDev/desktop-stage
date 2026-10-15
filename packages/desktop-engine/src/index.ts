/**
 * `@desktop-stage/desktop-engine` — the Desktop Stage document extension.
 *
 * Owns three things and nothing else:
 *
 * - the versioned payload schema that rides in Cutaway's plugin seam
 *   (`project.ts`),
 * - the deterministic conversion of prototype version 1 projects
 *   (`migrateV1.ts`, `v1.ts`), and
 * - the frame resolver and scene adapter shared by preview and export
 *   (`resolveDesktopFrame.ts`, `sceneAdapter.ts`).
 *
 * It is DOM-free and renderer-free: the Pixi backend lives in the web app and
 * consumes the nodes this package produces.
 */

export * from "./project";
export * from "./v1";
export * from "./migrateV1";
export * from "./starterProject";
export * from "./resolveDesktopFrame";
export * from "./sceneAdapter";
export * from "./stage/shell";
export * from "./stage/vfs";
export * from "./stage/apps";
export * from "./stage/recorder";
export * from "./stage/effects";
export * from "./stage/telemetry/StageDiagnostics";
export * from "./stageMediaUtils";
