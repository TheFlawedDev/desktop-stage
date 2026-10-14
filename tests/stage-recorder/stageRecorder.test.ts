/**
 * `StageRecorder` — take lifecycle over an injected recording backend.
 *
 * The recorder owns state (`idle | starting | recording | stopping | disposed`),
 * a monotonic clock for durations, a wall clock for the manifest's start time,
 * and a pointer log that only accepts events while a take is recording. It must
 * reject overlapping starts and stops, reject a take that does not require web
 * audio to be muted, refuse to report success without real backend output, and
 * release the backend session on every exit path — including disposal while a
 * start is still in flight.
 */

import { describe, expect, it, vi } from "vitest";
import type { Rect, StageRecordingOptions, StageTakeManifest } from "@cutaway/types";
import { StageRecorder } from "../../packages/desktop-engine/src/stage/recorder/index";

const stageRect: Rect = { x: 0, y: 0, width: 1280, height: 720 };

function options(overrides: Partial<StageRecordingOptions> = {}): StageRecordingOptions {
  return { mode: "full", recordAudio: false, muteWebAudio: true, ...overrides };
}

interface BackendRequest {
  stageRect: Rect;
  recordingRect: Rect;
  recordAudio: boolean;
  onWarning: (message: string) => void;
}

interface BackendSession {
  finish: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSession(videoUri: string | null = "blob:take-video"): BackendSession {
  return {
    finish: vi.fn(async () => ({ videoUri: videoUri as unknown as string })),
    dispose: vi.fn(),
  };
}

function makeBackend(videoUri: string | null = "blob:take-video") {
  const requests: BackendRequest[] = [];
  const sessions: BackendSession[] = [];
  const start = vi.fn(async (request: BackendRequest) => {
    requests.push(request);
    const session = makeSession(videoUri);
    sessions.push(session);
    return session;
  });
  return { backend: { start }, start, requests, sessions };
}

interface RecorderHarness {
  recorder: StageRecorder;
  clock: ReturnType<typeof vi.fn>;
  wallClock: ReturnType<typeof vi.fn>;
  setClock: (value: number) => void;
  setWall: (value: number) => void;
}

function makeRecorder(
  backend: unknown,
  overrides: { makeTakeId?: () => string } = {},
): RecorderHarness {
  let nowMs = 0;
  let wallMs = 0;
  const clock = vi.fn(() => nowMs);
  const wallClock = vi.fn(() => wallMs);
  const makeTakeId = vi.fn(overrides.makeTakeId ?? (() => "take-1"));
  const recorder = new StageRecorder({
    stageRect,
    backend: backend as never,
    clock,
    wallClock,
    makeTakeId,
  });
  return {
    recorder,
    clock,
    wallClock,
    setClock: (value: number) => {
      nowMs = value;
    },
    setWall: (value: number) => {
      wallMs = value;
    },
  };
}

describe("StageRecorder — initial state", () => {
  it("starts idle with no warnings", () => {
    const h = makeRecorder(makeBackend().backend);
    expect(h.recorder.state).toBe("idle");
    expect(h.recorder.warnings).toEqual([]);
  });
});

describe("StageRecorder — start", () => {
  it("starts a full-desktop take and reports the recording state", async () => {
    const { backend, requests } = makeBackend();
    const h = makeRecorder(backend);

    const promise = h.recorder.start(options());
    expect(h.recorder.state).toBe("starting");
    await promise;

    expect(h.recorder.state).toBe("recording");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      stageRect,
      recordingRect: stageRect,
      recordAudio: false,
    });
    expect(typeof requests[0]!.onWarning).toBe("function");
  });

  it("passes a selected-area recording rect through", async () => {
    const selected: Rect = { x: 100, y: 50, width: 640, height: 360 };
    const { backend, requests } = makeBackend();
    const h = makeRecorder(backend);

    await h.recorder.start(options({ mode: "selected-area", selectedRect: selected }));

    expect(requests[0]!.recordingRect).toEqual(selected);
  });

  it("passes the recordAudio flag through", async () => {
    const { backend, requests } = makeBackend();
    const h = makeRecorder(backend);

    await h.recorder.start(options({ recordAudio: true }));
    expect(requests[0]!.recordAudio).toBe(true);
  });

  it("rejects a take that does not require web audio to be muted", async () => {
    const { backend, start } = makeBackend();
    const h = makeRecorder(backend);

    await expect(h.recorder.start(options({ muteWebAudio: false }))).rejects.toThrow();

    expect(start).not.toHaveBeenCalled();
    expect(h.recorder.state).toBe("idle");
  });

