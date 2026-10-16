import { describe, it, expect } from "vitest";
import { computeWallpaperCoverDimensions } from "../../apps/web/src/features/stage-studio/InteractiveStage";
import fs from "node:fs";
import path from "node:path";

describe("Custom Wallpaper in Canvas Recording (AC-1, AC-2, AC-3)", () => {
  it("AC-1: computeWallpaperCoverDimensions computes correct cover crop geometry", () => {
    const desktopWidth = 1280;
    const desktopHeight = 720;
    const stageRatio = desktopWidth / desktopHeight; // 16:9 ~ 1.7778

    // Case 1: Wider image (e.g. 21:9 image 2560x1080)
    // Ratio = 2.37 > 1.7778 -> Match height (720), drawW = 720 * (2560/1080) = 1706.67, drawX centered
    const wider = computeWallpaperCoverDimensions(2560, 1080, desktopWidth, desktopHeight);
    expect(wider.drawH).toBe(720);
    expect(wider.drawW).toBeCloseTo(1706.667, 1);
    expect(wider.drawX).toBeCloseTo((1280 - 1706.667) / 2, 1);
    expect(wider.drawY).toBe(0);

    // Case 2: Taller image (e.g. 4:3 image 1600x1200 or 1:1 image 1000x1000)
    // 1:1 ratio = 1.0 < 1.7778 -> Match width (1280), drawH = 1280 / 1.0 = 1280, drawY centered
    const taller = computeWallpaperCoverDimensions(1000, 1000, desktopWidth, desktopHeight);
    expect(taller.drawW).toBe(1280);
    expect(taller.drawH).toBe(1280);
    expect(taller.drawX).toBe(0);
    expect(taller.drawY).toBeCloseTo((720 - 1280) / 2, 1);

    // Case 3: Exactly matching aspect ratio (1920x1080)
    const exact = computeWallpaperCoverDimensions(1920, 1080, desktopWidth, desktopHeight);
    expect(exact.drawW).toBe(1280);
    expect(exact.drawH).toBe(720);
    expect(exact.drawX).toBe(0);
    expect(exact.drawY).toBe(0);
  });

  it("AC-2: InteractiveStage maintains live wallpaperRef and uses wallpaperRef.current in drawFrame", () => {
    const stagePath = path.resolve(__dirname, "../../apps/web/src/features/stage-studio/InteractiveStage.tsx");
    const stageCode = fs.readFileSync(stagePath, "utf-8");

    // Must synchronize wallpaper state to wallpaperRef
    expect(stageCode).toContain("const wallpaperRef = useRef(wallpaper);");
    expect(stageCode).toContain("wallpaperRef.current = wallpaper;");

    // drawFrame must evaluate wallpaperRef.current for custom wallpaper and gradients
    expect(stageCode).toMatch(/wallpaperRef\.current\s*===\s*["']custom["']/);
  });

  it("AC-3: useImperativeHandle includes wallpaper and customWallpaperUrl in dependency array", () => {
    const stagePath = path.resolve(__dirname, "../../apps/web/src/features/stage-studio/InteractiveStage.tsx");
    const stageCode = fs.readFileSync(stagePath, "utf-8");

    // Find useImperativeHandle dependency array: ends with "  },\n    [\n ... \n    ],\n  );"
    const imperativeHandleMatch = stageCode.match(/useImperativeHandle\([\s\S]*?\n\s*\}\),\s*\n\s*\[([\s\S]*?)\]\s*,\s*\n\s*\);/);
    expect(imperativeHandleMatch).toBeTruthy();
    const depsString = imperativeHandleMatch ? imperativeHandleMatch[1] : "";

    expect(depsString).toContain("wallpaper");
    expect(depsString).toContain("customWallpaperUrl");
  });
});
