import type {
  Id,
  IStageWindowManager,
  Rect,
  Size,
  StageAppKind,
  StageWindowConfig,
  Vec2,
} from "@cutaway/types";

export interface StageWindowManagerOptions {
  createId?: () => string;
  defaultRect?: Rect;
  minSize?: Size;
}

const DEFAULT_RECT: Rect = { x: 80, y: 80, width: 640, height: 480 };
const DEFAULT_MIN_SIZE: Size = { width: 160, height: 100 };

const VALID_APP_KINDS: Set<StageAppKind> = new Set([
  "finder",
  "iterm",
  "arc",
  "quicktime",
  "photobooth",
  "custom",
]);

const APP_TITLES: Record<StageAppKind, string> = {
  finder: "Finder",
  iterm: "iTerm",
  arc: "Arc",
  quicktime: "QuickTime",
  photobooth: "Photo Booth",
  custom: "Custom",
};

export const STAGE_DOCK_APPS = Object.freeze([
  Object.freeze({ appKind: "finder" as StageAppKind, title: "Finder" }),
  Object.freeze({ appKind: "iterm" as StageAppKind, title: "iTerm" }),
  Object.freeze({ appKind: "arc" as StageAppKind, title: "Arc" }),
  Object.freeze({ appKind: "quicktime" as StageAppKind, title: "QuickTime" }),
  Object.freeze({ appKind: "photobooth" as StageAppKind, title: "Photo Booth" }),
]);

function isHalfOpenInside(p: Vec2, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
}

function rectsOverlapWithPositiveArea(a: Rect, b: Rect): boolean {
  const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return overlapX > 0 && overlapY > 0;
}

function snapshotWindow(w: StageWindowConfig): StageWindowConfig {
  return {
    ...w,
    rect: { ...w.rect },
  };
}

export class StageWindowManager implements IStageWindowManager {
  private readonly createId: () => string;
  private readonly defaultRect: Rect;
  private readonly minSize: Size;

  private readonly windows = new Map<string, StageWindowConfig>();
  private nextZIndex = 0;
  private focusedWindowId: string | null = null;
  private recordingRegion: Rect | null = null;

  constructor(options: StageWindowManagerOptions = {}) {
    let idCounter = 0;
    this.createId = options.createId ?? (() => `window-${++idCounter}`);
    this.defaultRect = options.defaultRect ? { ...options.defaultRect } : { ...DEFAULT_RECT };
    this.minSize = options.minSize ? { ...options.minSize } : { ...DEFAULT_MIN_SIZE };
  }

