/**
 * Tests for the desktop window's pure layout helpers.
 *
 * These cover the decisions that are genuinely testable without a GPU: text
 * measurement and trimming, palette derivation, and where each element of a
 * window lands. The Pixi drawing calls themselves are not asserted — a unit test
 * of "did we call `rect`" would only restate the implementation, and the real
 * check for those is a rendered frame.
 *
 * The module under test imports Pixi for its object half, but the pure helpers
 * exercised here touch none of it beyond the module-level import.
 */

import { describe, expect, it } from "vitest";
import type { DesktopWindowNodePayload } from "@desktop-stage/desktop-engine";
import {
  bodyLineColor,
  clampTextToWidth,
  estimateTextWidth,
  isMonospaceApp,
  layoutDesktopWindow,
  windowPalette,
} from "./desktopWindowGraphics";

function windowPayload(overrides: Partial<DesktopWindowNodePayload> = {}): DesktopWindowNodePayload {
  return {
    instanceId: "app-browser",
    appKind: "browser",
    title: "Studio Dashboard",
    lines: ["A calm place to build scenes."],
    look: {
      accentColor: "#fa9d4c",
      theme: "dark",
      chrome: "window",
      cornerRadius: 8,
      showTitleBar: true,
    },
    width: 380,
    height: 285,
    ...overrides,
  };
}

/** Every text run a layout will draw, at every depth. */
function allTextRuns(layout: ReturnType<typeof layoutDesktopWindow>) {
  return [layout.title, ...layout.toolbarText, ...layout.bodyLines];
}

describe("estimateTextWidth", () => {
  it("is linear in the character count, so a longer string is always wider", () => {
    expect(estimateTextWidth("aaaa", 13)).toBeGreaterThan(estimateTextWidth("aa", 13));
    expect(estimateTextWidth("", 13)).toBe(0);
  });

  it("measures a block of text as wider than the same number of narrow letters", () => {
    expect(estimateTextWidth("mmmm", 13)).toBeGreaterThan(estimateTextWidth("iiii", 13));
  });

  it("counts a double-width character as a full em, so CJK is not under-measured", () => {
    expect(estimateTextWidth("漢字", 13)).toBeCloseTo(26, 5);
    expect(estimateTextWidth("漢字", 13)).toBeGreaterThan(estimateTextWidth("ab", 13));
  });

  it("uses a constant advance for monospace text", () => {
    const oneNarrow = estimateTextWidth("i", 10, true);
    const oneWide = estimateTextWidth("W", 10, true);
    expect(oneNarrow).toBe(oneWide);
    expect(estimateTextWidth("abc", 10, true)).toBeCloseTo(oneNarrow * 3, 5);
  });

  it("expands a tab to a fixed column count rather than measuring it as one character", () => {
    expect(estimateTextWidth("\t", 10, true)).toBeGreaterThan(estimateTextWidth(" ", 10, true));
  });
});

describe("clampTextToWidth", () => {
  it("leaves text that already fits untouched", () => {
    const fitted = clampTextToWidth("short", 500, 13, false);
    expect(fitted.text).toBe("short");
    expect(fitted.truncated).toBe(false);
  });

  it("trims text that does not fit and marks it truncated", () => {
    const fitted = clampTextToWidth("a very long window title indeed", 60, 13, false);
    expect(fitted.truncated).toBe(true);
    expect(fitted.text.length).toBeLessThan("a very long window title indeed".length);
    expect(fitted.text.endsWith("…")).toBe(true);
  });

  it("never reports a width above the room it was given, whenever it trims", () => {
    for (const maxWidth of [10, 25, 60, 120, 240]) {
      const fitted = clampTextToWidth("a very long window title indeed", maxWidth, 13, false);
      if (fitted.text !== "a very long window title indeed") {
        expect(fitted.width).toBeLessThanOrEqual(maxWidth);
      }
    }
  });

  it("returns nothing rather than overflowing when there is no room at all", () => {
    expect(clampTextToWidth("anything", 0, 13, false)).toEqual({ text: "", width: 0, truncated: true });
    expect(clampTextToWidth("anything", -5, 13, false).text).toBe("");
  });

  it("keeps the leading text when even the ellipsis will not fit", () => {
    const fitted = clampTextToWidth("abcdefghij", 8, 13, false);
    expect(fitted.text.startsWith("a")).toBe(true);
    expect(fitted.text.endsWith("…")).toBe(false);
  });
});

