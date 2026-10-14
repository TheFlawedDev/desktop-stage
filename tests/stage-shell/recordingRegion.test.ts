import { describe, expect, it } from "vitest";
import { StageWindowManager } from "../../packages/desktop-engine/src/stage/shell/index";
import type { Rect, Vec2 } from "@cutaway/types";
import { at, makeManager } from "./helpers";

/** Manager with tiny minimums so geometry is exact. */
function geometryManager(): StageWindowManager {
  return makeManager({ minSize: { width: 1, height: 1 } });
}

/** Manager plus one focused, non-minimized 100x100 window at the origin. */
function withWindow(): { manager: StageWindowManager; id: string } {
  const manager = geometryManager();
  const window = manager.openApp("finder", at(0, 0, 100, 100));
  return { manager, id: window.id };
}

describe("setRecordingRegion validation and copying", () => {
  it("rejects a region with a non-finite coordinate and preserves the old region", () => {
    const { manager, id } = withWindow();
    manager.setRecordingRegion({ x: 0, y: 0, width: 50, height: 50 });

    expect(() => manager.setRecordingRegion({ x: Number.NaN, y: 0, width: 50, height: 50 })).toThrow();
    expect(() =>
      manager.setRecordingRegion({ x: 0, y: Number.POSITIVE_INFINITY, width: 50, height: 50 })
    ).toThrow();

    expect(manager.canReceiveInput(id, "content", { x: 40, y: 20 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 60, y: 20 })).toBe(false);
  });

  it.each([
    ["zero width", { x: 0, y: 0, width: 0, height: 50 }],
    ["negative width", { x: 0, y: 0, width: -50, height: 50 }],
    ["infinite width", { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 50 }],
    ["NaN width", { x: 0, y: 0, width: Number.NaN, height: 50 }],
    ["zero height", { x: 0, y: 0, width: 50, height: 0 }],
    ["negative height", { x: 0, y: 0, width: 50, height: -50 }],
    ["infinite height", { x: 0, y: 0, width: 50, height: Number.POSITIVE_INFINITY }],
  ])("rejects a region with %s and preserves the old region", (_label, badRegion) => {
    const { manager, id } = withWindow();
    manager.setRecordingRegion({ x: 0, y: 0, width: 50, height: 50 });

    expect(() => manager.setRecordingRegion(badRegion as Rect)).toThrow();

    expect(manager.canReceiveInput(id, "content", { x: 40, y: 20 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 60, y: 20 })).toBe(false);
  });

  it("copies the region so later caller mutation does not change behavior", () => {
    const { manager, id } = withWindow();
    const region: Rect = { x: 0, y: 0, width: 50, height: 50 };
    manager.setRecordingRegion(region);

    expect(manager.canReceiveInput(id, "content", { x: 40, y: 20 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 60, y: 20 })).toBe(false);

    region.width = 1000;
    region.x = -500;

    expect(manager.canReceiveInput(id, "content", { x: 40, y: 20 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 60, y: 20 })).toBe(false);
  });

  it("treats null as the full desktop and can reset a previous region", () => {
    const { manager, id } = withWindow();
    manager.setRecordingRegion({ x: 0, y: 0, width: 50, height: 50 });
    expect(manager.canReceiveInput(id, "content", { x: 90, y: 20 })).toBe(false);

    manager.setRecordingRegion(null);

    expect(manager.canReceiveInput(id, "content", { x: 90, y: 20 })).toBe(true);
    expect(manager.canReceiveInput(id, "keyboard")).toBe(true);
  });
});

