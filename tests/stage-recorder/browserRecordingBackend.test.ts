/**
 * `createBrowserRecordingBackend` — the real browser capture pipeline.
 *
 * These tests run in jsdom because the adapter is defined by the browser media
 * APIs it drives: `getDisplayMedia`, a `<video>` fed by the stage stream, a
 * canvas cropped with `cropStageFrame`, `canvas.captureStream`, `MediaRecorder`,
 * and `AudioContext`. Everything is mocked, so this is not an OS smoke test; it
 * pins the adapter's contract:
 *
 * - the encoder only ever sees the cropped canvas video, never screen audio;
 * - audio is mixed through an `AudioContext` destination only when requested;
 * - a denied microphone warns and leaves the take usable;
 * - web audio is muted during the take and restored on every exit path;
 * - cleanup stops owned tracks and contexts but never borrowed player tracks;
 * - a failed setup saves nothing and leaves no mute behind;
 * - `frameRate` is a positive integer in 1..120 and defaults to 30.
 */

/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rect } from "@cutaway/types";
import { createBrowserRecordingBackend } from "../../packages/desktop-engine/src/stage/recorder/index";

// ---------------------------------------------------------------------------
// Fake media primitives
// ---------------------------------------------------------------------------

class FakeTrack {
  stop = vi.fn();
  enabled = true;

  constructor(
    public readonly kind: "video" | "audio",
    public readonly id: string,
    private readonly settings: Record<string, unknown> = {},
  ) {}

  getSettings(): Record<string, unknown> {
    return { ...this.settings };
  }
}

class FakeStream {
  active = true;
  readonly id: string;
  private tracks: FakeTrack[];

  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
    this.id = `stream-${++streamCounter}`;
  }

  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getTrackById(id: string): FakeTrack | null {
    return this.tracks.find((track) => track.id === id) ?? null;
  }

  addTrack(track: FakeTrack): void {
    if (!this.tracks.includes(track)) this.tracks.push(track);
  }

  removeTrack(track: FakeTrack): void {
    this.tracks = this.tracks.filter((candidate) => candidate !== track);
  }

  clone(): FakeStream {
    return new FakeStream(this.tracks);
  }
}

let streamCounter = 0;

type Listener = (event: unknown) => void;

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);

  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: Listener | null = null;
  onstop: Listener | null = null;
  onerror: Listener | null = null;
  onstart: Listener | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(
    public readonly stream: FakeStream,
    public readonly options?: unknown,
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: string, event: unknown): void {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }

  start(): void {
    this.state = "recording";
    const event = { type: "start" };
    this.onstart?.(event);
    this.emit("start", event);
  }

  stop(): void {
    if (this.state === "inactive") return;
    this.state = "inactive";
    const dataEvent = { data: new Blob(["fake-video-bytes"], { type: "video/webm" }) };
    this.ondataavailable?.(dataEvent);
    this.emit("dataavailable", dataEvent);
    const stopEvent = { type: "stop" };
    this.onstop?.(stopEvent);
    this.emit("stop", stopEvent);
  }

  pause(): void {
    this.state = "paused";
  }

  resume(): void {
    this.state = "recording";
  }

  requestData(): void {
    const event = { data: new Blob(["more-bytes"], { type: "video/webm" }) };
    this.ondataavailable?.(event);
    this.emit("dataavailable", event);
  }
}

class FakeAudioNode {
  connections: unknown[] = [];
  gain = { value: 1 };
  connect = vi.fn((destination: unknown) => {
    this.connections.push(destination);
    return destination;
  });
  disconnect = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: "running" | "suspended" | "closed" = "running";
  destination = new FakeAudioNode();
  sampleRate = 48_000;

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createMediaStreamSource = vi.fn((_stream: unknown) => new FakeAudioNode());
  createMediaStreamDestination = vi.fn(() => {
    const node = new FakeAudioNode() as FakeAudioNode & { stream: FakeStream };
    node.stream = new FakeStream([new FakeTrack("audio", "mixed-audio")]);
    return node;
  });
  createGain = vi.fn(() => new FakeAudioNode());
  createMediaStreamTrackSource = vi.fn(() => new FakeAudioNode());
  resume = vi.fn(async () => {});
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });
  close = vi.fn(async () => {
    this.state = "closed";
  });
}

class FakeContext2D {
  drawImage = vi.fn();
  clearRect = vi.fn();
  fillRect = vi.fn();
  save = vi.fn();
  restore = vi.fn();
  scale = vi.fn();
  translate = vi.fn();
  setTransform = vi.fn();
  resetTransform = vi.fn();
  beginPath = vi.fn();
  closePath = vi.fn();
  clip = vi.fn();
  getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }));
  putImageData = vi.fn();
}

