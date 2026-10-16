import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Arc Browser Full Web Browsing & Live Recording (AC-1, AC-2, AC-3, AC-4)", () => {
  it("AC-1: api/proxy/route.ts injects in-page link and form interceptor script", () => {
    const routePath = path.resolve(__dirname, "../../apps/web/src/app/api/proxy/route.ts");
    const routeCode = fs.readFileSync(routePath, "utf-8");

    // Interceptor script must be injected into proxied HTML
    expect(routeCode).toMatch(/toProxyUrl|\/api\/proxy\?url=/);
    expect(routeCode).toContain("addEventListener");
    expect(routeCode).toContain("click");
    expect(routeCode).toContain("submit");
  });

  it("AC-2: InteractiveStage renders real iframe without fake intercepts for DuckDuckGo and Hacker News", () => {
    const stagePath = path.resolve(__dirname, "../../apps/web/src/features/stage-studio/InteractiveStage.tsx");
    const stageCode = fs.readFileSync(stagePath, "utf-8");

    // Fake DuckDuckGo mockup block must be removed
    expect(stageCode).not.toContain('arcActiveUrl.includes("duckduckgo.com") ?');

    // Hacker News bookmark must not force arcReaderMode
    const hnBookmarkBlock = stageCode.match(/bm\.name === ["']Hacker News["'][\s\S]*?\}/);
    expect(hnBookmarkBlock).toBeTruthy();
    if (hnBookmarkBlock) {
      expect(hnBookmarkBlock[0]).not.toContain("setArcReaderMode(true)");
    }
  });

  it("AC-3: handleArcNavigate routes queries to real web search instead of only Wikipedia", () => {
    const stagePath = path.resolve(__dirname, "../../apps/web/src/features/stage-studio/InteractiveStage.tsx");
    const stageCode = fs.readFileSync(stagePath, "utf-8");

    // handleArcNavigate should navigate to DuckDuckGo search or real web search
    const navigateFn = stageCode.match(/const handleArcNavigate = [\s\S]*?\n  \};/);
    expect(navigateFn).toBeTruthy();
    if (navigateFn) {
      expect(navigateFn[0]).toMatch(/duckduckgo\.com/);
    }
  });

  it("AC-4: PreviewPanel defaults recordingEngine to display-media for 1:1 live screen recording", () => {
    const previewPath = path.resolve(__dirname, "../../apps/web/src/features/editor/PreviewPanel.tsx");
    const previewCode = fs.readFileSync(previewPath, "utf-8");

    // State initializer must default to "display-media"
    expect(previewCode).toMatch(/useState<.*>\(["']display-media["']\)/);
  });
});
