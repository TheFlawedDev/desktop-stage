/**
 * `PointerLogger` — relative, ordered, in-bounds pointer metadata.
 *
 * Input timestamps are absolute values read from a monotonic clock; the log
 * stores them relative to the moment recording started. Events that predate the
 * start, move backwards in time, contain non-finite values, or fall outside the
 * recording rectangle (right and bottom edges exclusive) are dropped. Equal
 * timestamps are kept. Every value handed back is a copy.
 */

import { describe, expect, it } from "vitest";
import type { StagePointerEvent } from "@cutaway/types";
import { PointerLogger } from "../../packages/desktop-engine/src/stage/recorder/index";

const RECT = { x: 100, y: 200, width: 400, height: 300 };
const STARTED_AT = 1000;

function makeLogger(): PointerLogger {
  return new PointerLogger({ recordingRect: RECT, startedAtMs: STARTED_AT });
}

function event(overrides: Partial<StagePointerEvent> = {}): StagePointerEvent {
  return { timestampMs: STARTED_AT, pos: { x: 150, y: 250 }, type: "move", ...overrides };
}

describe("PointerLogger — relative timestamps", () => {
  it("starts empty", () => {
    expect(makeLogger().getEvents()).toEqual([]);
  });

  it("subtracts the start time from each event", () => {
    const logger = makeLogger();
    logger.record(event({ timestampMs: 1250 }));

    expect(logger.getEvents()).toEqual([
      { timestampMs: 250, pos: { x: 150, y: 250 }, type: "move" },
    ]);
  });

  it("accepts an event exactly at the start time with a zero offset", () => {
    const logger = makeLogger();
    logger.record(event({ timestampMs: STARTED_AT }));

    expect(logger.getEvents()).toHaveLength(1);
    expect(logger.getEvents()[0]!.timestampMs).toBe(0);
  });

  it("drops events that predate the start", () => {
    const logger = makeLogger();
    logger.record(event({ timestampMs: STARTED_AT - 1 }));
    logger.record(event({ timestampMs: 0 }));

    expect(logger.getEvents()).toEqual([]);
  });

  it("keeps the order of accepted events", () => {
    const logger = makeLogger();
    logger.record(event({ timestampMs: 1100, type: "down" }));
    logger.record(event({ timestampMs: 1200, type: "move" }));
    logger.record(event({ timestampMs: 1300, type: "up" }));

    expect(logger.getEvents().map((e: StagePointerEvent) => e.type)).toEqual(["down", "move", "up"]);
    expect(logger.getEvents().map((e: StagePointerEvent) => e.timestampMs)).toEqual([100, 200, 300]);
  });

  it("allows equal timestamps", () => {
    const logger = makeLogger();
    logger.record(event({ timestampMs: 1200, type: "move" }));
    logger.record(event({ timestampMs: 1200, type: "click" }));

    const events = logger.getEvents();
    expect(events).toHaveLength(2);
    expect(events.map((e: StagePointerEvent) => e.type)).toEqual(["move", "click"]);
    expect(events.map((e: StagePointerEvent) => e.timestampMs)).toEqual([200, 200]);
  });

  it("drops events that move backwards in time", () => {
    const logger = makeLogger();
    logger.record(event({ timestampMs: 1200 }));
    logger.record(event({ timestampMs: 1150 }));
    logger.record(event({ timestampMs: 1199 }));

    expect(logger.getEvents()).toHaveLength(1);
    expect(logger.getEvents()[0]!.timestampMs).toBe(200);
  });

  it("still accepts forward events after a dropped backwards event", () => {
    const logger = makeLogger();
    logger.record(event({ timestampMs: 1200 }));
    logger.record(event({ timestampMs: 1100 }));
    logger.record(event({ timestampMs: 1300 }));

    expect(logger.getEvents().map((e: StagePointerEvent) => e.timestampMs)).toEqual([200, 300]);
  });
});

describe("PointerLogger — invalid and non-finite input", () => {
  it.each([
    ["NaN timestamp", { timestampMs: NaN }],
    ["infinite timestamp", { timestampMs: Infinity }],
    ["negative-infinite timestamp", { timestampMs: -Infinity }],
    ["NaN x", { pos: { x: NaN, y: 250 } }],
    ["NaN y", { pos: { x: 150, y: NaN } }],
    ["infinite x", { pos: { x: Infinity, y: 250 } }],
  ])("drops an event with %s", (_label, overrides) => {
    const logger = makeLogger();
    logger.record(event(overrides));
    expect(logger.getEvents()).toEqual([]);
  });

  it("drops a record with no usable fields", () => {
    const logger = makeLogger();
    logger.record({} as StagePointerEvent);
    logger.record(undefined as unknown as StagePointerEvent);
    expect(logger.getEvents()).toEqual([]);
  });
});

describe("PointerLogger — recording rect bounds", () => {
  it("accepts the top-left corner", () => {
    const logger = makeLogger();
    logger.record(event({ pos: { x: 100, y: 200 } }));
    expect(logger.getEvents()).toHaveLength(1);
  });

  it("accepts the last pixel inside the exclusive edges", () => {
    const logger = makeLogger();
    logger.record(event({ pos: { x: 499, y: 499 } }));
    expect(logger.getEvents()).toHaveLength(1);
  });

  it.each([
    ["left", { x: 99, y: 250 }],
    ["above", { x: 150, y: 199 }],
    ["right edge (exclusive)", { x: 500, y: 250 }],
    ["bottom edge (exclusive)", { x: 150, y: 500 }],
    ["far outside", { x: -1000, y: -1000 }],
  ])("drops an event %s of the recording rect", (_label, pos) => {
    const logger = makeLogger();
    logger.record(event({ pos }));
    expect(logger.getEvents()).toEqual([]);
  });
});

describe("PointerLogger — defensive copies", () => {
  it("does not retain the caller's event object", () => {
    const logger = makeLogger();
    const input = event({ timestampMs: 1200, targetWindowId: "win-1" });
    logger.record(input);

    input.pos.x = 9999;
    input.pos.y = 9999;
    input.type = "drag";
    input.timestampMs = 99999;
    input.targetWindowId = "win-changed";

    expect(logger.getEvents()).toEqual([
      { timestampMs: 200, pos: { x: 150, y: 250 }, type: "move", targetWindowId: "win-1" },
    ]);
  });

  it("returns a fresh array each call", () => {
    const logger = makeLogger();
    logger.record(event({ timestampMs: 1200 }));

    const first = logger.getEvents();
    first.push(event({ timestampMs: 1300 }));
    first.length = 0;

    expect(logger.getEvents()).toHaveLength(1);
  });

  it("returns fresh event objects each call", () => {
    const logger = makeLogger();
    logger.record(event({ timestampMs: 1200 }));

    const first = logger.getEvents();
    first[0]!.pos.x = -1;
    first[0]!.type = "click";

    const second = logger.getEvents();
    expect(second[0]!.pos).toEqual({ x: 150, y: 250 });
    expect(second[0]!.type).toBe("move");
  });
});
