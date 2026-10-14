import { describe, expect, it } from "vitest";
import { StageWindowManager } from "../../packages/desktop-engine/src/stage/shell/index";
import {
  at,
  focusedId,
  makeManager,
  windowById,
  zIndexOf,
} from "./helpers";

/** Manager with tiny minimums so hit-test rects can be exact. */
function geometryManager(): StageWindowManager {
  return makeManager({ minSize: { width: 1, height: 1 } });
}

describe("focus behavior", () => {
  it("focuses each newly opened window and clears the previous focus", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");

    expect(windowById(manager, a.id).isFocused).toBe(false);
    expect(windowById(manager, b.id).isFocused).toBe(true);
    expect(manager.getWindows().filter((w) => w.isFocused)).toHaveLength(1);
  });

  it("makes a focused window top-most and the sole focused window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    const c = manager.openApp("arc");

    manager.focusWindow(a.id);

    expect(windowById(manager, a.id).isFocused).toBe(true);
    expect(windowById(manager, b.id).isFocused).toBe(false);
    expect(windowById(manager, c.id).isFocused).toBe(false);
    expect(zIndexOf(manager, a.id)).toBeGreaterThan(zIndexOf(manager, b.id));
    expect(zIndexOf(manager, a.id)).toBeGreaterThan(zIndexOf(manager, c.id));
    // Ascending order now ends with the focused window.
    expect(manager.getWindows().at(-1)!.id).toBe(a.id);
  });

  it("does not change rect or minimized flag when focusing", () => {
    const manager = makeManager();
    const a = manager.openApp("finder", { x: 3, y: 4 });
    manager.openApp("iterm");

    manager.focusWindow(a.id);

    const focused = windowById(manager, a.id);
    expect(focused.rect).toEqual({ ...a.rect });
    expect(focused.isMinimized).toBe(false);
  });

  it("ignores focusWindow for an unknown id", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const before = manager.getWindows();

    manager.focusWindow("missing");

    expect(manager.getWindows()).toEqual(before);
    expect(focusedId(manager)).toBe(a.id);
  });

  it("ignores focusWindow for a minimized window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    manager.minimizeWindow(a.id);

    const zBefore = zIndexOf(manager, a.id);
    manager.focusWindow(a.id);

    expect(windowById(manager, a.id).isMinimized).toBe(true);
    expect(windowById(manager, a.id).isFocused).toBe(false);
    expect(zIndexOf(manager, a.id)).toBe(zBefore);
    expect(focusedId(manager)).toBe(b.id);
  });
});

describe("close behavior", () => {
  it("ignores closeWindow for an unknown id", () => {
    const manager = makeManager();
    manager.openApp("finder");
    const before = manager.getWindows();

    manager.closeWindow("missing");

    expect(manager.getWindows()).toEqual(before);
  });

  it("removes the window and passes focus to the highest visible window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    const c = manager.openApp("arc");

    manager.closeWindow(c.id);

    expect(manager.getWindows().map((w) => w.id)).toEqual([a.id, b.id]);
    expect(focusedId(manager)).toBe(b.id);
    expect(zIndexOf(manager, b.id)).toBeGreaterThan(zIndexOf(manager, a.id));
  });

  it("preserves focus when closing a non-focused window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    manager.openApp("arc");
    const b = manager.openApp("iterm");

    manager.closeWindow(a.id);

    expect(focusedId(manager)).toBe(b.id);
  });

  it("leaves no focused window after closing the last window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    manager.closeWindow(a.id);

    expect(manager.getWindows()).toEqual([]);
    expect(manager.getFocusedWindow()).toBeNull();
  });

  it("leaves no focused window when closing the focused window and the rest are minimized", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    manager.minimizeWindow(a.id);
    manager.focusWindow(b.id);

    manager.closeWindow(b.id);

    expect(manager.getWindows().map((w) => w.id)).toEqual([a.id]);
    expect(manager.getFocusedWindow()).toBeNull();
  });
});