describe("canReceiveInput — content", () => {
  it("allows content for a finite point inside a focused top window", () => {
    const { manager, id } = withWindow();
    expect(manager.canReceiveInput(id, "content", { x: 50, y: 50 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 0, y: 0 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 99.5, y: 99.5 })).toBe(true);
  });

  it("rejects content outside the window or on its right/bottom edges", () => {
    const { manager, id } = withWindow();
    expect(manager.canReceiveInput(id, "content", { x: 150, y: 50 })).toBe(false);
    expect(manager.canReceiveInput(id, "content", { x: 50, y: 150 })).toBe(false);
    expect(manager.canReceiveInput(id, "content", { x: -1, y: 50 })).toBe(false);
    expect(manager.canReceiveInput(id, "content", { x: 100, y: 50 })).toBe(false);
    expect(manager.canReceiveInput(id, "content", { x: 50, y: 100 })).toBe(false);
  });

  it("rejects content for a non-finite or omitted point", () => {
    const { manager, id } = withWindow();
    expect(manager.canReceiveInput(id, "content", { x: Number.NaN, y: 10 })).toBe(false);
    expect(manager.canReceiveInput(id, "content", { x: 10, y: Number.NaN })).toBe(false);
    expect(manager.canReceiveInput(id, "content", { x: Number.POSITIVE_INFINITY, y: 10 })).toBe(false);
    expect(manager.canReceiveInput(id, "content")).toBe(false);
  });

  it("rejects content for a window that is not top-most at the point", () => {
    const manager = geometryManager();
    const lower = manager.openApp("finder", at(0, 0, 100, 100));
    const upper = manager.openApp("iterm", at(0, 0, 100, 100));

    expect(manager.canReceiveInput(lower.id, "content", { x: 50, y: 50 })).toBe(false);
    expect(manager.canReceiveInput(upper.id, "content", { x: 50, y: 50 })).toBe(true);

    // Only the overlapping region is occluded; the lower window keeps its exposed area.
    manager.moveWindow(upper.id, { x: 200, y: 200 });
    expect(manager.canReceiveInput(lower.id, "content", { x: 50, y: 50 })).toBe(true);
  });

  it("rejects content for unknown or minimized windows", () => {
    const { manager, id } = withWindow();
    expect(manager.canReceiveInput("missing", "content", { x: 50, y: 50 })).toBe(false);

    manager.minimizeWindow(id);
    expect(manager.canReceiveInput(id, "content", { x: 50, y: 50 })).toBe(false);
  });

  it("gates content on the recording region when one is set", () => {
    const { manager, id } = withWindow();
    manager.setRecordingRegion({ x: 50, y: 50, width: 50, height: 50 });

    expect(manager.canReceiveInput(id, "content", { x: 50, y: 50 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 75, y: 75 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 40, y: 40 })).toBe(false);
  });

  it("treats the recording region as half-open on its right and bottom edges", () => {
    const { manager, id } = withWindow();
    manager.setRecordingRegion({ x: 50, y: 50, width: 50, height: 50 });

    expect(manager.canReceiveInput(id, "content", { x: 50, y: 75 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 75, y: 50 })).toBe(true);
    expect(manager.canReceiveInput(id, "content", { x: 100, y: 75 })).toBe(false);
    expect(manager.canReceiveInput(id, "content", { x: 75, y: 100 })).toBe(false);
  });

  it("keeps hit-testing independent of the region while gating content", () => {
    const { manager, id } = withWindow();
    manager.setRecordingRegion({ x: 50, y: 50, width: 50, height: 50 });

    // The window is still the top window at the point; only input is gated.
    expect(manager.getTopWindowAt({ x: 40, y: 40 })?.id).toBe(id);
    expect(manager.canReceiveInput(id, "content", { x: 40, y: 40 })).toBe(false);
  });
});