  openApp(appKind: StageAppKind, initialRect?: Partial<Rect>): StageWindowConfig {
    if (!VALID_APP_KINDS.has(appKind)) {
      throw new Error(`Invalid appKind: ${appKind}`);
    }

    const x = initialRect?.x ?? this.defaultRect.x;
    const y = initialRect?.y ?? this.defaultRect.y;
    const rawWidth = initialRect?.width ?? this.defaultRect.width;
    const rawHeight = initialRect?.height ?? this.defaultRect.height;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Coordinates must be finite: x=${x}, y=${y}`);
    }

    if (!Number.isFinite(rawWidth) || rawWidth <= 0 || !Number.isFinite(rawHeight) || rawHeight <= 0) {
      throw new Error(`Dimensions must be strictly positive and finite: width=${rawWidth}, height=${rawHeight}`);
    }

    const width = Math.max(rawWidth, this.minSize.width);
    const height = Math.max(rawHeight, this.minSize.height);

    const id = this.createId();
    if (!id || typeof id !== "string") {
      throw new Error("createId returned an empty or invalid string");
    }
    if (this.windows.has(id)) {
      throw new Error(`Window ID already in use: ${id}`);
    }

    // Clear focus on all existing windows
    for (const win of this.windows.values()) {
      win.isFocused = false;
    }

    const zIndex = ++this.nextZIndex;
    const title = APP_TITLES[appKind];

    const window: StageWindowConfig = {
      id,
      appKind,
      title,
      rect: { x, y, width, height },
      zIndex,
      isFocused: true,
      isMinimized: false,
    };

    this.windows.set(id, window);
    this.focusedWindowId = id;

    return snapshotWindow(window);
  }

  closeWindow(windowId: Id): void {
    const existing = this.windows.get(windowId);
    if (!existing) return;

    this.windows.delete(windowId);

    if (this.focusedWindowId === windowId) {
      this.recomputeFocus();
    }
  }

  focusWindow(windowId: Id): void {
    const window = this.windows.get(windowId);
    if (!window || window.isMinimized) return;

    for (const win of this.windows.values()) {
      win.isFocused = false;
    }

    window.isFocused = true;
    window.zIndex = ++this.nextZIndex;
    this.focusedWindowId = windowId;
  }

  moveWindow(windowId: Id, pos: Vec2): void {
    const window = this.windows.get(windowId);
    if (!window) return;

    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      throw new Error(`Invalid move coordinates: x=${pos.x}, y=${pos.y}`);
    }

    window.rect.x = pos.x;
    window.rect.y = pos.y;
  }

  resizeWindow(windowId: Id, size: Size): void {
    const window = this.windows.get(windowId);
    if (!window) return;

    if (!Number.isFinite(size.width) || size.width <= 0 || !Number.isFinite(size.height) || size.height <= 0) {
      throw new Error(`Invalid resize dimensions: width=${size.width}, height=${size.height}`);
    }

    window.rect.width = Math.max(size.width, this.minSize.width);
    window.rect.height = Math.max(size.height, this.minSize.height);
  }

  minimizeWindow(windowId: Id): void {
    const window = this.windows.get(windowId);
    if (!window || window.isMinimized) return;

    window.isMinimized = true;

    if (this.focusedWindowId === windowId) {
      window.isFocused = false;
      this.recomputeFocus();
    }
  }

  restoreWindow(windowId: Id): void {
    const window = this.windows.get(windowId);
    if (!window) return;

    window.isMinimized = false;
    this.focusWindow(windowId);
  }

  getWindows(): StageWindowConfig[] {
    const list = Array.from(this.windows.values()).map(snapshotWindow);
    list.sort((a, b) => a.zIndex - b.zIndex);
    return list;
  }

  getFocusedWindow(): StageWindowConfig | null {
    if (!this.focusedWindowId) return null;
    const window = this.windows.get(this.focusedWindowId);
    if (!window || window.isMinimized) return null;
    return snapshotWindow(window);
  }

  getTopWindowAt(pos: Vec2): StageWindowConfig | null {
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;

    let topWindow: StageWindowConfig | null = null;
    for (const win of this.windows.values()) {
      if (win.isMinimized) continue;
      if (isHalfOpenInside(pos, win.rect)) {
        if (!topWindow || win.zIndex > topWindow.zIndex) {
          topWindow = win;
        }
      }
    }

    return topWindow ? snapshotWindow(topWindow) : null;
  }

  setRecordingRegion(region: Rect | null): void {
    if (region === null) {
      this.recordingRegion = null;
      return;
    }

    if (
      !Number.isFinite(region.x) ||
      !Number.isFinite(region.y) ||
      !Number.isFinite(region.width) ||
      region.width <= 0 ||
      !Number.isFinite(region.height) ||
      region.height <= 0
    ) {
      throw new Error(`Invalid recording region`);
    }

    this.recordingRegion = { ...region };
  }

  getRecordingRegion(): Rect | null {
    return this.recordingRegion ? { ...this.recordingRegion } : null;
  }

  canReceiveInput(
    windowId: Id,
    type: "content" | "titlebar" | "keyboard" | "drag",
    pos?: Vec2
  ): boolean {
    const window = this.windows.get(windowId);
    if (!window || window.isMinimized) return false;

    if (type === "drag" || type === "titlebar") {
      return true;
    }

    if (type === "content") {
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false;
      if (!isHalfOpenInside(pos, window.rect)) return false;

      const top = this.getTopWindowAt(pos);
      if (top?.id !== windowId) return false;

      if (this.recordingRegion && !isHalfOpenInside(pos, this.recordingRegion)) {
        return false;
      }

      return true;
    }

    if (type === "keyboard") {
      if (this.focusedWindowId !== windowId || !window.isFocused) return false;
      if (this.recordingRegion) {
        return rectsOverlapWithPositiveArea(window.rect, this.recordingRegion);
      }
      return true;
    }

    return false;
  }

  private recomputeFocus(): void {
    let highestVisible: StageWindowConfig | null = null;
    for (const win of this.windows.values()) {
      if (!win.isMinimized) {
        if (!highestVisible || win.zIndex > highestVisible.zIndex) {
          highestVisible = win;
        }
      }
    }

    for (const win of this.windows.values()) {
      win.isFocused = win === highestVisible;
    }

    this.focusedWindowId = highestVisible ? highestVisible.id : null;
  }
}

export function activateDockApp(
  manager: StageWindowManager,
  appKind: StageAppKind
): StageWindowConfig {
  const existing = manager.getWindows().filter((w) => w.appKind === appKind);
  if (existing.length > 0) {
    const top = existing.reduce((prev, curr) => (curr.zIndex > prev.zIndex ? curr : prev));
    if (top.isMinimized) {
      manager.restoreWindow(top.id);
    } else {
      manager.focusWindow(top.id);
    }
    const focused = manager.getFocusedWindow();
    if (focused) return focused;
    const refreshed = manager.getWindows().find((w) => w.id === top.id);
    if (refreshed) return refreshed;
  }

  return manager.openApp(appKind);
}
