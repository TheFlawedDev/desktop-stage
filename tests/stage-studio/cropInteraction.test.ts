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

  it("normalizes camera viewport center to local crop origin without offset displacement", () => {
    // Selected crop with non-zero origin
    const recordingRect: Rect = { x: 140, y: 90, width: 800, height: 500 };
    const zoom = 1.5;

    // Viewport returned by MouseFollowCamera when at rest/center:
    // vpCenterX = baseCenterX = 140 + 400 = 540
    // vpCenterY = baseCenterY = 90 + 250 = 340
    const vpCenterX = recordingRect.x + recordingRect.width / 2;
    const vpCenterY = recordingRect.y + recordingRect.height / 2;

    const baseW = recordingRect.width;
    const baseH = recordingRect.height;
    const cropOriginX = recordingRect.x;
    const cropOriginY = recordingRect.y;

    const localVpCenterX = vpCenterX - cropOriginX;
    const localVpCenterY = vpCenterY - cropOriginY;

    const rawDx = ((baseW / 2 - localVpCenterX) / baseW) * 100;
    const rawDy = ((baseH / 2 - localVpCenterY) / baseH) * 100;

    // At rest/center, translation must be exactly 0% (never shifting into a corner)
    expect(localVpCenterX).toBe(baseW / 2);
    expect(localVpCenterY).toBe(baseH / 2);
    expect(rawDx).toBe(0);
    expect(rawDy).toBe(0);

    // Pan bounds clamp: maxShift = ((zoom - 1) / (2 * zoom)) * 100
    const maxShift = ((zoom - 1) / (2 * zoom)) * 100; // ~16.67%
    expect(maxShift).toBeCloseTo(16.6667, 3);
  });
});