describe("canReceiveInput — keyboard", () => {
  it("allows keyboard input for a focused visible window in full mode", () => {
    const { manager, id } = withWindow();
    expect(manager.canReceiveInput(id, "keyboard")).toBe(true);
  });

  it("rejects keyboard input for unknown, minimized, or unfocused windows", () => {
    const manager = geometryManager();
    const first = manager.openApp("finder", at(0, 0, 100, 100));
    const second = manager.openApp("iterm", at(200, 200, 100, 100));

    expect(manager.canReceiveInput("missing", "keyboard")).toBe(false);
    expect(manager.canReceiveInput(first.id, "keyboard")).toBe(false);
    expect(manager.canReceiveInput(second.id, "keyboard")).toBe(true);

    manager.focusWindow(first.id);
    manager.minimizeWindow(first.id);
    expect(manager.canReceiveInput(first.id, "keyboard")).toBe(false);
  });

  it("requires a positive-area intersection with the recording region", () => {
    const { manager, id } = withWindow();
    manager.setRecordingRegion({ x: 25, y: 25, width: 25, height: 25 });

    expect(manager.canReceiveInput(id, "keyboard")).toBe(true);
  });

  it("rejects keyboard input when the window only touches the region edge", () => {
    const { manager, id } = withWindow();
    manager.setRecordingRegion({ x: 100, y: 0, width: 50, height: 50 });
    expect(manager.canReceiveInput(id, "keyboard")).toBe(false);

    manager.setRecordingRegion({ x: 0, y: 100, width: 50, height: 50 });
    expect(manager.canReceiveInput(id, "keyboard")).toBe(false);

    // A sliver of positive overlap is enough.
    manager.setRecordingRegion({ x: 99.5, y: 0, width: 50, height: 50 });
    expect(manager.canReceiveInput(id, "keyboard")).toBe(true);
  });

  it("rejects keyboard input when the focused window is wholly outside the region", () => {
    const { manager, id } = withWindow();
    manager.setRecordingRegion({ x: 500, y: 500, width: 50, height: 50 });

    expect(manager.canReceiveInput(id, "keyboard")).toBe(false);
  });
});

describe("canReceiveInput — drag", () => {
  it("always allows drag for an existing visible window", () => {
    const { manager, id } = withWindow();
    expect(manager.canReceiveInput(id, "drag")).toBe(true);
    expect(manager.canReceiveInput(id, "drag", { x: 5000, y: 5000 })).toBe(true);
  });

  it("allows drag even when the window is entirely outside the recording region", () => {
    const { manager, id } = withWindow();
    manager.moveWindow(id, { x: 1000, y: 1000 });
    manager.setRecordingRegion({ x: 0, y: 0, width: 100, height: 100 });

    expect(manager.canReceiveInput(id, "content", { x: 1050, y: 1050 })).toBe(false);
    expect(manager.canReceiveInput(id, "drag", { x: 1050, y: 1050 })).toBe(true);
  });

  it("allows drag for a window occluded by a higher window", () => {
    const manager = geometryManager();
    const lower = manager.openApp("finder", at(0, 0, 100, 100));
    manager.openApp("iterm", at(0, 0, 100, 100));

    expect(manager.canReceiveInput(lower.id, "content", { x: 50, y: 50 })).toBe(false);
    expect(manager.canReceiveInput(lower.id, "drag", { x: 50, y: 50 })).toBe(true);
  });

  it("rejects drag for minimized or unknown windows", () => {
    const { manager, id } = withWindow();
    expect(manager.canReceiveInput("missing", "drag")).toBe(false);

    manager.minimizeWindow(id);
    expect(manager.canReceiveInput(id, "drag")).toBe(false);
  });
});

describe("canReceiveInput — inputs are read-only", () => {
  it("does not retain the caller's point object and leaves it unmutated", () => {
    const { manager, id } = withWindow();
    const point: Vec2 = { x: 50, y: 50 };
    manager.setRecordingRegion({ x: 0, y: 0, width: 100, height: 100 });

    expect(manager.canReceiveInput(id, "content", point)).toBe(true);

    point.x = 5000;
    expect(point).toEqual({ x: 5000, y: 50 });
    expect(manager.canReceiveInput(id, "content", { x: 50, y: 50 })).toBe(true);
  });
});
