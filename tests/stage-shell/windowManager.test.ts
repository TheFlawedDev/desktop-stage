import { describe, expect, it } from "vitest";
import { StageWindowManager } from "../../packages/desktop-engine/src/stage/shell/index";
import type { StageAppKind } from "@cutaway/types";
import { DEFAULT_MIN_SIZE, DEFAULT_RECT, makeManager, windowById } from "./helpers";

const ALL_KINDS: StageAppKind[] = ["finder", "iterm", "arc", "quicktime", "photobooth", "custom"];

const EXPECTED_TITLES: Array<[StageAppKind, string]> = [
  ["finder", "Finder"],
  ["iterm", "iTerm"],
  ["arc", "Arc"],
  ["quicktime", "QuickTime"],
  ["photobooth", "Photo Booth"],
  ["custom", "Custom"],
];

describe("StageWindowManager construction", () => {
  it("starts empty with no focused window", () => {
    const manager = makeManager();
    expect(manager.getWindows()).toEqual([]);
    expect(manager.getFocusedWindow()).toBeNull();
  });

  it("keeps independent Map-backed state per instance", () => {
    const first = makeManager();
    const second = makeManager();

    const window = first.openApp("finder");
    first.setRecordingRegion({ x: 0, y: 0, width: 100, height: 100 });

    expect(first.getWindows()).toHaveLength(1);
    expect(second.getWindows()).toEqual([]);
    expect(second.getFocusedWindow()).toBeNull();

    // The two managers must not alias each other's windows.
    expect(second.getTopWindowAt({ x: window.rect.x + 1, y: window.rect.y + 1 })).toBeNull();
  });

  it("does not alias the supplied defaultRect and minSize option objects", () => {
    const defaultRect = { x: 1, y: 2, width: 300, height: 200 };
    const minSize = { width: 50, height: 50 };
    const manager = new StageWindowManager({ defaultRect, minSize });

    defaultRect.width = 9999;
    minSize.width = 9999;

    const window = manager.openApp("arc", { width: 10 });
    expect(window.rect.x).toBe(1);
    expect(window.rect.y).toBe(2);
    expect(window.rect.width).toBe(50);
    expect(window.rect.height).toBe(200);
  });

  it("honors a custom defaultRect for openApp without an explicit rect", () => {
    const manager = new StageWindowManager({
      defaultRect: { x: -10, y: 20, width: 500, height: 400 },
    });

    const window = manager.openApp("finder");
    expect(window.rect).toEqual({ x: -10, y: 20, width: 500, height: 400 });
  });

  it("honors a custom minSize when clamping", () => {
    const manager = new StageWindowManager({ minSize: { width: 50, height: 60 } });
    const window = manager.openApp("finder", { width: 10, height: 20 });
    expect(window.rect.width).toBe(50);
    expect(window.rect.height).toBe(60);
  });
});

describe("openApp titles and identity", () => {
  it.each(EXPECTED_TITLES)("opens %s with the title %s", (kind, title) => {
    const manager = makeManager();
    const window = manager.openApp(kind);
    expect(window.appKind).toBe(kind);
    expect(window.title).toBe(title);
  });

  it("produces unique non-empty ids for every window", () => {
    const manager = makeManager();
    const ids = ALL_KINDS.map((kind) => manager.openApp(kind).id);

    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the injected createId values verbatim", () => {
    const generated = ["alpha", "beta", "gamma"];
    let index = 0;
    const manager = new StageWindowManager({ createId: () => generated[index++]! });

    expect(manager.openApp("finder").id).toBe("alpha");
    expect(manager.openApp("iterm").id).toBe("beta");
    expect(manager.openApp("arc").id).toBe("gamma");
  });

  it("returns a fresh snapshot that can be mutated safely", () => {
    const manager = makeManager();
    const window = manager.openApp("finder");
    window.rect.x = 12345;
    window.title = "hacked";
    window.isFocused = false;

    const stored = windowById(manager, window.id);
    expect(stored.rect.x).toBe(DEFAULT_RECT.x);
    expect(stored.title).toBe("Finder");
    expect(stored.isFocused).toBe(true);
  });

  it("throws when createId returns an empty string and does not mutate", () => {
    const manager = new StageWindowManager({ createId: () => "" });
    expect(() => manager.openApp("finder")).toThrow();
    expect(manager.getWindows()).toEqual([]);
    expect(manager.getFocusedWindow()).toBeNull();
  });

  it("throws when createId returns a duplicate id and does not mutate", () => {
    const manager = new StageWindowManager({ createId: () => "duplicate" });
    manager.openApp("finder");

    expect(() => manager.openApp("iterm")).toThrow();
    expect(manager.getWindows()).toHaveLength(1);
    expect(manager.getWindows()[0]!.appKind).toBe("finder");
  });

  it("throws on an invalid runtime app kind without mutating", () => {
    const manager = makeManager();
    expect(() => manager.openApp("bogus" as StageAppKind)).toThrow();
    expect(() => manager.openApp(undefined as unknown as StageAppKind)).toThrow();
    expect(manager.getWindows()).toEqual([]);
  });

});