describe("minimize behavior", () => {
  it("ignores minimizeWindow for an unknown id", () => {
    const manager = makeManager();
    manager.openApp("finder");
    const before = manager.getWindows();

    manager.minimizeWindow("missing");

    expect(manager.getWindows()).toEqual(before);
  });

  it("minimizes the focused window and passes focus to the highest visible window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    const c = manager.openApp("arc");

    manager.minimizeWindow(c.id);

    expect(windowById(manager, c.id).isMinimized).toBe(true);
    expect(windowById(manager, c.id).isFocused).toBe(false);
    expect(focusedId(manager)).toBe(b.id);
    expect(zIndexOf(manager, b.id)).toBeGreaterThan(zIndexOf(manager, a.id));
  });

  it("preserves focus and z-order when minimizing a non-focused window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    const c = manager.openApp("arc");

    const zA = zIndexOf(manager, a.id);
    manager.minimizeWindow(a.id);

    expect(windowById(manager, a.id).isMinimized).toBe(true);
    expect(focusedId(manager)).toBe(c.id);
    expect(zIndexOf(manager, a.id)).toBe(zA);
    expect(zIndexOf(manager, b.id)).toBeLessThan(zIndexOf(manager, c.id));
  });

  it("is a no-op when the window is already minimized", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    manager.minimizeWindow(a.id);
    const before = manager.getWindows();

    manager.minimizeWindow(a.id);

    expect(manager.getWindows()).toEqual(before);
    expect(focusedId(manager)).toBe(b.id);
  });

  it("leaves no focused window when the last visible window is minimized", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    manager.minimizeWindow(a.id);
    manager.minimizeWindow(b.id);

    expect(manager.getFocusedWindow()).toBeNull();
    expect(manager.getWindows().every((w) => w.isMinimized)).toBe(true);
  });

  it("keeps a minimized window present but out of hit-testing", () => {
    const manager = geometryManager();
    const a = manager.openApp("finder", at(0, 0, 100, 100));

    expect(manager.getTopWindowAt({ x: 10, y: 10 })?.id).toBe(a.id);
    manager.minimizeWindow(a.id);
    expect(manager.getTopWindowAt({ x: 10, y: 10 })).toBeNull();
    expect(manager.getWindows().map((w) => w.id)).toEqual([a.id]);
  });
});

describe("restore behavior", () => {
  it("ignores restoreWindow for an unknown id", () => {
    const manager = makeManager();
    manager.openApp("finder");
    const before = manager.getWindows();

    manager.restoreWindow("missing");

    expect(manager.getWindows()).toEqual(before);
  });

  it("un-minimizes and focuses a minimized window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    manager.minimizeWindow(a.id);

    manager.restoreWindow(a.id);

    expect(windowById(manager, a.id).isMinimized).toBe(false);
    expect(windowById(manager, a.id).isFocused).toBe(true);
    expect(windowById(manager, b.id).isFocused).toBe(false);
    expect(zIndexOf(manager, a.id)).toBeGreaterThan(zIndexOf(manager, b.id));
  });

  it("focuses an already-visible window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");

    manager.restoreWindow(a.id);

    expect(windowById(manager, a.id).isFocused).toBe(true);
    expect(windowById(manager, b.id).isFocused).toBe(false);
  });
});

describe("getFocusedWindow", () => {
  it("returns null before any window opens", () => {
    expect(makeManager().getFocusedWindow()).toBeNull();
  });

  it("returns a defensive snapshot of the focused window", () => {
    const manager = makeManager();
    const a = manager.openApp("finder", { x: 0, y: 0 });

    const snapshot = manager.getFocusedWindow()!;
    snapshot.rect.x = 5000;
    snapshot.isFocused = false;
    snapshot.title = "changed";

    const stored = windowById(manager, a.id);
    expect(stored.rect.x).toBe(0);
    expect(stored.isFocused).toBe(true);
    expect(stored.title).toBe("Finder");
  });

  it("tracks the sole focused window across focus changes", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");

    expect(focusedId(manager)).toBe(b.id);
    manager.focusWindow(a.id);
    expect(focusedId(manager)).toBe(a.id);
  });
});

describe("moveWindow", () => {
  it("moves the rect while preserving focus and zIndex", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    const zA = zIndexOf(manager, a.id);

    manager.moveWindow(b.id, { x: 12, y: 34 });

    expect(windowById(manager, b.id).rect).toEqual({ ...b.rect, x: 12, y: 34 });
    expect(windowById(manager, b.id).isFocused).toBe(true);
    expect(zIndexOf(manager, b.id)).toBe(b.zIndex);
    expect(zIndexOf(manager, a.id)).toBe(zA);
  });

  it("permits negative coordinates", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    manager.moveWindow(a.id, { x: -120, y: -40 });
    expect(windowById(manager, a.id).rect.x).toBe(-120);
    expect(windowById(manager, a.id).rect.y).toBe(-40);
  });

  it("ignores moveWindow for an unknown id", () => {
    const manager = makeManager();
    manager.openApp("finder");
    const before = manager.getWindows();

    manager.moveWindow("missing", { x: 1, y: 2 });

    expect(manager.getWindows()).toEqual(before);
  });

  it.each([
    ["NaN x", { x: Number.NaN, y: 0 }],
    ["infinite x", { x: Number.POSITIVE_INFINITY, y: 0 }],
    ["NaN y", { x: 0, y: Number.NaN }],
    ["infinite y", { x: 0, y: Number.NEGATIVE_INFINITY }],
  ])("throws on %s without mutating", (_label, pos) => {
    const manager = makeManager();
    const a = manager.openApp("finder", { x: 10, y: 20, width: 300, height: 200 });
    const before = manager.getWindows();

    expect(() => manager.moveWindow(a.id, pos)).toThrow();

    expect(manager.getWindows()).toEqual(before);
  });
});