describe("windowPalette", () => {
  it("keeps a dark theme dark and a light theme light", () => {
    const dark = windowPalette(windowPayload());
    const light = windowPalette(
      windowPayload({ look: { ...windowPayload().look, theme: "light" } }),
    );

    expect(dark.background).not.toBe(light.background);
    expect(dark.text).not.toBe(light.text);
  });

  it("lifts the authored accent so it stays visible against the chrome", () => {
    const palette = windowPalette(windowPayload());
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.accent).not.toBe("#000000");
  });

  it("accepts a three-digit hex accent", () => {
    const palette = windowPalette(
      windowPayload({ look: { ...windowPayload().look, accentColor: "#0af" } }),
    );
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("falls back instead of drawing nothing when the accent is unreadable", () => {
    const palette = windowPalette(
      windowPayload({ look: { ...windowPayload().look, accentColor: "rebeccapurple" } }),
    );
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.accent).toBe("#7c6cff");
  });
});

describe("layoutDesktopWindow", () => {
  it("draws a titled window chrome with the three window marks", () => {
    const layout = layoutDesktopWindow(windowPayload(), 380, 285);

    expect(layout.showTitleBar).toBe(true);
    expect(layout.titleBarHeight).toBeGreaterThan(0);
    expect(layout.trafficLights).toHaveLength(3);
    expect(layout.title.text).toBe("Studio Dashboard");
  });

  it("omits the chrome entirely for a plain window that hides its title bar", () => {
    const layout = layoutDesktopWindow(
      windowPayload({
        look: { ...windowPayload().look, showTitleBar: false, chrome: "plain" },
      }),
      380,
      285,
    );

    expect(layout.showTitleBar).toBe(false);
    expect(layout.titleBarHeight).toBe(0);
    expect(layout.trafficLights).toHaveLength(0);
    expect(layout.title.text).toBe("");
  });

  it("gives the browser an address pill and the code and terminal windows none", () => {
    const browser = layoutDesktopWindow(windowPayload(), 380, 285);
    const terminal = layoutDesktopWindow(
      windowPayload({ appKind: "terminal", title: "terminal — zsh" }),
      420,
      250,
    );
    const code = layoutDesktopWindow(windowPayload({ appKind: "code", title: "src/login.ts" }), 350, 310);
    const legacy = layoutDesktopWindow(windowPayload({ appKind: "legacyText" }), 245, 205);

    expect(browser.toolbarHeight).toBeGreaterThan(0);
    expect(browser.toolbarRects.length).toBeGreaterThan(0);
    expect(browser.toolbarText.length).toBeGreaterThan(0);

    expect(code.toolbarHeight).toBeGreaterThan(0);
    expect(terminal.toolbarHeight).toBe(0);
    expect(legacy.toolbarHeight).toBe(0);
  });

  it("numbers the lines of a code window and leaves the others unnumbered", () => {
    const lines = ["first", "second"];
    const code = layoutDesktopWindow(windowPayload({ appKind: "code", lines }), 350, 310);
    const terminal = layoutDesktopWindow(
      windowPayload({ appKind: "terminal", lines: ["Session started", "studio@desktop ~ % npm run render"] }),
      420,
      250,
    );

    // Two body lines each, plus one number per line for the code window.
    expect(code.bodyLines).toHaveLength(4);
    expect(code.bodyLines[0]?.text).toBe("1");
    expect(code.bodyLines[2]?.text).toBe("2");
    expect(terminal.bodyLines).toHaveLength(2);
  });

  it("measures the body as monospace only for code and terminal windows", () => {
    expect(isMonospaceApp("code")).toBe(true);
    expect(isMonospaceApp("terminal")).toBe(true);
    expect(isMonospaceApp("browser")).toBe(false);
    expect(isMonospaceApp("legacyText")).toBe(false);
  });

  it("keeps every drawn run inside the window at its authored size", () => {
    for (const appKind of ["browser", "code", "terminal", "legacyText"] as const) {
      const layout = layoutDesktopWindow(
        windowPayload({
          appKind,
          title: "A title long enough that it must be trimmed to fit the chrome",
          lines: ["a line that is comfortably longer than a narrow window can show in one run"],
        }),
        380,
        285,
      );

      for (const run of allTextRuns(layout)) {
        expect(run.x).toBeGreaterThanOrEqual(0);
        expect(run.y).toBeGreaterThanOrEqual(0);
        expect(run.x + estimateTextWidth(run.text, run.fontSize, run.monospace)).toBeLessThanOrEqual(
          layout.width + 1,
        );
        expect(run.y + run.fontSize * 1.5).toBeLessThanOrEqual(layout.height + 1);
      }
    }
  });

  it("keeps every piece of chrome inside the window at its authored size", () => {
    for (const appKind of ["browser", "code", "terminal", "legacyText"] as const) {
      const layout = layoutDesktopWindow(windowPayload({ appKind }), 380, 285);
      const chrome = [layout.background, ...layout.toolbarRects];

      for (const rect of chrome) {
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(layout.width + 1);
        expect(rect.y + rect.height).toBeLessThanOrEqual(layout.height + 1);
      }
    }
  });

  it("drops body lines that would spill past the bottom of a short window", () => {
    const many = Array.from({ length: 200 }, (_, index) => `line ${index}`);
    const layout = layoutDesktopWindow(windowPayload({ appKind: "browser", lines: many }), 380, 285);

    expect(layout.bodyLines.length).toBeGreaterThan(0);
    expect(layout.bodyLines.length).toBeLessThan(many.length);
    const last = layout.bodyLines[layout.bodyLines.length - 1]!;
    expect(last.y + last.fontSize * 1.5).toBeLessThanOrEqual(layout.height + 1);
  });

  it("shows no body text at all when there is no room for any", () => {
    const layout = layoutDesktopWindow(windowPayload(), 380, 1);
    expect(layout.bodyLines).toHaveLength(0);
  });

  it("never returns a zero or negative frame size, even for a degenerate node", () => {
    const layout = layoutDesktopWindow(windowPayload(), 0, 0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("keeps the body below the chrome", () => {
    const layout = layoutDesktopWindow(windowPayload({ appKind: "code" }), 350, 310);
    expect(layout.bodyY).toBe(layout.titleBarHeight + layout.toolbarHeight);
    expect(layout.bodyX).toBeGreaterThan(0);
  });
});

describe("bodyLineColor", () => {
  const payload = windowPayload({ appKind: "terminal" });
  const palette = windowPalette(payload);

  it("accents a shell prompt line so a session reads differently from its output", () => {
    expect(bodyLineColor(payload, palette, "studio@desktop ~ % npm run render")).toBe(palette.accent);
  });

  it("leaves ordinary output in the primary text colour", () => {
    expect(bodyLineColor(payload, palette, "  Desktop Stage ready")).toBe(palette.text);
    expect(bodyLineColor(payload, palette, "")).toBe(palette.text);
  });

  it("never accents a non-terminal window's lines", () => {
    const browser = windowPayload({ appKind: "browser" });
    const browserPalette = windowPalette(browser);
    expect(bodyLineColor(browser, browserPalette, "user@host % nope")).toBe(browserPalette.text);
  });
});
