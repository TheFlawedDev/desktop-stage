import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Arc Browser Web Proxy & Recording Fidelity (AC-1, AC-2, AC-3, AC-4)", () => {
  it("AC-1: getArcIframeUrl correctly proxies external URLs and leaves Wikipedia/internal URLs direct", async () => {
    // Dynamic import to verify export
    const { getArcIframeUrl } = await import(
      "../../apps/web/src/features/stage-studio/InteractiveStage"
    );

    expect(typeof getArcIframeUrl).toBe("function");

    // Wikipedia direct
    expect(getArcIframeUrl("https://en.m.wikipedia.org")).toBe("https://en.m.wikipedia.org");
    expect(getArcIframeUrl("https://en.wikipedia.org/wiki/React")).toBe("https://en.wikipedia.org/wiki/React");

    // External sites proxied
    expect(getArcIframeUrl("https://duckduckgo.com")).toBe(
      `/api/proxy?url=${encodeURIComponent("https://duckduckgo.com")}`
    );
    expect(getArcIframeUrl("https://news.ycombinator.com")).toBe(
      `/api/proxy?url=${encodeURIComponent("https://news.ycombinator.com")}`
    );
    expect(getArcIframeUrl("https://github.com/trending")).toBe(
      `/api/proxy?url=${encodeURIComponent("https://github.com/trending")}`
    );

    // Existing proxy or data URLs preserved
    expect(getArcIframeUrl("/api/proxy?url=https%3A%2F%2Fexample.com")).toBe(
      "/api/proxy?url=https%3A%2F%2Fexample.com"
    );
    expect(getArcIframeUrl("data:text/html,Hello")).toBe("data:text/html,Hello");
    expect(getArcIframeUrl("")).toBe("");
  });

  it("AC-2: api/proxy/route.ts exists and provides server-side CORS and X-Frame-Options removal", () => {
    const routePath = path.resolve(__dirname, "../../apps/web/src/app/api/proxy/route.ts");
    expect(fs.existsSync(routePath)).toBe(true);

    const routeCode = fs.readFileSync(routePath, "utf-8");
    expect(routeCode).toContain("export async function GET");
    expect(routeCode).toContain("Missing url parameter");
    expect(routeCode).toContain("<base href=");
    expect(routeCode).toContain("top.location");
  });

  it("AC-3: next.config.ts makes output: export conditional to allow API route handlers in standard builds", () => {
    const nextConfigPath = path.resolve(__dirname, "../../apps/web/next.config.ts");
    const nextConfigCode = fs.readFileSync(nextConfigPath, "utf-8");

    // Must not have an unconditional output: "export"
    expect(nextConfigCode).not.toMatch(/^\s*output:\s*["']export["'],\s*$/m);
    expect(nextConfigCode).toMatch(/STATIC_EXPORT/);
  });

  it("AC-4: InteractiveStage connects iframe src to getArcIframeUrl(arcActiveUrl)", () => {
    const stagePath = path.resolve(__dirname, "../../apps/web/src/features/stage-studio/InteractiveStage.tsx");
    const stageCode = fs.readFileSync(stagePath, "utf-8");

    expect(stageCode).toMatch(/src=\{getArcIframeUrl\(arcActiveUrl\)\}/);
  });
});