describe("openApp initial rect merge and validation", () => {
  it("applies the documented default rect", () => {
    const manager = makeManager();
    const window = manager.openApp("finder");
    expect(window.rect).toEqual(DEFAULT_RECT);
    expect(window.isFocused).toBe(true);
    expect(window.isMinimized).toBe(false);
    expect(Number.isFinite(window.zIndex)).toBe(true);
  });

  it("merges a partial rect over the default field by field", () => {
    const manager = makeManager();
    const window = manager.openApp("finder", { x: 5 });
    expect(window.rect).toEqual({ ...DEFAULT_RECT, x: 5 });

    const other = manager.openApp("arc", { width: 800, height: 600 });
    expect(other.rect).toEqual({ x: 80, y: 80, width: 800, height: 600 });
  });

  it("permits negative x and y", () => {
    const manager = makeManager();
    const window = manager.openApp("finder", { x: -200, y: -75 });
    expect(window.rect.x).toBe(-200);
    expect(window.rect.y).toBe(-75);
  });

  it("clamps positive but undersized dimensions up to minSize", () => {
    const manager = makeManager();
    const window = manager.openApp("finder", { width: 10, height: 20 });
    expect(window.rect.width).toBe(DEFAULT_MIN_SIZE.width);
    expect(window.rect.height).toBe(DEFAULT_MIN_SIZE.height);
  });

  it("preserves dimensions larger than minSize", () => {
    const manager = makeManager();
    const window = manager.openApp("finder", { width: 1920, height: 1080 });
    expect(window.rect.width).toBe(1920);
    expect(window.rect.height).toBe(1080);
  });

  it.each([
    ["NaN x", { x: Number.NaN }],
    ["infinite y", { y: Number.POSITIVE_INFINITY }],
    ["NaN width", { width: Number.NaN }],
    ["infinite height", { height: Number.POSITIVE_INFINITY }],
    ["zero width", { width: 0 }],
    ["negative width", { width: -10 }],
    ["zero height", { height: 0 }],
    ["negative height", { height: -10 }],
  ])("throws on %s without mutating", (_label, badRect) => {
    const manager = makeManager();
    const existing = manager.openApp("finder");

    expect(() => manager.openApp("iterm", badRect)).toThrow();

    expect(manager.getWindows()).toHaveLength(1);
    expect(manager.getWindows()[0]!.id).toBe(existing.id);
    expect(manager.getFocusedWindow()?.id).toBe(existing.id);
  });

  it("keeps a previously opened window unchanged when a later openApp fails", () => {
    const manager = makeManager();
    const first = manager.openApp("finder", { x: 10, y: 10 });
    const before = manager.getWindows();

    expect(() => manager.openApp("iterm", { width: Number.NaN })).toThrow();

    expect(manager.getWindows()).toEqual(before);
    expect(manager.getFocusedWindow()?.id).toBe(first.id);
  });
});

describe("getWindows ordering and defensive snapshots", () => {
  it("returns windows in ascending zIndex order", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    const c = manager.openApp("arc");

    const windows = manager.getWindows();
    expect(windows.map((w) => w.id)).toEqual([a.id, b.id, c.id]);
    expect(windows[0]!.zIndex).toBeLessThan(windows[1]!.zIndex);
    expect(windows[1]!.zIndex).toBeLessThan(windows[2]!.zIndex);
  });

  it("returns a new array each call whose mutation does not affect state", () => {
    const manager = makeManager();
    manager.openApp("finder");
    manager.openApp("iterm");

    const list = manager.getWindows();
    list.pop();
    list.push({ ...list[0]!, id: "injected" });

    expect(manager.getWindows()).toHaveLength(2);
    expect(manager.getWindows().map((w) => w.id)).not.toContain("injected");
  });

  it("returns deep copies so nested rect mutation is safe", () => {
    const manager = makeManager();
    const window = manager.openApp("finder", { x: 0, y: 0, width: 300, height: 200 });

    const [snapshot] = manager.getWindows();
    snapshot!.rect.x = 999;
    snapshot!.rect.width = 1;
    snapshot!.isFocused = false;
    snapshot!.isMinimized = true;

    const stored = windowById(manager, window.id);
    expect(stored.rect).toEqual({ x: 0, y: 0, width: 300, height: 200 });
    expect(stored.isFocused).toBe(true);
    expect(stored.isMinimized).toBe(false);
  });

  it("does not renumber remaining zIndex values after a close", () => {
    const manager = makeManager();
    const a = manager.openApp("finder");
    const b = manager.openApp("iterm");
    const c = manager.openApp("arc");

    const zBefore = new Map(manager.getWindows().map((w) => [w.id, w.zIndex]));
    manager.closeWindow(b.id);

    const windows = manager.getWindows();
    expect(windows.map((w) => w.id)).toEqual([a.id, c.id]);
    expect(windows.find((w) => w.id === a.id)!.zIndex).toBe(zBefore.get(a.id));
    expect(windows.find((w) => w.id === c.id)!.zIndex).toBe(zBefore.get(c.id));
  });

});
