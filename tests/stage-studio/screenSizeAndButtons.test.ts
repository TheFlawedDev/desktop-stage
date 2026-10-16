import { describe, it, expect } from "vitest";
import { computeDesktopDimensions, STAGE_WIDTH, STAGE_HEIGHT } from "../../apps/web/src/features/stage-studio/InteractiveStage";
import fs from "node:fs";
import path from "node:path";

describe("Dynamic Desktop Dimensions & Button Sizing (AC-1, AC-2, AC-3)", () => {
  it("AC-1: computeDesktopDimensions calculates exact dimensions for all standard presets", () => {
    // Default fallback (undefined resolution) -> 1280x720
    expect(computeDesktopDimensions()).toEqual({ width: 1280, height: 720 });

    // 16:9 Landscape (1920x1080) -> 1280x720
    expect(computeDesktopDimensions({ width: 1920, height: 1080 })).toEqual({ width: 1280, height: 720 });

    // 1:1 Square (1920x1920) -> 720x720
    expect(computeDesktopDimensions({ width: 1920, height: 1920 })).toEqual({ width: 720, height: 720 });

    // 9:16 Portrait / Vertical (1080x1920) -> 720x1280
    expect(computeDesktopDimensions({ width: 1080, height: 1920 })).toEqual({ width: 720, height: 1280 });

    // 4:5 Portrait (1536x1920) -> 720x900
    expect(computeDesktopDimensions({ width: 1536, height: 1920 })).toEqual({ width: 720, height: 900 });

    // 21:9 Ultrawide (1920x822) -> 1680x720
    expect(computeDesktopDimensions({ width: 1920, height: 822 })).toEqual({ width: 1680, height: 720 });
  });

  it("AC-2 & AC-3: PreviewPanel and InteractiveStage include shrink-0, whitespace-nowrap, and compact button styles", () => {
    const previewPanelPath = path.resolve(__dirname, "../../apps/web/src/features/editor/PreviewPanel.tsx");
    const previewPanelCode = fs.readFileSync(previewPanelPath, "utf-8");

    const interactiveStagePath = path.resolve(__dirname, "../../apps/web/src/features/stage-studio/InteractiveStage.tsx");
    const interactiveStageCode = fs.readFileSync(interactiveStagePath, "utf-8");

    // PreviewPanel must pass resolution to InteractiveStage
    expect(previewPanelCode).toContain("resolution={resolution}");

    // PreviewPanel bottom toolbar must have whitespace-nowrap and compact height
    expect(previewPanelCode).toContain("whitespace-nowrap");
    expect(previewPanelCode).toMatch(/h-9.*px-3/);

    // InteractiveStage must include shrink-0 on the stageRef desktop container
    expect(interactiveStageCode).toContain("shrink-0");
  });
});