const contexts = new Map<HTMLCanvasElement, FakeContext2D>();
const canvasStreams: FakeStream[] = [];
const captureFps: number[] = [];

// ---------------------------------------------------------------------------
// DOM overrides
// ---------------------------------------------------------------------------

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  writable: true,
  value: function (this: HTMLCanvasElement, kind: string): FakeContext2D | null {
    if (kind !== "2d") return null;
    let context = contexts.get(this);
    if (!context) {
      context = new FakeContext2D();
      contexts.set(this, context);
    }
    return context;
  },
});

Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
  configurable: true,
  writable: true,
  value: function (this: HTMLCanvasElement, fps?: number): FakeStream {
    captureFps.push(fps ?? -1);
    const stream = new FakeStream([new FakeTrack("video", "canvas-video")]);
    canvasStreams.push(stream);
    return stream;
  },
});

Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
  configurable: true,
  writable: true,
  value: function (
    this: HTMLCanvasElement,
    callback: (blob: Blob | null) => void,
  ): void {
    callback(new Blob(["canvas-bytes"], { type: "video/webm" }));
  },
});

interface VideoInternals {
  __srcObject?: FakeStream | null;
  __videoWidth?: number;
  __videoHeight?: number;
}

Object.defineProperty(HTMLVideoElement.prototype, "srcObject", {
  configurable: true,
  get(this: HTMLVideoElement & VideoInternals) {
    return this.__srcObject ?? null;
  },
  set(this: HTMLVideoElement & VideoInternals, value: FakeStream | null) {
    this.__srcObject = value;
    const videoTrack = value?.getVideoTracks?.()[0];
    const settings = videoTrack?.getSettings?.() ?? {};
    this.__videoWidth = (settings.width as number | undefined) ?? 0;
    this.__videoHeight = (settings.height as number | undefined) ?? 0;
    const element = this as unknown as HTMLVideoElement;
    setTimeout(() => {
      element.dispatchEvent(new Event("loadedmetadata"));
      element.dispatchEvent(new Event("loadeddata"));
      element.dispatchEvent(new Event("canplay"));
      element.dispatchEvent(new Event("playing"));
    }, 0);
  },
});

Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
  configurable: true,
  get(this: HTMLVideoElement & VideoInternals) {
    return this.__videoWidth ?? 0;
  },
});

Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
  configurable: true,
  get(this: HTMLVideoElement & VideoInternals) {
    return this.__videoHeight ?? 0;
  },
});

Object.defineProperty(HTMLVideoElement.prototype, "readyState", {
  configurable: true,
  get() {
    return 4;
  },
});

Object.defineProperty(HTMLVideoElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: vi.fn(async () => {}),
});

