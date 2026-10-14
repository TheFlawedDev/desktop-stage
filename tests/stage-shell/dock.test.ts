import { describe, expect, it } from "vitest";
import {
  STAGE_DOCK_APPS,
  activateDockApp,
} from "../../packages/desktop-engine/src/stage/shell/index";
import type { StageAppKind } from "@cutaway/types";
import { focusedId, makeManager, windowById, zIndexOf } from "./helpers";

const EXPECTED_DOCK: Array<{ appKind: StageAppKind; title: string }> = [
  { appKind: "finder", title: "Finder" },
  { appKind: "iterm", title: "iTerm" },
  { appKind: "arc", title: "Arc" },
  { appKind: "quicktime", title: "QuickTime" },
  { appKind: "photobooth", title: "Photo Booth" },
];

describe("STAGE_DOCK_APPS", () => {
  it("lists the five dock apps in the documented order with titles", () => {
    expect(STAGE_DOCK_APPS.map((app) => ({ appKind: app.appKind, title: app.title }))).toEqual(
      EXPECTED_DOCK
    );
  });

  it("exposes only appKind and title on each entry", () => {
    for (const entry of STAGE_DOCK_APPS) {
      expect(Object.keys(entry).sort()).toEqual(["appKind", "title"]);
    }
  });

  it("is a frozen, immutable array of frozen entries", () => {
    expect(Array.isArray(STAGE_DOCK_APPS)).toBe(true);
    expect(Object.isFrozen(STAGE_DOCK_APPS)).toBe(true);
    for (const entry of STAGE_DOCK_APPS) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it("is not affected by attempted mutation of an entry", () => {
    const titleBefore = STAGE_DOCK_APPS[0]!.title;
    try {
      (STAGE_DOCK_APPS[0] as { title: string }).title = "Tampered";
    } catch {
      // A frozen object throws in strict mode; either way the value must hold.
    }
    expect(STAGE_DOCK_APPS[0]!.title).toBe(titleBefore);
  });
});

describe("activateDockApp", () => {
  it.each(EXPECTED_DOCK)("opens $appKind when no matching window exists", ({ appKind, title }) => {
    const manager = makeManager();

    const window = activateDockApp(manager, appKind);

    expect(window.appKind).toBe(appKind);
    expect(window.title).toBe(title);
    expect(window.isFocused).toBe(true);
    expect(window.isMinimized).toBe(false);
    expect(manager.getWindows().map((w) => w.id)).toEqual([window.id]);
    expect(focusedId(manager)).toBe(window.id);
  });

  it("focuses an existing matching window instead of opening a second one", () => {
    const manager = makeManager();
    const finder = manager.openApp("finder");
    const iterm = manager.openApp("iterm");

    const activated = activateDockApp(manager, "finder");

    expect(manager.getWindows()).toHaveLength(2);
    expect(manager.getWindows().filter((w) => w.appKind === "finder")).toHaveLength(1);
    expect(activated.id).toBe(finder.id);
    expect(windowById(manager, finder.id).isFocused).toBe(true);
    expect(windowById(manager, iterm.id).isFocused).toBe(false);
    expect(zIndexOf(manager, finder.id)).toBeGreaterThan(zIndexOf(manager, iterm.id));
  });

  it("does not duplicate an app across repeated activation", () => {
    const manager = makeManager();

    const first = activateDockApp(manager, "arc");
    const second = activateDockApp(manager, "arc");
    const third = activateDockApp(manager, "arc");

    expect(first.id).toBe(second.id);
    expect(second.id).toBe(third.id);
    expect(manager.getWindows()).toHaveLength(1);
  });

  it("restores and focuses a minimized matching window", () => {
    const manager = makeManager();
    const finder = manager.openApp("finder");
    manager.minimizeWindow(finder.id);

    const activated = activateDockApp(manager, "finder");

    expect(manager.getWindows()).toHaveLength(1);
    expect(activated.id).toBe(finder.id);
    expect(activated.isMinimized).toBe(false);
    expect(activated.isFocused).toBe(true);
    expect(windowById(manager, finder.id).isMinimized).toBe(false);
    expect(focusedId(manager)).toBe(finder.id);
  });

  it("activates the highest-zIndex matching window when duplicates exist", () => {
    const manager = makeManager();
    const firstFinder = manager.openApp("finder", { x: 0, y: 0 });
    const iterm = manager.openApp("iterm", { x: 300, y: 0 });
    const secondFinder = manager.openApp("finder", { x: 600, y: 0 });
    // Push both finders below iTerm so activation has to both pick the right
    // duplicate and bring it back on top.
    manager.focusWindow(iterm.id);

    const activated = activateDockApp(manager, "finder");

    expect(manager.getWindows()).toHaveLength(3);
    expect(activated.id).toBe(secondFinder.id);
    expect(windowById(manager, secondFinder.id).isFocused).toBe(true);
    expect(windowById(manager, firstFinder.id).isFocused).toBe(false);
    expect(zIndexOf(manager, secondFinder.id)).toBeGreaterThan(zIndexOf(manager, iterm.id));
  });

  it("returns a defensive snapshot of the final state", () => {
    const manager = makeManager();
    activateDockApp(manager, "quicktime");

    const snapshot = activateDockApp(manager, "quicktime");
    snapshot.rect.x = 424242;
    snapshot.title = "changed";
    snapshot.isFocused = false;

    const stored = windowById(manager, snapshot.id);
    expect(stored.rect.x).not.toBe(424242);
    expect(stored.title).toBe("QuickTime");
    expect(stored.isFocused).toBe(true);
  });

  it("opens a dock app that is not one of the fixed five", () => {
    const manager = makeManager();

    const custom = activateDockApp(manager, "custom");

    expect(custom.appKind).toBe("custom");
    expect(custom.title).toBe("Custom");
    expect(manager.getWindows()).toHaveLength(1);
  });
});
