/**
 * `resolveRecordingRect` — the recording rectangle for a take.
 *
 * Full-desktop mode echoes the stage rectangle as a defensive copy. Selected
 * mode accepts only a finite, positive rectangle that lies wholly inside the
 * stage. A missing, zero-sized, non-finite, or partially outside selection is
 * an error rather than a silent clamp, and the caller's objects are never
 * retained.
 */

import { describe, expect, it } from "vitest";
import type { Rect, StageRecordingOptions } from "@cutaway/types";
import { resolveRecordingRect } from "../../packages/desktop-engine/src/stage/recorder/index";

const stage: Rect = { x: 10, y: 20, width: 800, height: 600 };

function options(overrides: Partial<StageRecordingOptions> = {}): StageRecordingOptions {
  return { mode: "full", recordAudio: false, muteWebAudio: true, ...overrides };
}

describe("resolveRecordingRect — full desktop", () => {
  it("returns the whole stage rectangle", () => {
    expect(resolveRecordingRect(stage, options())).toEqual(stage);
  });

  it("returns a defensive copy, not the stage object", () => {
    const result = resolveRecordingRect(stage, options());
    expect(result).not.toBe(stage);

    result.x = 9999;
    result.width = 1;
    expect(stage).toEqual({ x: 10, y: 20, width: 800, height: 600 });
    expect(resolveRecordingRect(stage, options())).toEqual(stage);
  });

  it("preserves a non-zero stage origin", () => {
    const offset: Rect = { x: -40, y: 12, width: 300, height: 200 };
    expect(resolveRecordingRect(offset, options())).toEqual(offset);
  });

  it("ignores a selected rect when the mode is full", () => {
    const result = resolveRecordingRect(
      stage,
      options({ selectedRect: { x: -100, y: -100, width: 5, height: 5 } }),
    );
    expect(result).toEqual(stage);
  });

  it.each([
    ["zero width", { x: 0, y: 0, width: 0, height: 10 }],
    ["negative width", { x: 0, y: 0, width: -5, height: 10 }],
    ["zero height", { x: 0, y: 0, width: 10, height: 0 }],
    ["NaN width", { x: 0, y: 0, width: NaN, height: 10 }],
    ["infinite height", { x: 0, y: 0, width: 10, height: Infinity }],
    ["NaN origin", { x: NaN, y: 0, width: 10, height: 10 }],
  ])("rejects a stage with %s", (_label, bad) => {
    expect(() => resolveRecordingRect(bad as Rect, options())).toThrow();
  });
});

describe("resolveRecordingRect — selected area", () => {
  const selected: Rect = { x: 100, y: 120, width: 320, height: 240 };

  it("returns the selected rectangle", () => {
    const result = resolveRecordingRect(
      stage,
      options({ mode: "selected-area", selectedRect: selected }),
    );
    expect(result).toEqual(selected);
  });

  it("returns a copy rather than the caller's selected rect", () => {
    const result = resolveRecordingRect(
      stage,
      options({ mode: "selected-area", selectedRect: selected }),
    );
    expect(result).not.toBe(selected);
    result.width = 1;
    expect(selected.width).toBe(320);
  });

  it("accepts a selection flush with every stage edge", () => {
    const flush: Rect = { x: 10, y: 20, width: 800, height: 600 };
    expect(resolveRecordingRect(stage, options({ mode: "selected-area", selectedRect: flush }))).toEqual(
      flush,
    );
  });

  it("accepts a selection occupying the entire stage exactly", () => {
    expect(
      resolveRecordingRect(stage, options({ mode: "selected-area", selectedRect: { ...stage } })),
    ).toEqual(stage);
  });

  it("requires a selected rect", () => {
    expect(() => resolveRecordingRect(stage, options({ mode: "selected-area" }))).toThrow();
  });

  it.each([
    ["left of the stage", { x: 9, y: 120, width: 100, height: 100 }],
    ["above the stage", { x: 100, y: 19, width: 100, height: 100 }],
    ["past the right edge", { x: 700, y: 120, width: 200, height: 100 }],
    ["past the bottom edge", { x: 100, y: 500, width: 100, height: 200 }],
    ["negative origin", { x: -50, y: -50, width: 100, height: 100 }],
    ["partially overlapping", { x: 0, y: 0, width: 20, height: 20 }],
  ])("rejects a selection %s", (_label, bad) => {
    expect(() =>
      resolveRecordingRect(stage, options({ mode: "selected-area", selectedRect: bad as Rect })),
    ).toThrow();
  });

  it.each([
    ["zero width", { x: 100, y: 120, width: 0, height: 100 }],
    ["zero height", { x: 100, y: 120, width: 100, height: 0 }],
    ["negative width", { x: 100, y: 120, width: -10, height: 100 }],
    ["negative height", { x: 100, y: 120, width: 100, height: -10 }],
    ["NaN width", { x: 100, y: 120, width: NaN, height: 100 }],
    ["Infinity height", { x: 100, y: 120, width: 100, height: Infinity }],
    ["NaN origin", { x: NaN, y: 120, width: 100, height: 100 }],
    ["infinite origin", { x: Infinity, y: 120, width: 100, height: 100 }],
  ])("rejects a selection with %s", (_label, bad) => {
    expect(() =>
      resolveRecordingRect(stage, options({ mode: "selected-area", selectedRect: bad as Rect })),
    ).toThrow();
  });

  it("validates the stage even when the selection is valid", () => {
    expect(() =>
      resolveRecordingRect({ x: 0, y: 0, width: 0, height: 100 }, {
        mode: "selected-area",
        selectedRect: { x: 0, y: 0, width: 0, height: 0 },
        recordAudio: false,
        muteWebAudio: true,
      }),
    ).toThrow();
  });
});