Object.defineProperty(HTMLVideoElement.prototype, "pause", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLVideoElement.prototype, "load", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

// ---------------------------------------------------------------------------
// Frame loop and globals
// ---------------------------------------------------------------------------

const rafCallbacks = new Map<number, (time: number) => void>();
let rafId = 0;
let rafBudget = 0;

function requestFrame(callback: (time: number) => void): number {
  const id = ++rafId;
  rafCallbacks.set(id, callback);
  queueMicrotask(() => {
    const scheduled = rafCallbacks.get(id);
    if (!scheduled) return;
    rafCallbacks.delete(id);
    if (rafBudget-- <= 0) return;
    scheduled(performance.now());
  });
  return id;
}

const cancelFrame = vi.fn((id: number) => {
  rafCallbacks.delete(id);
});

function installBrowserMocks(): void {
  FakeMediaRecorder.instances = [];
  FakeAudioContext.instances = [];
  contexts.clear();
  canvasStreams.length = 0;
  captureFps.length = 0;
  rafCallbacks.clear();
  rafId = 0;
  rafBudget = 400;
  streamCounter = 0;

  vi.stubGlobal("MediaStream", FakeStream);
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("webkitAudioContext", FakeAudioContext);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:mock-url"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
}

beforeEach(() => {
  installBrowserMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const stageRect: Rect = { x: 0, y: 0, width: 1000, height: 500 };
const recordingRect: Rect = { x: 100, y: 50, width: 400, height: 200 };

function makeHarness(overrides: Record<string, unknown> = {}) {
  const screenVideo = new FakeTrack("video", "screen-video", {
    width: 1000,
    height: 500,
    frameRate: 30,
  });
  const screenAudio = new FakeTrack("audio", "screen-audio");
  const screenStream = new FakeStream([screenVideo, screenAudio]);

  const getDisplayMedia = vi.fn(async () => screenStream);
  const saveVideo = vi.fn(async (_blob: Blob) => "blob:take-1");
  const setWebAudioMuted = vi.fn();

  const options: Record<string, unknown> = {
    getDisplayMedia,
    setWebAudioMuted,
    saveVideo,
    ...overrides,
  };

  const backend = createBrowserRecordingBackend(options as never);

  return {
    backend,
    options,
    screenStream,
    screenVideo,
    screenAudio,
    getDisplayMedia: options.getDisplayMedia as typeof getDisplayMedia,
    saveVideo: options.saveVideo as typeof saveVideo,
    setWebAudioMuted: options.setWebAudioMuted as typeof setWebAudioMuted,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  const onWarning = vi.fn();
  return {
    stageRect,
    recordingRect,
    recordAudio: false,
    onWarning,
    ...overrides,
  };
}

function lastRecorder(): FakeMediaRecorder {
  const recorder = FakeMediaRecorder.instances.at(-1);
  if (!recorder) throw new Error("no MediaRecorder was constructed");
  return recorder;
}

function firstContext(): FakeContext2D {
  const context = [...contexts.values()][0];
  if (!context) throw new Error("no 2d canvas context was used");
  return context;
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createBrowserRecordingBackend — factory", () => {
  it("returns a backend with a start function", () => {
    const h = makeHarness();
    expect(typeof h.backend.start).toBe("function");
  });

  it.each([0, -1, 1.5, 2.5, 121, 1000, NaN, Infinity, -Infinity])(
    "rejects a frame rate of %s",
    (frameRate) => {
      expect(() => makeHarness({ frameRate })).toThrow();
    },
  );

  it.each([1, 30, 60, 120])("accepts a frame rate of %s", (frameRate) => {
    expect(() => makeHarness({ frameRate })).not.toThrow();
  });

  it("defaults the frame rate to 30", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request() as never);
    expect(captureFps).toContain(30);
    session.dispose();
  });

  it("passes an explicit frame rate to the canvas capture stream", async () => {
    const h = makeHarness({ frameRate: 24 });
    const session = await h.backend.start(request() as never);
    expect(captureFps).toContain(24);
    session.dispose();
  });
});

describe("createBrowserRecordingBackend — output stream", () => {
  it("encodes only the cropped canvas video", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request() as never);
    const recorder = lastRecorder();

    const videoIds = recorder.stream.getVideoTracks().map((track) => track.id);
    expect(videoIds).toContain("canvas-video");
    expect(videoIds).not.toContain("screen-video");
    expect(recorder.stream).not.toBe(h.screenStream);
    expect(recorder.stream.getAudioTracks().map((track) => track.id)).not.toContain(
      "screen-audio",
    );
    session.dispose();
  });

  it("crops the frame through the stage-to-source scale before encoding", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request() as never);
    await tick();

    const call = firstContext().drawImage.mock.calls.find((args) => args.length === 9);
    expect(call).toBeDefined();
    // Source is the same size as the stage here, so the recording rect maps 1:1.
    expect(call!.slice(1)).toEqual([100, 50, 400, 200, 0, 0, 400, 200]);
    session.dispose();
  });
});

describe("createBrowserRecordingBackend — audio", () => {
  it("never requests microphone or player streams when recordAudio is false", async () => {
    const controlledTrack = new FakeTrack("audio", "controlled-audio");
    const getControlledAudioStreams = vi.fn(() => [new FakeStream([controlledTrack])]);
    const getMicrophone = vi.fn(async () => new FakeStream([new FakeTrack("audio", "mic")]));

    const h = makeHarness({ getControlledAudioStreams, getMicrophone, requestMicrophone: true });
    const session = await h.backend.start(request({ recordAudio: false }) as never);

    expect(getControlledAudioStreams).not.toHaveBeenCalled();
    expect(getMicrophone).not.toHaveBeenCalled();
    expect(lastRecorder().stream.getAudioTracks()).toHaveLength(0);
    session.dispose();
  });

  it("mixes controlled player audio through an AudioContext destination", async () => {
    const controlledTrack = new FakeTrack("audio", "controlled-audio");
    const getControlledAudioStreams = vi.fn(() => [new FakeStream([controlledTrack])]);

    const h = makeHarness({ getControlledAudioStreams });
    const session = await h.backend.start(request({ recordAudio: true }) as never);

    expect(getControlledAudioStreams).toHaveBeenCalled();
    expect(FakeAudioContext.instances.length).toBeGreaterThan(0);
    expect(FakeAudioContext.instances[0]!.createMediaStreamDestination).toHaveBeenCalled();

    const recorder = lastRecorder();
    expect(recorder.stream.getAudioTracks().length).toBeGreaterThan(0);
    expect(recorder.stream.getAudioTracks().map((track) => track.id)).not.toContain(
      "screen-audio",
    );

    await session.finish();
    expect(controlledTrack.stop).not.toHaveBeenCalled();
  });

  it("warns and continues when the microphone is denied", async () => {
    const getMicrophone = vi.fn(() => Promise.reject(new Error("microphone denied")));
    const h = makeHarness({ getMicrophone, requestMicrophone: true });
    const req = request({ recordAudio: true });

    const session = await h.backend.start(req as never);

    expect(req.onWarning).toHaveBeenCalled();
    const [message] = req.onWarning.mock.calls[0]!;
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);

    const take = await session.finish();
    expect(take.videoUri).toBe("blob:take-1");
  });

  it("does not request a microphone unless asked", async () => {
    const getMicrophone = vi.fn(async () => new FakeStream([new FakeTrack("audio", "mic")]));
    const h = makeHarness({ getMicrophone, requestMicrophone: false });

    const session = await h.backend.start(request({ recordAudio: true }) as never);
    expect(getMicrophone).not.toHaveBeenCalled();
    session.dispose();
  });

  it("does not request a microphone by default", async () => {
    const getMicrophone = vi.fn(async () => new FakeStream([new FakeTrack("audio", "mic")]));
    const h = makeHarness({ getMicrophone });

    const session = await h.backend.start(request({ recordAudio: true }) as never);
    expect(getMicrophone).not.toHaveBeenCalled();
    session.dispose();
  });

  it("keeps recording video when no controlled audio streams exist", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request({ recordAudio: true }) as never);

    expect(lastRecorder().stream.getVideoTracks()).toHaveLength(1);
    const take = await session.finish();
    expect(take.videoUri).toBe("blob:take-1");
  });
});

