/**
 * `MouseFollowCamera` — the post-recording 1.5x follow view.
 *
 * The camera is a pure function: given the same events, frame time, base rect,
 * and zoom it must return the same viewport, regardless of the order the frames
 * are scrubbed in or how the event array is shuffled. Before the first pointer
 * the viewport is centered; after it, a zero-order-held target is approached
 * with exponential smoothing (tau = 180 ms). Pointer targets and the viewport
 * are always clamped inside the base rect.
 */

import { describe, expect, it } from "vitest";
import type { PointerEventType, Rect, StagePointerEvent } from "@cutaway/types";
import { MouseFollowCamera } from "../../packages/desktop-engine/src/stage/effects/index";

const base: Rect = { x: 0, y: 0, width: 1000, height: 600 };

function ev(
  timestampMs: number,
  x: number,
  y: number,
  type: PointerEventType = "move",
): StagePointerEvent {
  return { timestampMs, pos: { x, y }, type };
}

function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function centeredViewport(zoom: number): Rect {
  const width = base.width / zoom;
  const height = base.height / zoom;
  return {
    x: base.x + (base.width - width) / 2,
    y: base.y + (base.height - height) / 2,
    width,
    height,
  };
}

function distanceFrom(rect: Rect, point: { x: number; y: number }): number {
  const center = centerOf(rect);
  return Math.hypot(center.x - point.x, center.y - point.y);
}

/** A spread of events held at one place, 180 ms apart. */
function heldAt(x: number, y: number, count = 12, stepMs = 180): StagePointerEvent[] {
  return Array.from({ length: count }, (_, index) => ev(index * stepMs, x, y));
}

describe("MouseFollowCamera — viewport shape", () => {
  it("centers the viewport before the first pointer", () => {
    const camera = new MouseFollowCamera();
    const result = camera.computeSmoothedView([], 500, base, 1.5);

    expect(result.zoom).toBe(1.5);
    expect(result.viewport.x).toBeCloseTo(centeredViewport(1.5).x, 6);
    expect(result.viewport.y).toBeCloseTo(centeredViewport(1.5).y, 6);
    expect(result.viewport.width).toBeCloseTo(base.width / 1.5, 6);
    expect(result.viewport.height).toBeCloseTo(base.height / 1.5, 6);
  });

  it("stays centered while every pointer event is in the future", () => {
    const camera = new MouseFollowCamera();
    const result = camera.computeSmoothedView([ev(5000, 0, 0)], 100, base, 2);

    expect(result.viewport).toEqual(centeredViewport(2));
  });

  it("makes the viewport 1.5 times smaller for the default zoom", () => {
    const camera = new MouseFollowCamera();
    const result = camera.computeSmoothedView(heldAt(600, 320), 2160, base, 1.5);

    expect(result.zoom).toBe(1.5);
    expect(result.viewport.width).toBeCloseTo(base.width / 1.5, 6);
    expect(result.viewport.height).toBeCloseTo(base.height / 1.5, 6);
  });

  it("returns the entire base rect at zoom 1", () => {
    const camera = new MouseFollowCamera();
    const result = camera.computeSmoothedView(heldAt(900, 100), 2160, base, 1);

    expect(result.zoom).toBe(1);
    expect(result.viewport).toEqual(base);
  });

  it("defaults the zoom factor to 1.5 when it is omitted", () => {
    const camera = new MouseFollowCamera();
    const view = camera.computeSmoothedView as unknown as (
      events: StagePointerEvent[],
      time: number,
      rect: Rect,
    ) => { viewport: Rect; zoom: number };

    const result = view([], 100, base);

    expect(result.zoom).toBe(1.5);
    expect(result.viewport.width).toBeCloseTo(base.width / 1.5, 6);
  });

  it("accepts a base rect with a non-zero origin", () => {
    const offset: Rect = { x: 200, y: 100, width: 800, height: 400 };
    const camera = new MouseFollowCamera();
    const result = camera.computeSmoothedView([], 0, offset, 2);

    expect(result.viewport).toEqual({ x: 400, y: 200, width: 400, height: 200 });
  });
});

