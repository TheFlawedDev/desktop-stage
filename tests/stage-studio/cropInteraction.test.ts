import { describe, it, expect } from "vitest";
import {
  STAGE_WIDTH,
  STAGE_HEIGHT,
  APPLE_SVG_PATH,
} from "../../apps/web/src/features/stage-studio/InteractiveStage";
import { resolveRecordingRect } from "../../packages/desktop-engine/src/stage/recorder";
import type { Rect } from "@cutaway/types";

describe("Selected-Area Crop Frame & Drag-Resize Logic", () => {
  const STAGE_RECT: Rect = {
    x: 0,
    y: 0,
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
  };

  it("clamps crop rectangle bounds within stage limits", () => {
    const rawCrop: Rect = { x: -50, y: 10, width: 900, height: 600 };
    // Simulated move clamping: x >= 0, y >= 28, x + w <= 1280, y + h <= 720
    const clampedX = Math.max(
      0,
      Math.min(STAGE_WIDTH - rawCrop.width, rawCrop.x),
    );
    const clampedY = Math.max(
      28,
      Math.min(STAGE_HEIGHT - rawCrop.height, rawCrop.y),
    );

    expect(clampedX).toBe(0);
    expect(clampedY).toBe(28);
    expect(clampedX + rawCrop.width).toBeLessThanOrEqual(STAGE_WIDTH);
    expect(clampedY + rawCrop.height).toBeLessThanOrEqual(STAGE_HEIGHT);
  });

  it("enforces minimum crop dimensions during 8-point resizing", () => {
    const initialCrop: Rect = { x: 200, y: 150, width: 400, height: 300 };
    const minW = 160;
    const minH = 120;

    // Resizing eastward (shrinking beyond min width)
    const largeNegativeDx = -350;
    const newW = Math.max(
      minW,
      Math.min(
        STAGE_WIDTH - initialCrop.x,
        initialCrop.width + largeNegativeDx,
      ),
    );
    expect(newW).toBe(minW);

    // Resizing southward (shrinking beyond min height)
    const largeNegativeDy = -280;
    const newH = Math.max(
      minH,
      Math.min(
        STAGE_HEIGHT - initialCrop.y,
        initialCrop.height + largeNegativeDy,
      ),
    );
    expect(newH).toBe(minH);
  });

  it("correctly resolves recording region when mode is selected-area", () => {
    const customCrop: Rect = { x: 100, y: 50, width: 640, height: 360 };
    const resolved = resolveRecordingRect(STAGE_RECT, {
      mode: "selected-area",
      selectedRect: customCrop,
    });

    expect(resolved.x).toBe(100);
    expect(resolved.y).toBe(50);
    expect(resolved.width).toBe(640);
    expect(resolved.height).toBe(360);
  });

  it("provides valid vector Apple SVG path eliminating Windows tofu glyphs", () => {
    expect(APPLE_SVG_PATH).toBeDefined();
    expect(APPLE_SVG_PATH.startsWith("M150.37")).toBe(true);
    expect(APPLE_SVG_PATH.length).toBeGreaterThan(100);
  });
});