describe("resizeWindow", () => {
  it("resizes while preserving focus and zIndex", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    const zB = zIndexOf(manager, b.id);

    manager.resizeWindow(b.id, { width: 900, height: 700 });

    expect(windowById(manager, b.id).rect).toEqual({ ...b.rect, width: 900, height: 700 });
    expect(windowById(manager, b.id).isFocused).toBe(true);
    expect(zIndexOf(manager, b.id)).toBe(zB);
    expect(zIndexOf(manager, a.id)).toBe(a.zIndex);
  });

  it("clamps undersized positive dimensions up to minSize", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");

    manager.resizeWindow(a.id, { width: 5, height: 6 });

    expect(windowById(manager, a.id).rect.width).toBe(160);
    expect(windowById(manager, a.id).rect.height).toBe(100);
  });

  it("ignores resizeWindow for an unknown id", () => {
    const manager = makeManager();
    manager.openApp("finder");
    const before = manager.getWindows();

    manager.resizeWindow("missing", { width: 500, height: 500 });

    expect(manager.getWindows()).toEqual(before);
  });

  it.each([
    ["NaN width", { width: Number.NaN, height: 200 }],
    ["infinite width", { width: Number.POSITIVE_INFINITY, height: 200 }],
    ["zero width", { width: 0, height: 200 }],
    ["negative width", { width: -1, height: 200 }],
    ["NaN height", { width: 200, height: Number.NaN }],
    ["zero height", { width: 200, height: 0 }],
    ["negative height", { width: 200, height: -1 }],
  ])("throws on %s without mutating", (_label, size) => {
    const manager = makeManager();
    const a = manager.openApp("finder", { x: 5, y: 6, width: 300, height: 200 });
    const before = manager.getWindows();

    expect(() => manager.resizeWindow(a.id, size)).toThrow();

    expect(manager.getWindows()).toEqual(before);
  });
});

describe("getTopWindowAt", () => {
  it("returns null when no window contains the point", () => {
    const manager = geometryManager();
    manager.openApp("finder", at(0, 0, 100, 100));

    expect(manager.getTopWindowAt({ x: 150, y: 150 })).toBeNull();
  });

  it("returns null for non-finite coordinates", () => {
    const manager = geometryManager();
    manager.openApp("finder", at(0, 0, 100, 100));

    expect(manager.getTopWindowAt({ x: Number.NaN, y: 10 })).toBeNull();
    expect(manager.getTopWindowAt({ x: 10, y: Number.NaN })).toBeNull();
    expect(manager.getTopWindowAt({ x: Number.POSITIVE_INFINITY, y: 10 })).toBeNull();
    expect(manager.getTopWindowAt({ x: 10, y: Number.NEGATIVE_INFINITY })).toBeNull();
  });

  it("treats the rect as half-open on right and bottom edges", () => {
    const manager = geometryManager();
    const a = manager.openApp("finder", at(0, 0, 100, 100));

    expect(manager.getTopWindowAt({ x: 0, y: 0 })?.id).toBe(a.id);
    expect(manager.getTopWindowAt({ x: 99.999, y: 99.999 })?.id).toBe(a.id);
    expect(manager.getTopWindowAt({ x: 100, y: 50 })).toBeNull();
    expect(manager.getTopWindowAt({ x: 50, y: 100 })).toBeNull();
    expect(manager.getTopWindowAt({ x: 100, y: 100 })).toBeNull();
  });

  it("returns the highest-zIndex window at an overlap", () => {
    const manager = geometryManager();
    const a = manager.openApp("finder", at(0, 0, 100, 100));
    const b = manager.openApp("iterm", at(50, 50, 100, 100));

    expect(manager.getTopWindowAt({ x: 10, y: 10 })?.id).toBe(a.id);
    expect(manager.getTopWindowAt({ x: 60, y: 60 })?.id).toBe(b.id);

    manager.focusWindow(a.id);
    expect(manager.getTopWindowAt({ x: 60, y: 60 })?.id).toBe(a.id);
  });

  it("excludes minimized windows even when they are otherwise top-most", () => {
    const manager = geometryManager();
    const a = manager.openApp("finder", at(0, 0, 100, 100));
    const b = manager.openApp("iterm", at(0, 0, 100, 100));
    manager.minimizeWindow(b.id);

    expect(manager.getTopWindowAt({ x: 50, y: 50 })?.id).toBe(a.id);

    manager.minimizeWindow(a.id);
    expect(manager.getTopWindowAt({ x: 50, y: 50 })).toBeNull();
  });

  it("returns a defensive snapshot", () => {
    const manager = geometryManager();
    const a = manager.openApp("finder", at(0, 0, 100, 100));

    const hit = manager.getTopWindowAt({ x: 10, y: 10 })!;
    hit.rect.x = 9999;
    hit.isFocused = false;

    expect(manager.getTopWindowAt({ x: 10, y: 10 })!.rect.x).toBe(0);
    expect(manager.getTopWindowAt({ x: 10, y: 10 })!.isFocused).toBe(true);
    expect(windowById(manager, a.id).rect.x).toBe(0);
  });
});
