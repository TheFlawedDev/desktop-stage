/**
 * `cropStageFrame` — one crop-and-blit of the captured stage frame.
 *
 * The recording rectangle is expressed in stage coordinates and must be mapped
 * through the source-to-stage scale before it reaches `drawImage`. The crop is
 * drawn at the origin of the output with the recording rectangle's own width and
 * height, so nothing outside the selection reaches the encoder. Finite,
 * positive dimensions and a selection inside the stage are required.
 */

import { describe, expect, it, vi } from "vitest";
import type { Rect, Size } from "@cutaway/types";
import { cropStageFrame } from "../../packages/desktop-engine/src/stage/recorder/index";

interface DrawContext {
  drawImage: (...args: unknown[]) => void;
  calls: unknown[][];
}

function makeContext(): DrawContext {
  const calls: unknown[][] = [];
  return {
    calls,
    drawImage: (...args: unknown[]) => {
      calls.push(args);
    },
  };
}

describe("cropStageFrame — coordinate mapping", () => {
  it("scales a crop into source pixels and draws it at the output origin", () => {
    const ctx = makeContext();
    const source = { id: "frame" };
    const stage: Rect = { x: 0, y: 0, width: 100, height: 50 };
    const sourceSize: Size = { width: 200, height: 100 };
    const recording: Rect = { x: 10, y: 5, width: 30, height: 20 };

    cropStageFrame(ctx, source, sourceSize, stage, recording);

    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]).toEqual([source, 20, 10, 60, 40, 0, 0, 30, 20]);
  });

  it("applies independent horizontal and vertical scales", () => {
    const ctx = makeContext();
    const source = {};
    const stage: Rect = { x: 0, y: 0, width: 100, height: 50 };
    const sourceSize: Size = { width: 300, height: 100 };
    const recording: Rect = { x: 10, y: 5, width: 30, height: 20 };

    cropStageFrame(ctx, source, sourceSize, stage, recording);

    // scaleX = 3, scaleY = 2
    expect(ctx.calls[0]).toEqual([source, 30, 10, 90, 40, 0, 0, 30, 20]);
  });

  it("treats the source as aligned to the stage rect's origin", () => {
    const ctx = makeContext();
    const stage: Rect = { x: 50, y: 100, width: 100, height: 50 };
    const sourceSize: Size = { width: 200, height: 100 };
    const recording: Rect = { x: 60, y: 120, width: 30, height: 20 };

    cropStageFrame(ctx, "source", sourceSize, stage, recording);

    // (60 - 50) * 2 = 20, (120 - 100) * 2 = 40, 30 * 2 = 60, 20 * 2 = 40
    expect(ctx.calls[0]).toEqual(["source", 20, 40, 60, 40, 0, 0, 30, 20]);
  });

  it("is the identity map when the source matches the stage", () => {
    const ctx = makeContext();
    const stage: Rect = { x: 5, y: 7, width: 640, height: 480 };
    const recording: Rect = { x: 105, y: 107, width: 200, height: 150 };

    cropStageFrame(ctx, "src", { width: 640, height: 480 }, stage, recording);

    expect(ctx.calls[0]).toEqual(["src", 100, 100, 200, 150, 0, 0, 200, 150]);
  });

  it("draws exactly once", () => {
    const ctx = makeContext();
    cropStageFrame(
      ctx,
      "src",
      { width: 10, height: 10 },
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 1, y: 1, width: 2, height: 2 },
    );
    expect(ctx.calls).toHaveLength(1);
  });
});

describe("cropStageFrame — validation", () => {
  const stage: Rect = { x: 0, y: 0, width: 100, height: 100 };
  const recording: Rect = { x: 10, y: 10, width: 20, height: 20 };

  it.each([
    ["zero width", { width: 0, height: 100 }],
    ["zero height", { width: 100, height: 0 }],
    ["negative width", { width: -10, height: 100 }],
    ["NaN width", { width: NaN, height: 100 }],
    ["infinite height", { width: 100, height: Infinity }],
  ])("rejects a source size with %s", (_label, bad) => {
    const ctx = makeContext();
    expect(() =>
      cropStageFrame(ctx, "src", bad as Size, stage, recording),
    ).toThrow();
    expect(ctx.calls).toHaveLength(0);
  });

  it.each([
    ["zero width", { x: 0, y: 0, width: 0, height: 100 }],
    ["negative height", { x: 0, y: 0, width: 100, height: -1 }],
    ["NaN width", { x: 0, y: 0, width: NaN, height: 100 }],
    ["infinite origin", { x: Infinity, y: 0, width: 100, height: 100 }],
  ])("rejects a stage rect with %s", (_label, bad) => {
    const ctx = makeContext();
    expect(() =>
      cropStageFrame(ctx, "src", { width: 100, height: 100 }, bad as Rect, recording),
    ).toThrow();
    expect(ctx.calls).toHaveLength(0);
  });

  it.each([
    ["zero width", { x: 10, y: 10, width: 0, height: 20 }],
    ["zero height", { x: 10, y: 10, width: 20, height: 0 }],
    ["negative width", { x: 10, y: 10, width: -1, height: 20 }],
    ["NaN origin", { x: NaN, y: 10, width: 20, height: 20 }],
    ["infinite width", { x: 10, y: 10, width: Infinity, height: 20 }],
  ])("rejects a recording rect with %s", (_label, bad) => {
    const ctx = makeContext();
    expect(() =>
      cropStageFrame(ctx, "src", { width: 100, height: 100 }, stage, bad as Rect),
    ).toThrow();
    expect(ctx.calls).toHaveLength(0);
  });

  it.each([
    ["left of the stage", { x: -1, y: 10, width: 20, height: 20 }],
    ["above the stage", { x: 10, y: -1, width: 20, height: 20 }],
    ["past the right edge", { x: 90, y: 10, width: 20, height: 20 }],
    ["past the bottom edge", { x: 10, y: 90, width: 20, height: 20 }],
    ["entirely outside", { x: 200, y: 200, width: 20, height: 20 }],
  ])("rejects a recording rect %s", (_label, bad) => {
    const ctx = makeContext();
    expect(() =>
      cropStageFrame(ctx, "src", { width: 100, height: 100 }, stage, bad as Rect),
    ).toThrow();
    expect(ctx.calls).toHaveLength(0);
  });

  it("accepts a recording rect flush with the stage edges", () => {
    const ctx = makeContext();
    cropStageFrame(ctx, "src", { width: 100, height: 100 }, stage, {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(ctx.calls).toHaveLength(1);
  });

  it("never calls drawImage when the draw function itself is recorded", () => {
    const drawImage = vi.fn();
    cropStageFrame({ drawImage }, "src", { width: 100, height: 100 }, stage, recording);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });
});
