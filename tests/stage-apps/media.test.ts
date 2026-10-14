/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaPlaybackController } from "../../packages/desktop-engine/src/stage/apps/index";
import type { MediaElementLike } from "../../packages/desktop-engine/src/stage/apps/index";

const BLOB = "blob:https://app.example/9f1c3d";

class FakeTrack {
  stopped = false;
  constructor(readonly kind: "audio" | "video") {}
  stop() {
    this.stopped = true;
  }
}

/** Minimal stand-in for the browser MediaStream used by getAudioStream(). */
class FakeMediaStream {
  constructor(readonly tracks: FakeTrack[] = []) {}
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

interface FakeElement extends MediaElementLike {
  events: string[];
  playCalls: number;
  pauseCalls: number;
  loadCalls: number;
  playResult: Promise<void>;
}

function makeElement(): FakeElement {
  const element: FakeElement = {
    src: "",
    currentTime: 0,
    duration: 10,
    volume: 1,
    muted: false,
    events: [],
    playCalls: 0,
    pauseCalls: 0,
    loadCalls: 0,
    playResult: Promise.resolve(),
    play() {
      element.playCalls += 1;
      element.events.push("play");
      return element.playResult;
    },
    pause() {
      element.pauseCalls += 1;
      element.events.push("pause");
    },
    load() {
      element.loadCalls += 1;
      element.events.push("load");
    },
  };
  return element;
}

const globals = globalThis as unknown as { MediaStream: unknown };
const originalMediaStream = globals.MediaStream;
let revokeCalls = 0;
const urlWithRevoke = URL as unknown as { revokeObjectURL?: (url: string) => void };
const originalRevoke = urlWithRevoke.revokeObjectURL;

beforeEach(() => {
  globals.MediaStream = FakeMediaStream;
  revokeCalls = 0;
  urlWithRevoke.revokeObjectURL = () => {
    revokeCalls += 1;
  };
});

afterEach(() => {
  globals.MediaStream = originalMediaStream;
  urlWithRevoke.revokeObjectURL = originalRevoke;
});

describe("MediaPlaybackController", () => {
  describe("setSource", () => {
    it("accepts blob URLs supplied by the project for both kinds", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");

      controller.setSource(BLOB, "video");
      expect(element.src).toBe(BLOB);

      controller.setSource("blob:abcdef", "audio");
      expect(element.src).toBe("blob:abcdef");
    });

    it("pauses, rewinds, assigns and reloads on a valid source", () => {
      const element = makeElement();
      element.currentTime = 7;
      const controller = new MediaPlaybackController(element, "quicktime");

      controller.setSource(BLOB, "video");

      expect(element.pauseCalls).toBe(1);
      expect(element.currentTime).toBe(0);
      expect(element.src).toBe(BLOB);
      expect(element.loadCalls).toBe(1);
      expect(element.events.indexOf("pause")).toBeLessThan(element.events.indexOf("load"));
    });

    it("rejects non-blob, empty and control-character sources", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");
      const rejected = [
        "",
        "   ",
        "http://example.com/clip.mp4",
        "https://example.com/clip.mp4",
        "file:///movies/clip.mp4",
        "data:video/mp4;base64,AAAA",
        "javascript:alert(1)",
        "blob:bad\nvalue",
        "blob:bad\u0000value",
        "blob:bad\u0007value",
      ];

      for (const uri of rejected) {
        expect(() => controller.setSource(uri, "video")).toThrow();
      }
      expect(element.src).toBe("");
      expect(element.loadCalls).toBe(0);
    });

    it("leaves the previous source untouched when a new source is invalid", () => {
      const element = makeElement();
      element.currentTime = 4;
      const controller = new MediaPlaybackController(element, "quicktime");
      controller.setSource(BLOB, "video");
      element.currentTime = 4;

      expect(() => controller.setSource("https://evil.example/clip.mp4", "video")).toThrow();

      expect(element.src).toBe(BLOB);
      expect(element.currentTime).toBe(4);
      expect(element.loadCalls).toBe(1);
    });

    it("lets QuickTime play audio or video but Photo Booth only video", () => {
      const quicktime = new MediaPlaybackController(makeElement(), "quicktime");
      expect(() => quicktime.setSource(BLOB, "audio")).not.toThrow();
      expect(() => quicktime.setSource(BLOB, "video")).not.toThrow();

      const photoBooth = new MediaPlaybackController(makeElement(), "photobooth");
      expect(() => photoBooth.setSource(BLOB, "audio")).toThrow();
      expect(() => photoBooth.setSource(BLOB, "video")).not.toThrow();
    });
  });

