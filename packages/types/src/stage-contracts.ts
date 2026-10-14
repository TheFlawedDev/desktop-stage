/**
 * Desktop Stage Contracts and Interfaces.
 *
 * Defines the shared type contracts for the interactive Desktop Stage:
 * 1. Window Manager & Shell
 * 2. Virtual File System & App Sandboxes
 * 3. Stage Recording & Mouse-Follow Camera Effects
 */

import type { Id, Rect, Vec2, Size } from "./primitives";

// ==========================================
// 1. Window Manager & Stage Shell
// ==========================================

export type StageAppKind = "finder" | "iterm" | "arc" | "quicktime" | "photobooth" | "custom";

export interface StageWindowConfig {
  id: Id;
  appKind: StageAppKind;
  title: string;
  rect: Rect;
  zIndex: number;
  isFocused: boolean;
  isMinimized: boolean;
  customName?: string;
  customIconUri?: string;
}

export interface IStageWindowManager {
  openApp(appKind: StageAppKind, initialRect?: Partial<Rect>): StageWindowConfig;
  closeWindow(windowId: Id): void;
  focusWindow(windowId: Id): void;
  moveWindow(windowId: Id, pos: Vec2): void;
  resizeWindow(windowId: Id, size: Size): void;
  minimizeWindow(windowId: Id): void;
  restoreWindow(windowId: Id): void;
  getWindows(): StageWindowConfig[];
  getTopWindowAt(pos: Vec2): StageWindowConfig | null;
}

// ==========================================
// 2. Virtual File System & App Sandbox
// ==========================================

export interface VirtualFileNode {
  path: string;
  name: string;
  isDirectory: boolean;
  sizeBytes: number;
  lastModifiedMs: number;
}

export interface IVirtualFileSystem {
  readFile(path: string): Promise<Uint8Array | string>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  listDirectory(path: string): Promise<VirtualFileNode[]>;
  deleteNode(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export interface IShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface IItermEvaluator {
  execute(commandLine: string, currentWorkingDir: string): Promise<IShellCommandResult>;
}

export interface ITemplateSanitizer {
  sanitizeHtml(rawHtml: string): string;
  scopeCss(rawCss: string, scopeClass: string): string;
}

// ==========================================
// 3. Stage Recording & Mouse-Follow Engine
// ==========================================

export type PointerEventType = "move" | "down" | "up" | "click" | "drag";

export interface StagePointerEvent {
  timestampMs: number;
  pos: Vec2;
  type: PointerEventType;
  targetWindowId?: Id;
}

export type StageRecordingMode = "full" | "selected-area";

export interface StageRecordingOptions {
  mode: StageRecordingMode;
  selectedRect?: Rect;
  recordAudio: boolean;
  muteWebAudio: boolean;
}

export interface StageTakeManifest {
  takeId: Id;
  videoUri: string;
  durationMs: number;
  recordingRect: Rect;
  pointerEvents: StagePointerEvent[];
  trackMouseEnabled: boolean;
  createdAt: number;
}

export interface IMouseFollowCamera {
  computeSmoothedView(
    pointerEvents: StagePointerEvent[],
    frameTimestampMs: number,
    baseStageRect: Rect,
    zoomFactor: number
  ): { viewport: Rect; zoom: number };
}
