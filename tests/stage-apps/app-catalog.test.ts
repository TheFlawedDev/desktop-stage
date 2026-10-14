import { describe, expect, expectTypeOf, it } from "vitest";
import type { StageAppKind } from "@cutaway/types";
import {
  APP_DEFINITIONS,
  customizeApp,
} from "../../packages/desktop-engine/src/stage/apps/index";

const DEFAULTS: Record<string, string> = {
  finder: "Finder",
  iterm: "iTerm",
  arc: "Arc",
  quicktime: "QuickTime",
  photobooth: "Photo Booth",
};

describe("APP_DEFINITIONS", () => {
  it("lists the five predefined apps with their default names", () => {
    const byKind = new Map(APP_DEFINITIONS.map((definition) => [definition.kind, definition.name]));
    expect(byKind).toEqual(new Map(Object.entries(DEFAULTS)));
    expect(APP_DEFINITIONS).toHaveLength(5);
  });

  it("matches the catalog entry shape", () => {
    expectTypeOf<(typeof APP_DEFINITIONS)[number]>().toMatchTypeOf<{
      kind: StageAppKind;
      name: string;
      iconUri?: string;
    }>();
  });
});

describe("customizeApp", () => {
  it("returns the predefined defaults when no options are given", () => {
    for (const [kind, name] of Object.entries(DEFAULTS)) {
      const result = customizeApp(kind as StageAppKind);
      expect(result).toEqual({ kind, name });
      expect(result.iconUri).toBeUndefined();
    }
  });

  it("matches the documented return shape", () => {
    expectTypeOf(customizeApp).returns.toMatchTypeOf<{
      kind: StageAppKind;
      name: string;
      iconUri?: string;
    }>();
  });

  it("uses a trimmed custom name", () => {
    expect(customizeApp("finder", { name: "  My Files  " })).toEqual({
      kind: "finder",
      name: "My Files",
    });
    expect(customizeApp("iterm", { name: "Shell" }).name).toBe("Shell");
  });

  it("enforces the 80-character limit", () => {
    const max = "a".repeat(80);
    expect(customizeApp("finder", { name: max }).name).toBe(max);
    expect(() => customizeApp("finder", { name: "a".repeat(81) })).toThrow();
  });

  it("rejects blank names and control characters", () => {
    for (const name of ["", "   ", "\t", "bad\u0000name", "bad\nname", "bad\u0007name"]) {
      expect(() => customizeApp("finder", { name })).toThrow();
    }
  });

  it("only supports the predefined apps", () => {
    expect(() => customizeApp("custom")).toThrow();
    expect(() => customizeApp("custom", { name: "Mine" })).toThrow();
    expect(() => customizeApp("unknown" as StageAppKind)).toThrow();
  });

  it("accepts only safe blob or raster-data icons", () => {
    const allowed = [
      "blob:https://app.example/icon-1",
      "data:image/png;base64,iVBORw0KGgo=",
      "data:image/jpeg;base64,/9j/4AAQ==",
      "data:image/gif;base64,R0lGODlh",
      "data:image/webp;base64,UklGRg==",
    ];
    for (const iconUri of allowed) {
      expect(customizeApp("finder", { iconUri }).iconUri).toBe(iconUri);
    }

    const rejected = [
      "",
      "https://evil.example/icon.png",
      "http://evil.example/icon.png",
      "file:///icon.png",
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png,not-base64",
      "data:text/html;base64,PHNjcmlwdD4=",
      "blob:bad\u0000value",
    ];
    for (const iconUri of rejected) {
      expect(() => customizeApp("finder", { iconUri })).toThrow();
    }
  });

  it("does not mutate the catalog", () => {
    const before = JSON.parse(JSON.stringify(APP_DEFINITIONS));
    customizeApp("finder", { name: "Renamed", iconUri: "blob:https://app.example/x" });
    customizeApp("arc", { name: "Browser" });
    expect(JSON.parse(JSON.stringify(APP_DEFINITIONS))).toEqual(before);
    expect(customizeApp("finder")).not.toBe(
      APP_DEFINITIONS.find((definition) => definition.kind === "finder"),
    );
  });
});