  it("does not start a second overlapping take", async () => {
    const { backend, start } = makeBackend();
    const h = makeRecorder(backend);

    await h.recorder.start(options());
    await expect(h.recorder.start(options())).rejects.toThrow();

    expect(start).toHaveBeenCalledTimes(1);
    expect(h.recorder.state).toBe("recording");
  });

  it("rejects start after disposal", async () => {
    const h = makeRecorder(makeBackend().backend);
    h.recorder.dispose();

    await expect(h.recorder.start(options())).rejects.toThrow();
    expect(h.recorder.state).toBe("disposed");
  });

  it("resets to idle and allows a retry when the backend start fails", async () => {
    const { backend, start } = makeBackend();
    start.mockRejectedValueOnce(new Error("capture denied"));
    const h = makeRecorder(backend);

    await expect(h.recorder.start(options())).rejects.toThrow();
    expect(h.recorder.state).toBe("idle");

    await h.recorder.start(options());
    expect(h.recorder.state).toBe("recording");
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("is idle again after a successful stop", async () => {
    const { backend } = makeBackend();
    const h = makeRecorder(backend);

    await h.recorder.start(options());
    await h.recorder.stop();

    expect(h.recorder.state).toBe("idle");
  });
});

describe("StageRecorder — stop", () => {
  it("rejects stop before any take has started", async () => {
    const { backend, sessions } = makeBackend();
    const h = makeRecorder(backend);

    await expect(h.recorder.stop()).rejects.toThrow();
    expect(sessions).toHaveLength(0);
  });

  it("rejects stop after disposal", async () => {
    const h = makeRecorder(makeBackend().backend);
    h.recorder.dispose();
    await expect(h.recorder.stop()).rejects.toThrow();
  });

  it("builds a manifest from the backend output and the start wall clock", async () => {
    const { backend, sessions } = makeBackend("blob:take-video");
    const h = makeRecorder(backend);
    h.setClock(1000);
    h.setWall(5000);

    await h.recorder.start(options());
    h.setClock(1450);
    const manifest = await h.recorder.stop();

    expect(manifest.takeId).toBe("take-1");
    expect(manifest.videoUri).toBe("blob:take-video");
    expect(manifest.durationMs).toBe(450);
    expect(manifest.createdAt).toBe(5000);
    expect(manifest.recordingRect).toEqual(stageRect);
    expect(manifest.trackMouseEnabled).toBe(false);
    expect(manifest.pointerEvents).toEqual([]);
    expect(sessions[0]!.dispose).toHaveBeenCalled();
  });

  it("records pointer events relative to the take start", async () => {
    const { backend } = makeBackend();
    const h = makeRecorder(backend);
    h.setClock(1000);

    await h.recorder.start(options());
    h.recorder.recordPointer({ timestampMs: 1200, pos: { x: 10, y: 20 }, type: "move" });
    h.setClock(1450);
    const manifest = await h.recorder.stop();

    expect(manifest.pointerEvents).toEqual([
      { timestampMs: 200, pos: { x: 10, y: 20 }, type: "move" },
    ]);
  });

  it("freezes the duration before the async finalize can change the clock", async () => {
    const { backend, sessions } = makeBackend();
    const h = makeRecorder(backend);
    h.setClock(1000);

    await h.recorder.start(options());
    h.setClock(1450);
    sessions[0]!.finish.mockImplementationOnce(async () => {
      h.setClock(9_999_999);
      return { videoUri: "blob:take-video" };
    });

    const manifest = await h.recorder.stop();
    expect(manifest.durationMs).toBe(450);
  });

  it("reports the selected recording rect in the manifest", async () => {
    const selected: Rect = { x: 20, y: 30, width: 200, height: 100 };
    const { backend } = makeBackend();
    const h = makeRecorder(backend);

    await h.recorder.start(options({ mode: "selected-area", selectedRect: selected }));
    const manifest = await h.recorder.stop();

    expect(manifest.recordingRect).toEqual(selected);
  });

  it("rejects a second stop while the first is finalizing", async () => {
    const { backend, sessions } = makeBackend();
    const h = makeRecorder(backend);
    await h.recorder.start(options());

    const gate = deferred<{ videoUri: string }>();
    sessions[0]!.finish.mockReturnValueOnce(gate.promise);

    const stopping = h.recorder.stop();
    expect(h.recorder.state).toBe("stopping");

    await expect(h.recorder.stop()).rejects.toThrow();
    await expect(h.recorder.start(options())).rejects.toThrow();

    gate.resolve({ videoUri: "blob:take-video" });
    await stopping;
    expect(h.recorder.state).toBe("idle");
  });

  it("rejects stop while a start is still in flight", async () => {
    const gate = deferred<BackendSession>();
    const backend = { start: vi.fn(() => gate.promise) };
    const h = makeRecorder(backend);

    const starting = h.recorder.start(options());
    await expect(h.recorder.stop()).rejects.toThrow();

    gate.resolve(makeSession());
    await starting;
    expect(h.recorder.state).toBe("recording");
  });

  it("resets to idle, releases the session, and allows a retry when finalize fails", async () => {
    const { backend, sessions } = makeBackend();
    const h = makeRecorder(backend);
    await h.recorder.start(options());

    sessions[0]!.finish.mockRejectedValueOnce(new Error("encoder failed"));
    await expect(h.recorder.stop()).rejects.toThrow();

    expect(h.recorder.state).toBe("idle");
    expect(sessions[0]!.dispose).toHaveBeenCalled();
    await h.recorder.start(options());
    expect(h.recorder.state).toBe("recording");
  });

  it.each([
    ["an empty video URI", ""],
    ["a missing video URI", null],
  ])("refuses to report success with %s", async (_label, videoUri) => {
    const { backend, sessions } = makeBackend(videoUri);
    const h = makeRecorder(backend);
    await h.recorder.start(options());

    await expect(h.recorder.stop()).rejects.toThrow();
    expect(h.recorder.state).toBe("idle");
    expect(sessions[0]!.dispose).toHaveBeenCalled();
  });

  it("refuses a finalize result with no video URI property", async () => {
    const { backend, sessions } = makeBackend();
    const h = makeRecorder(backend);
    await h.recorder.start(options());
    sessions[0]!.finish.mockResolvedValueOnce({});

    await expect(h.recorder.stop()).rejects.toThrow();
    expect(h.recorder.state).toBe("idle");
  });
});

describe("StageRecorder — pointer recording window", () => {
  it("ignores pointer events before a take starts", async () => {
    const { backend } = makeBackend();
    const h = makeRecorder(backend);

    h.recorder.recordPointer({ timestampMs: 100, pos: { x: 1, y: 1 }, type: "move" });
    await h.recorder.start(options());
    h.setClock(200);
    const manifest = await h.recorder.stop();

    expect(manifest.pointerEvents).toEqual([]);
  });

  it("ignores pointer events after a take stops", async () => {
    const { backend } = makeBackend();
    const h = makeRecorder(backend);

    await h.recorder.start(options());
    await h.recorder.stop();
    h.recorder.recordPointer({ timestampMs: 300, pos: { x: 1, y: 1 }, type: "move" });

    await h.recorder.start(options());
    h.setClock(400);
    const manifest = await h.recorder.stop();
    expect(manifest.pointerEvents).toEqual([]);
  });

  it("ignores pointer events while a start is pending", async () => {
    const gate = deferred<BackendSession>();
    const backend = { start: vi.fn(() => gate.promise) };
    const h = makeRecorder(backend);

    const starting = h.recorder.start(options());
    h.recorder.recordPointer({ timestampMs: 10, pos: { x: 1, y: 1 }, type: "move" });
    gate.resolve(makeSession());
    await starting;

    h.setClock(100);
    const manifest = await h.recorder.stop();
    expect(manifest.pointerEvents).toEqual([]);
  });

  it("ignores pointer events while a stop is finalizing", async () => {
    const { backend, sessions } = makeBackend();
    const h = makeRecorder(backend);
    await h.recorder.start(options());

    const gate = deferred<{ videoUri: string }>();
    sessions[0]!.finish.mockReturnValueOnce(gate.promise);
    const stopping = h.recorder.stop();

    h.recorder.recordPointer({ timestampMs: 1234, pos: { x: 5, y: 5 }, type: "move" });
    gate.resolve({ videoUri: "blob:take-video" });
    const manifest = await stopping;

    expect(manifest.pointerEvents).toEqual([]);
  });

  it("ignores pointer events outside the recording rect", async () => {
    const selected: Rect = { x: 100, y: 100, width: 200, height: 200 };
    const { backend } = makeBackend();
    const h = makeRecorder(backend);
    h.setClock(1000);

    await h.recorder.start(options({ mode: "selected-area", selectedRect: selected }));
    h.recorder.recordPointer({ timestampMs: 1100, pos: { x: 50, y: 50 }, type: "move" });
    h.recorder.recordPointer({ timestampMs: 1150, pos: { x: 150, y: 150 }, type: "move" });
    h.setClock(1200);
    const manifest = await h.recorder.stop();

    expect(manifest.pointerEvents).toEqual([
      { timestampMs: 150, pos: { x: 150, y: 150 }, type: "move" },
    ]);
  });

  it("takes a defensive copy of recorded pointer events", async () => {
    const { backend } = makeBackend();
    const h = makeRecorder(backend);
    h.setClock(1000);

    await h.recorder.start(options());
    const input = { timestampMs: 1200, pos: { x: 10, y: 20 }, type: "move" as const };
    h.recorder.recordPointer(input);
    input.pos.x = 999;
    input.timestampMs = 99999;
    h.setClock(1300);
    const manifest = await h.recorder.stop();

    expect(manifest.pointerEvents).toEqual([
      { timestampMs: 200, pos: { x: 10, y: 20 }, type: "move" },
    ]);
  });
});

describe("StageRecorder — warnings", () => {
  it("collects backend warnings and returns a copy", async () => {
    const { backend, requests } = makeBackend();
    const h = makeRecorder(backend);
    await h.recorder.start(options());

    requests[0]!.onWarning("microphone denied");
    requests[0]!.onWarning("player audio unavailable");

    expect(h.recorder.warnings).toEqual(["microphone denied", "player audio unavailable"]);

    const copy = h.recorder.warnings;
    copy.push("tampered");
    copy.length = 0;
    expect(h.recorder.warnings).toEqual(["microphone denied", "player audio unavailable"]);
  });
});

describe("StageRecorder — sequential takes", () => {
  it("supports independent consecutive takes", async () => {
    const { backend, requests, sessions } = makeBackend();
    let counter = 0;
    const h = makeRecorder(backend, { makeTakeId: () => `take-${++counter}` });

    h.setClock(0);
    h.setWall(100);
    await h.recorder.start(options());
    h.recorder.recordPointer({ timestampMs: 10, pos: { x: 1, y: 1 }, type: "move" });
    const first = await h.recorder.stop();

    h.setClock(1000);
    h.setWall(200);
    await h.recorder.start(options());
    const second = await h.recorder.stop();

    expect(first.takeId).toBe("take-1");
    expect(second.takeId).toBe("take-2");
    expect(first.pointerEvents).toHaveLength(1);
    expect(second.pointerEvents).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(sessions[0]!.dispose).toHaveBeenCalled();
    expect(sessions[1]!.dispose).toHaveBeenCalled();
  });

  it("generates a take id and clocks by default", async () => {
    const { backend } = makeBackend();
    const recorder = new StageRecorder({ stageRect, backend: backend as never });

    await recorder.start(options());
    const manifest: StageTakeManifest = await recorder.stop();

    expect(typeof manifest.takeId).toBe("string");
    expect(manifest.takeId.length).toBeGreaterThan(0);
    expect(manifest.createdAt).toBeGreaterThan(0);
    expect(manifest.durationMs).toBeGreaterThanOrEqual(0);
    expect(manifest.videoUri).toBe("blob:take-video");
  });
});

describe("StageRecorder — dispose", () => {
  it("releases the active session and blocks later work", async () => {
    const { backend, sessions } = makeBackend();
    const h = makeRecorder(backend);
    await h.recorder.start(options());

    h.recorder.dispose();

    expect(h.recorder.state).toBe("disposed");
    expect(sessions[0]!.dispose).toHaveBeenCalled();
    await expect(h.recorder.start(options())).rejects.toThrow();
    await expect(h.recorder.stop()).rejects.toThrow();
  });

  it("disposes from idle without starting a session", () => {
    const { backend, start } = makeBackend();
    const h = makeRecorder(backend);

    h.recorder.dispose();

    expect(h.recorder.state).toBe("disposed");
    expect(start).not.toHaveBeenCalled();
  });

  it("is idempotent", async () => {
    const { backend, sessions } = makeBackend();
    const h = makeRecorder(backend);
    await h.recorder.start(options());

    expect(() => {
      h.recorder.dispose();
      h.recorder.dispose();
    }).not.toThrow();
    expect(h.recorder.state).toBe("disposed");
    expect(sessions[0]!.dispose).toHaveBeenCalled();
  });

  it("releases a session that resolves after disposal without leaking it", async () => {
    const gate = deferred<BackendSession>();
    const session = makeSession();
    const backend = { start: vi.fn(() => gate.promise) };
    const h = makeRecorder(backend);

    const starting = h.recorder.start(options());
    expect(h.recorder.state).toBe("starting");

    h.recorder.dispose();
    expect(h.recorder.state).toBe("disposed");

    gate.resolve(session);
    await starting.catch(() => {});

    expect(session.dispose).toHaveBeenCalled();
    expect(h.recorder.state).toBe("disposed");
    await expect(h.recorder.stop()).rejects.toThrow();
  });

  it("does not record pointer events after disposal", async () => {
    const { backend } = makeBackend();
    const h = makeRecorder(backend);
    await h.recorder.start(options());
    h.recorder.dispose();

    expect(() =>
      h.recorder.recordPointer({ timestampMs: 100, pos: { x: 1, y: 1 }, type: "move" }),
    ).not.toThrow();
  });
});