describe("createBrowserRecordingBackend — web audio mute", () => {
  it("mutes web audio for the take and restores it on stop", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request() as never);

    expect(h.setWebAudioMuted).toHaveBeenCalledWith(true);
    await session.finish();
    expect(h.setWebAudioMuted).toHaveBeenLastCalledWith(false);
  });

  it("restores web audio on dispose", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request() as never);

    session.dispose();
    expect(h.setWebAudioMuted).toHaveBeenLastCalledWith(false);
  });
});

describe("createBrowserRecordingBackend — saving", () => {
  it("saves exactly one nonempty Blob and returns its URI", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request() as never);

    const take = await session.finish();

    expect(take).toEqual({ videoUri: "blob:take-1" });
    expect(h.saveVideo).toHaveBeenCalledTimes(1);
    const [blob] = h.saveVideo.mock.calls[0]!;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it("rejects when saving fails", async () => {
    const saveVideo = vi.fn(() => Promise.reject(new Error("disk full")));
    const h = makeHarness({ saveVideo });
    const session = await h.backend.start(request() as never);

    await expect(session.finish()).rejects.toThrow();
  });

  it("does not save or leave web audio muted when capture setup fails", async () => {
    const getDisplayMedia = vi.fn(() => Promise.reject(new Error("permission denied")));
    const h = makeHarness({ getDisplayMedia });

    await expect(h.backend.start(request() as never)).rejects.toThrow();

    expect(h.saveVideo).not.toHaveBeenCalled();
    const calls = h.setWebAudioMuted.mock.calls;
    if (calls.length > 0) {
      expect(calls.at(-1)![0]).toBe(false);
    }
  });
});

describe("createBrowserRecordingBackend — cleanup", () => {
  it("stops owned tracks and the frame loop on dispose", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request() as never);
    await tick();

    const context = firstContext();
    session.dispose();

    expect(h.screenVideo.stop).toHaveBeenCalled();
    expect(h.screenAudio.stop).toHaveBeenCalled();
    expect(lastRecorder().state).toBe("inactive");

    const drawCalls = context.drawImage.mock.calls.length;
    await tick(20);
    expect(context.drawImage.mock.calls.length).toBe(drawCalls);
    expect(document.querySelectorAll("canvas, video")).toHaveLength(0);
  });

  it("never stops borrowed controlled player tracks", async () => {
    const controlledTrack = new FakeTrack("audio", "controlled-audio");
    const getControlledAudioStreams = vi.fn(() => [new FakeStream([controlledTrack])]);

    const h = makeHarness({ getControlledAudioStreams });
    const session = await h.backend.start(request({ recordAudio: true }) as never);

    session.dispose();

    expect(controlledTrack.stop).not.toHaveBeenCalled();
    expect(h.screenVideo.stop).toHaveBeenCalled();
  });

  it("is safe to dispose after a finished take", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request() as never);
    await session.finish();

    expect(() => session.dispose()).not.toThrow();
    expect(h.saveVideo).toHaveBeenCalledTimes(1);
  });

  it("cancels the frame loop on stop", async () => {
    const h = makeHarness();
    const session = await h.backend.start(request() as never);
    await tick();

    await session.finish();

    const context = firstContext();
    const drawCalls = context.drawImage.mock.calls.length;
    await tick(20);
    expect(context.drawImage.mock.calls.length).toBe(drawCalls);
  });
});
