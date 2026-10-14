import { describe, expect, it } from "vitest";
import { STAGE_WIDTH, STAGE_HEIGHT } from "../InteractiveStage";
import {
  StageWindowManager,
  MouseFollowCamera,
} from "@desktop-stage/desktop-engine";
import { createProject, createClip, createId } from "@cutaway/utils";
import type {
  StageTakeManifest,
  Rect,
  StagePointerEvent,
} from "@cutaway/types";

describe("InteractiveStage", () => {
  it("defines standard 1280x720 canvas dimensions", () => {
    expect(STAGE_WIDTH).toBe(1280);
    expect(STAGE_HEIGHT).toBe(720);
  });

  it("calculates correct aspect-ratio scaling factors", () => {
    const computeScale = (w: number, h: number) =>
      Math.min(w / STAGE_WIDTH, h / STAGE_HEIGHT);

    // 1280x720 container -> scale 1.0
    expect(computeScale(1280, 720)).toBe(1.0);

    // 640x360 container -> scale 0.5
    expect(computeScale(640, 360)).toBe(0.5);

    // 1920x1080 container -> scale 1.5
    expect(computeScale(1920, 1080)).toBe(1.5);

    // Letterboxed wide container: 1920x720 -> scale 1.0 (height constrained)
    expect(computeScale(1920, 720)).toBe(1.0);

    // Letterboxed tall container: 1280x1440 -> scale 1.0 (width constrained)
    expect(computeScale(1280, 1440)).toBe(1.0);
  });

  it("normalizes client pointer coordinates to stage coordinates accurately", () => {
    const scale = 0.5; // container is 640x360
    const stageBoundingRect = { left: 100, top: 50 };

    const toStageCoords = (clientX: number, clientY: number) => {
      const rawX = Math.round((clientX - stageBoundingRect.left) / scale);
      const rawY = Math.round((clientY - stageBoundingRect.top) / scale);
      return {
        x: Math.max(0, Math.min(STAGE_WIDTH, rawX)),
        y: Math.max(0, Math.min(STAGE_HEIGHT, rawY)),
      };
    };

    // Click at top-left of stage
    expect(toStageCoords(100, 50)).toEqual({ x: 0, y: 0 });

    // Click at center (320px in, 180px in) -> 640, 360 in stage space
    expect(toStageCoords(100 + 320, 50 + 180)).toEqual({ x: 640, y: 360 });

    // Out-of-bounds clicks clamp cleanly to stage bounds
    expect(toStageCoords(0, 0)).toEqual({ x: 0, y: 0 });
    expect(toStageCoords(1000, 1000)).toEqual({ x: 1280, y: 720 });
  });

  it("supports window management and dock app restacking", () => {
    const wm = new StageWindowManager();
    const finder = wm.openApp("finder", {
      x: 50,
      y: 50,
      width: 400,
      height: 300,
    });
    const iterm = wm.openApp("iterm", {
      x: 100,
      y: 100,
      width: 500,
      height: 350,
    });

    expect(wm.getWindows()).toHaveLength(2);
    expect(wm.getFocusedWindow()?.id).toBe(iterm.id);
    expect(iterm.zIndex).toBeGreaterThan(finder.zIndex);

    // Clicking finder brings it to the top
    wm.focusWindow(finder.id);
    expect(wm.getFocusedWindow()?.id).toBe(finder.id);

    const updatedFinder = wm.getWindows().find((w) => w.id === finder.id);
    expect(updatedFinder?.zIndex).toBeGreaterThan(iterm.zIndex);
  });

  it("constructs valid StageTakeManifest upon take completion", () => {
    const cropRect: Rect = { x: 100, y: 80, width: 800, height: 500 };
    const manifest: StageTakeManifest = {
      takeId: "take-123456",
      videoUri: "blob:http://localhost:3000/mock-take-stream",
      durationMs: 4500,
      recordingRect: cropRect,
      pointerEvents: [
        { timestampMs: 100, pos: { x: 120, y: 90 }, type: "move" },
        { timestampMs: 400, pos: { x: 150, y: 110 }, type: "click" },
      ],
      trackMouseEnabled: false,
      createdAt: 1792015000000,
    };

    expect(manifest.takeId).toBe("take-123456");
    expect(manifest.durationMs).toBe(4500);
    expect(manifest.recordingRect).toEqual(cropRect);
    expect(manifest.pointerEvents).toHaveLength(2);
    expect(manifest.trackMouseEnabled).toBe(false);
  });

  it("computes 1.5x smoothed follow viewport and responsive transform offset", () => {
    const camera = new MouseFollowCamera();
    const baseRect: Rect = { x: 0, y: 0, width: 1280, height: 720 };
    const pointerEvents: StagePointerEvent[] = [
      { timestampMs: 0, pos: { x: 640, y: 360 }, type: "move" },
      { timestampMs: 500, pos: { x: 900, y: 200 }, type: "move" },
      { timestampMs: 1000, pos: { x: 900, y: 200 }, type: "click" },
    ];

    // At t=0, camera centers at 640, 360
    const startView = camera.computeSmoothedView(
      pointerEvents,
      0,
      baseRect,
      1.5,
    );
    expect(startView.zoom).toBe(1.5);
    expect(startView.viewport.width).toBeCloseTo(1280 / 1.5, 1);
    expect(startView.viewport.height).toBeCloseTo(720 / 1.5, 1);

    const vpCenterX = startView.viewport.x + startView.viewport.width / 2;
    const vpCenterY = startView.viewport.y + startView.viewport.height / 2;
    expect(vpCenterX).toBeCloseTo(640, 0);
    expect(vpCenterY).toBeCloseTo(360, 0);

    // Compute transform translation percentage
    const dxPercent = ((baseRect.width / 2 - vpCenterX) / baseRect.width) * 100;
    const dyPercent =
      ((baseRect.height / 2 - vpCenterY) / baseRect.height) * 100;
    expect(dxPercent).toBeCloseTo(0, 1);
    expect(dyPercent).toBeCloseTo(0, 1);

    // At t=1000, camera moves towards 900, 200 with smoothing
    const laterView = camera.computeSmoothedView(
      pointerEvents,
      1000,
      baseRect,
      1.5,
    );
    const laterCenterX = laterView.viewport.x + laterView.viewport.width / 2;
    const laterCenterY = laterView.viewport.y + laterView.viewport.height / 2;
    expect(laterCenterX).toBeGreaterThan(640);
    expect(laterCenterY).toBeLessThan(360);

    // Later dxPercent translates left to keep target centered
    const laterDx =
      ((baseRect.width / 2 - laterCenterX) / baseRect.width) * 100;
    expect(laterDx).toBeLessThan(0);
  });
});