describe("MouseFollowCamera — following", () => {
  const target = { x: 600, y: 320 };

  it("approaches a held pointer as time advances", () => {
    const camera = new MouseFollowCamera();
    const events = heldAt(target.x, target.y);

    const early = camera.computeSmoothedView(events, 0, base, 1.5);
    const later = camera.computeSmoothedView(events, 2160, base, 1.5);

    expect(distanceFrom(early.viewport, target)).toBeGreaterThan(1);
    expect(distanceFrom(later.viewport, target)).toBeLessThan(1);
    expect(centerOf(later.viewport).x).toBeCloseTo(target.x, 0);
    expect(centerOf(later.viewport).y).toBeCloseTo(target.y, 0);
  });

  it("moves strictly closer over successive intervals", () => {
    const camera = new MouseFollowCamera();
    const events = heldAt(target.x, target.y);

    const start = camera.computeSmoothedView(events, 0, base, 1.5);
    const one = camera.computeSmoothedView(events, 180, base, 1.5);
    const two = camera.computeSmoothedView(events, 360, base, 1.5);
    const three = camera.computeSmoothedView(events, 540, base, 1.5);

    const d0 = distanceFrom(start.viewport, target);
    const d1 = distanceFrom(one.viewport, target);
    const d2 = distanceFrom(two.viewport, target);
    const d3 = distanceFrom(three.viewport, target);

    expect(d1).toBeLessThan(d0);
    expect(d2).toBeLessThanOrEqual(d1);
    expect(d3).toBeLessThanOrEqual(d2);
  });

  it("clamps a pointer target outside the base rect", () => {
    const camera = new MouseFollowCamera();
    const result = camera.computeSmoothedView(heldAt(-500, -500), 2160, base, 2);

    const center = centerOf(result.viewport);
    expect(result.viewport.x).toBeGreaterThanOrEqual(base.x);
    expect(result.viewport.y).toBeGreaterThanOrEqual(base.y);
    expect(result.viewport.x + result.viewport.width).toBeLessThanOrEqual(base.x + base.width);
    expect(result.viewport.y + result.viewport.height).toBeLessThanOrEqual(base.y + base.height);
    expect(center.x).toBeLessThanOrEqual(base.x + base.width / 2);
    expect(center.y).toBeLessThanOrEqual(base.y + base.height / 2);
  });

  it("keeps the viewport inside the base rect at every frame", () => {
    const camera = new MouseFollowCamera();
    const events = [
      ev(0, -100, -100),
      ev(180, 2000, 2000),
      ev(360, 500, -50),
      ev(540, -50, 500),
      ev(720, 990, 590),
    ];

    for (const time of [0, 90, 180, 360, 540, 720, 1080, 2160]) {
      const { viewport } = camera.computeSmoothedView(events, time, base, 1.5);
      expect(viewport.x).toBeGreaterThanOrEqual(base.x - 1e-9);
      expect(viewport.y).toBeGreaterThanOrEqual(base.y - 1e-9);
      expect(viewport.x + viewport.width).toBeLessThanOrEqual(base.x + base.width + 1e-9);
      expect(viewport.y + viewport.height).toBeLessThanOrEqual(base.y + base.height + 1e-9);
    }
  });

  it("clamps inside a base rect with a non-zero origin", () => {
    const offset: Rect = { x: 200, y: 100, width: 800, height: 400 };
    const camera = new MouseFollowCamera();
    const result = camera.computeSmoothedView(heldAt(5000, 5000), 2160, offset, 2);

    expect(result.viewport.x).toBeGreaterThanOrEqual(offset.x - 1e-9);
    expect(result.viewport.y).toBeGreaterThanOrEqual(offset.y - 1e-9);
    expect(result.viewport.x + result.viewport.width).toBeLessThanOrEqual(
      offset.x + offset.width + 1e-9,
    );
    expect(result.viewport.y + result.viewport.height).toBeLessThanOrEqual(
      offset.y + offset.height + 1e-9,
    );
  });
});