  describe("transport", () => {
    it("delegates play and pause", async () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");

      await controller.play();
      expect(element.playCalls).toBe(1);

      controller.pause();
      expect(element.pauseCalls).toBe(1);
    });

    it("propagates play failures", async () => {
      const element = makeElement();
      element.playResult = Promise.reject(new Error("autoplay blocked"));
      const controller = new MediaPlaybackController(element, "quicktime");

      await expect(controller.play()).rejects.toThrow();
    });
  });

  describe("seek", () => {
    it("clamps finite positions into the media duration", () => {
      const element = makeElement();
      element.duration = 10;
      const controller = new MediaPlaybackController(element, "quicktime");

      controller.seek(5);
      expect(element.currentTime).toBe(5);
      controller.seek(-3);
      expect(element.currentTime).toBe(0);
      controller.seek(50);
      expect(element.currentTime).toBe(10);
      controller.seek(0);
      expect(element.currentTime).toBe(0);
    });

    it("uses a zero lower bound when the duration is unknown", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");

      element.duration = Number.NaN;
      controller.seek(5);
      expect(element.currentTime).toBe(0);

      element.duration = -1;
      controller.seek(5);
      expect(element.currentTime).toBe(0);

      element.duration = Number.POSITIVE_INFINITY;
      controller.seek(5);
      expect(element.currentTime).toBe(0);
    });

    it("never writes NaN", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");
      element.duration = 10;

      element.currentTime = 4;
      controller.seek(Number.NaN);
      expect(Number.isNaN(element.currentTime)).toBe(false);
      expect(element.currentTime).toBeGreaterThanOrEqual(0);

      controller.seek(Number.POSITIVE_INFINITY);
      expect(Number.isNaN(element.currentTime)).toBe(false);
      expect(element.currentTime).toBeLessThanOrEqual(10);
    });
  });

  describe("volume and mute", () => {
    it("clamps volume into 0..1", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");

      controller.setVolume(0.5);
      expect(element.volume).toBe(0.5);
      controller.setVolume(-1);
      expect(element.volume).toBe(0);
      controller.setVolume(2);
      expect(element.volume).toBe(1);
    });

    it("never writes a non-finite volume", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");
      element.volume = 0.4;

      controller.setVolume(Number.NaN);
      expect(Number.isNaN(element.volume)).toBe(false);
      expect(element.volume).toBeGreaterThanOrEqual(0);
      expect(element.volume).toBeLessThanOrEqual(1);
    });

    it("forwards mute", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");
      controller.setMuted(true);
      expect(element.muted).toBe(true);
      controller.setMuted(false);
      expect(element.muted).toBe(false);
    });
  });

  describe("getAudioStream", () => {
    it("returns null when the element cannot capture", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");
      expect(controller.getAudioStream()).toBeNull();
    });

    it("returns only the audio tracks of the captured stream", () => {
      const element = makeElement();
      const audio = new FakeTrack("audio");
      const video = new FakeTrack("video");
      element.captureStream = () => new FakeMediaStream([audio, video]) as unknown as MediaStream;
      const controller = new MediaPlaybackController(element, "quicktime");

      const stream = controller.getAudioStream();
      expect(stream).toBeInstanceOf(FakeMediaStream);
      const fake = stream as unknown as FakeMediaStream;
      expect(fake.getAudioTracks()).toEqual([audio]);
      expect(fake.getVideoTracks()).toEqual([]);
      expect(audio.stopped).toBe(false);
      expect(video.stopped).toBe(false);
    });

    it("returns null when capture throws or yields nothing", () => {
      const element = makeElement();
      element.captureStream = () => {
        throw new Error("capture failed");
      };
      const controller = new MediaPlaybackController(element, "quicktime");
      expect(controller.getAudioStream()).toBeNull();

      element.captureStream = () => undefined as unknown as MediaStream;
      expect(controller.getAudioStream()).toBeNull();
    });
  });

  describe("dispose", () => {
    it("pauses, clears the source and reloads", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");
      controller.setSource(BLOB, "video");

      controller.dispose();

      expect(element.pauseCalls).toBe(2); // setSource + dispose
      expect(element.src).toBe("");
      expect(element.loadCalls).toBe(2);
    });

    it("is idempotent", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");
      controller.setSource(BLOB, "video");
      const loadsAfterSetSource = element.loadCalls;

      controller.dispose();
      const loadsAfterDispose = element.loadCalls;
      controller.dispose();
      controller.dispose();

      expect(loadsAfterDispose).toBe(loadsAfterSetSource + 1);
      expect(element.loadCalls).toBe(loadsAfterDispose);
    });

    it("does not stop element-owned tracks or revoke caller-owned URLs", () => {
      const element = makeElement();
      const audio = new FakeTrack("audio");
      const video = new FakeTrack("video");
      element.captureStream = () => new FakeMediaStream([audio, video]) as unknown as MediaStream;
      const controller = new MediaPlaybackController(element, "quicktime");
      controller.setSource(BLOB, "video");
      controller.getAudioStream();

      controller.dispose();

      expect(audio.stopped).toBe(false);
      expect(video.stopped).toBe(false);
      expect(revokeCalls).toBe(0);
    });

    it("makes later calls fail clearly", () => {
      const element = makeElement();
      const controller = new MediaPlaybackController(element, "quicktime");
      controller.setSource(BLOB, "video");
      controller.dispose();

      expect(() => controller.setSource(BLOB, "video")).toThrow();
      expect(() => controller.seek(1)).toThrow();
      expect(controller.getAudioStream()).toBeNull();
    });
  });
});
