import { describe, expect, it } from "vitest";
import { classifyMediaFile, computeDynamicDpr } from "../stageMediaUtils";

describe("classifyMediaFile", () => {
  it("classifies MP4 and WEBM video formats", () => {
    expect(classifyMediaFile("screen_recording.mp4")).toEqual({
      kind: "video",
      badge: "MP4",
      mimeType: "video/mp4",
    });
    expect(classifyMediaFile("DEMO.MP4")).toEqual({
      kind: "video",
      badge: "MP4",
      mimeType: "video/mp4",
    });
    expect(classifyMediaFile("take-1.webm")).toEqual({
      kind: "video",
      badge: "WEBM",
      mimeType: "video/webm",
    });
  });

  it("classifies MOV and MKV videos", () => {
    expect(classifyMediaFile("capture.mov")).toEqual({
      kind: "video",
      badge: "MOV",
      mimeType: "video/quicktime",
    });
    expect(classifyMediaFile("archive.mkv")).toEqual({
      kind: "video",
      badge: "MKV",
      mimeType: "video/x-matroska",
    });
  });

  it("classifies audio formats", () => {
    expect(classifyMediaFile("voiceover.mp3")).toEqual({
      kind: "audio",
      badge: "AUDIO",
      mimeType: "audio/mpeg",
    });
    expect(classifyMediaFile("effect.wav")).toEqual({
      kind: "audio",
      badge: "AUDIO",
      mimeType: "audio/wav",
    });
  });

  it("classifies image formats", () => {
    expect(classifyMediaFile("wallpaper.png")).toEqual({
      kind: "image",
      badge: "IMG",
      mimeType: "image/png",
    });
    expect(classifyMediaFile("photo.jpg")).toEqual({
      kind: "image",
      badge: "IMG",
      mimeType: "image/jpeg",
    });
  });

  it("falls back to DOC for unclassified files", () => {
    expect(classifyMediaFile("notes.txt")).toEqual({
      kind: "document",
      badge: "DOC",
      mimeType: "text/plain",
    });
  });
});

describe("computeDynamicDpr", () => {
  it("uses minimum DPR of 2 for large areas (>= 1080p)", () => {
    expect(computeDynamicDpr(1920, 1080)).toBe(2);
    expect(computeDynamicDpr(2560, 1440)).toBe(2);
  });

  it("calculates upscaling DPR for medium areas", () => {
    // 960x540 -> ceil(1920/960) = 2, ceil(1080/540) = 2 -> 2
    expect(computeDynamicDpr(960, 540)).toBe(2);
    // 640x360 -> ceil(1920/640) = 3, ceil(1080/360) = 3 -> 3
    expect(computeDynamicDpr(640, 360)).toBe(3);
    // 480x270 -> ceil(1920/480) = 4, ceil(1080/270) = 4 -> 4
    expect(computeDynamicDpr(480, 270)).toBe(4);
  });

  it("clamps to max DPR of 6 for very small crop selections", () => {
    // 320x180 -> ceil(1920/320) = 6 -> 6
    expect(computeDynamicDpr(320, 180)).toBe(6);
    // Tiny crop 160x90 -> ceil(1920/160) = 12 -> clamped to 6
    expect(computeDynamicDpr(160, 90)).toBe(6);
  });
});