describe("MouseFollowCamera — purity and determinism", () => {
  const events = [
    ev(0, 120, 100),
    ev(180, 700, 300),
    ev(360, 300, 500),
    ev(540, 600, 320),
    ev(720, 850, 250),
  ];

  it("returns the same view for a reversed event array", () => {
    const camera = new MouseFollowCamera();
    const forward = camera.computeSmoothedView(events, 900, base, 1.5);
    const reversed = camera.computeSmoothedView([...events].reverse(), 900, base, 1.5);

    expect(reversed).toEqual(forward);
  });

  it("is stable under random scrubbing", () => {
    const camera = new MouseFollowCamera();
    const at900 = camera.computeSmoothedView(events, 900, base, 1.5);

    camera.computeSmoothedView(events, 120, base, 1.5);
    camera.computeSmoothedView(events, 1500, base, 3);
    camera.computeSmoothedView(events, 400, base, 1.5);

    expect(camera.computeSmoothedView(events, 900, base, 1.5)).toEqual(at900);
  });

  it("keeps no mutable history between calls", () => {
    const camera = new MouseFollowCamera();
    const first = camera.computeSmoothedView([], 0, base, 1.5);
    camera.computeSmoothedView(heldAt(900, 550), 2160, base, 2);
    const again = camera.computeSmoothedView([], 0, base, 1.5);

    expect(again).toEqual(first);
  });

  it("does not mutate the caller's event array", () => {
    const camera = new MouseFollowCamera();
    const snapshot = JSON.stringify(events);
    camera.computeSmoothedView(events, 900, base, 1.5);

    expect(JSON.stringify(events)).toBe(snapshot);
  });

  it("does not mutate the base rect", () => {
    const camera = new MouseFollowCamera();
    const rect: Rect = { x: 10, y: 20, width: 500, height: 300 };
    camera.computeSmoothedView(events, 900, rect, 1.5);

    expect(rect).toEqual({ x: 10, y: 20, width: 500, height: 300 });
  });
});

describe("MouseFollowCamera — sanitizing events", () => {
  const good = heldAt(600, 320, 6);
  const time = 1080;

  function baseline(): { viewport: Rect; zoom: number } {
    return new MouseFollowCamera().computeSmoothedView(good, time, base, 1.5);
  }

  it("ignores events with non-finite values", () => {
    const camera = new MouseFollowCamera();
    const polluted: StagePointerEvent[] = [
      ...good,
      { timestampMs: NaN, pos: { x: 10, y: 10 }, type: "move" },
      { timestampMs: 500, pos: { x: NaN, y: 10 }, type: "move" },
      { timestampMs: 520, pos: { x: 10, y: Infinity }, type: "move" },
    ];

    expect(camera.computeSmoothedView(polluted, time, base, 1.5)).toEqual(baseline());
  });

  it("ignores events that have not happened yet", () => {
    const camera = new MouseFollowCamera();
    const withFuture: StagePointerEvent[] = [
      ...good,
      ev(time + 1, 0, 0),
      ev(time + 10_000, 0, 0),
    ];

    expect(camera.computeSmoothedView(withFuture, time, base, 1.5)).toEqual(baseline());
  });

  it("ignores events before time zero", () => {
    const camera = new MouseFollowCamera();
    const withNegative: StagePointerEvent[] = [...good, ev(-100, 0, 0), ev(-1, 1000, 600)];

    expect(camera.computeSmoothedView(withNegative, time, base, 1.5)).toEqual(baseline());
  });

  it("handles an event array that is entirely invalid", () => {
    const camera = new MouseFollowCamera();
    const result = camera.computeSmoothedView(
      [
        { timestampMs: NaN, pos: { x: NaN, y: NaN }, type: "move" },
        ev(-5, 1, 1),
      ],
      time,
      base,
      1.5,
    );

    expect(result.viewport).toEqual(centeredViewport(1.5));
  });
});

describe("MouseFollowCamera — rejecting invalid input", () => {
  const camera = new MouseFollowCamera();

  it.each([0.5, 0, -1, 0.999, NaN, Infinity, -Infinity])(
    "rejects a zoom factor of %s",
    (zoom) => {
      expect(() => camera.computeSmoothedView([], 100, base, zoom)).toThrow();
    },
  );

  it.each([-1, -0.001, NaN, Infinity, -Infinity])("rejects a frame time of %s", (time) => {
    expect(() => camera.computeSmoothedView([], time, base, 1.5)).toThrow();
  });

  it.each([
    ["zero width", { x: 0, y: 0, width: 0, height: 100 }],
    ["zero height", { x: 0, y: 0, width: 100, height: 0 }],
    ["negative width", { x: 0, y: 0, width: -100, height: 100 }],
    ["negative height", { x: 0, y: 0, width: 100, height: -100 }],
    ["NaN width", { x: 0, y: 0, width: NaN, height: 100 }],
    ["infinite height", { x: 0, y: 0, width: 100, height: Infinity }],
    ["NaN origin", { x: NaN, y: 0, width: 100, height: 100 }],
  ])("rejects a base rect with %s", (_label, rect) => {
    expect(() => camera.computeSmoothedView([], 100, rect as Rect, 1.5)).toThrow();
  });

  it("accepts zoom exactly 1 and a zero frame time", () => {
    expect(() => camera.computeSmoothedView([], 0, base, 1)).not.toThrow();
  });
});
