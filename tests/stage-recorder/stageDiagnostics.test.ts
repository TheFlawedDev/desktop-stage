import { describe, expect, it } from "vitest";
import { stageDiagnostics } from "../../packages/desktop-engine/src/stage/telemetry/StageDiagnostics";

describe("StageDiagnostics", () => {
  it("logs structured traces across categories", () => {
    stageDiagnostics.clear();

    stageDiagnostics.log("RECORDER", "Capture started", { fps: 60, bitrate: 12_000_000 });
    stageDiagnostics.log("CAMERA", "Smoothed view calculated", { zoom: 1.5, x: 200, y: 150 });
    stageDiagnostics.log("WM", "Window raised", { windowId: "win-1" });
    stageDiagnostics.log("SHELL", "Executed command", { cmd: "ls -la", durationMs: 4 });

    const traces = stageDiagnostics.getTraces();
    expect(traces).toHaveLength(4);
    expect(traces[0]!.category).toBe("RECORDER");
    expect(traces[0]!.message).toBe("Capture started");
    expect(traces[0]!.data).toEqual({ fps: 60, bitrate: 12_000_000 });

    expect(traces[1]!.category).toBe("CAMERA");
    expect(traces[2]!.category).toBe("WM");
    expect(traces[3]!.category).toBe("SHELL");
  });

  it("updates and retrieves live metrics", () => {
    stageDiagnostics.updateMetrics({
      fps: 60,
      bitrateMbps: 12,
      encoderMime: "video/webm;codecs=vp9",
      totalChunks: 45,
    });

    const metrics = stageDiagnostics.getMetrics();
    expect(metrics.fps).toBe(60);
    expect(metrics.bitrateMbps).toBe(12);
    expect(metrics.encoderMime).toBe("video/webm;codecs=vp9");
    expect(metrics.totalChunks).toBe(45);
  });

  it("exports valid formatted JSON trace report", () => {
    const jsonStr = stageDiagnostics.exportJson();
    const parsed = JSON.parse(jsonStr);
    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.metrics).toBeDefined();
    expect(Array.isArray(parsed.traces)).toBe(true);
  });

  it("notifies listeners on new trace logs", () => {
    let captured: any = null;
    const unsubscribe = stageDiagnostics.subscribe((trace) => {
      captured = trace;
    });

    stageDiagnostics.log("UI", "User toggled Track Mouse", { active: true });
    expect(captured).not.toBeNull();
    expect(captured.message).toBe("User toggled Track Mouse");

    unsubscribe();
    captured = null;
    stageDiagnostics.log("UI", "Another event");
    expect(captured).toBeNull();
  });
});
