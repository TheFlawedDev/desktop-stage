import { describe, expect, it } from "vitest";
import type { Rect } from "@cutaway/types";
import { ArcController } from "../../packages/desktop-engine/src/stage/apps/index";
import type {
  ArcView,
  ArcViewFactory,
  ArcViewOptions,
} from "../../packages/desktop-engine/src/stage/apps/index";

class FakeArcView implements ArcView {
  readonly loaded: string[] = [];
  bounds: Rect | null = null;
  muted: boolean | null = null;
  destroyCalls = 0;
  backCalls = 0;
  forwardCalls = 0;
  reloadCalls = 0;
  canBack = false;
  canForward = false;
  loadImpl: (url: string) => Promise<void> = () => Promise.resolve();

  async loadURL(url: string): Promise<void> {
    this.loaded.push(url);
    await this.loadImpl(url);
  }

  goBack(): void {
    this.backCalls += 1;
  }

  goForward(): void {
    this.forwardCalls += 1;
  }

  reload(): void {
    this.reloadCalls += 1;
  }

  canGoBack(): boolean {
    return this.canBack;
  }

  canGoForward(): boolean {
    return this.canForward;
  }

  setAudioMuted(muted: boolean): void {
    this.muted = muted;
  }

  setBounds(rect: Rect): void {
    this.bounds = rect;
  }

  destroy(): void {
    this.destroyCalls += 1;
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness() {
  const views: FakeArcView[] = [];
  const optionSets: ArcViewOptions[] = [];
  let loadImpl: ((url: string) => Promise<void>) | undefined;

  const factory: ArcViewFactory = (options) => {
    optionSets.push(options);
    const view = new FakeArcView();
    if (loadImpl) view.loadImpl = loadImpl;
    views.push(view);
    return view;
  };
  const controller = new ArcController(factory);
  return {
    controller,
    views,
    optionSets,
    /** The adapter view, which may be created eagerly or on first use. */
    view: () => views[0] as FakeArcView,
    options: () => optionSets[0] as ArcViewOptions,
    /** Controls load completion whether or not the view already exists. */
    setLoadImpl(impl: (url: string) => Promise<void>) {
      loadImpl = impl;
      if (views[0]) views[0].loadImpl = impl;
    },
  };
}

describe("ArcController", () => {
  describe("URL validation before the adapter is touched", () => {
    const rejected = [
      "",
      "   ",
      "not a url",
      "//example.com/",
      "/relative",
      "https://",
      "https://exa mple.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<h1>hi</h1>",
      "ftp://example.com/",
      "blob:https://example.com/id",
      "about:blank",
      "https://user:secret@example.com/",
      "https://user@example.com/",
    ];

    it("rejects everything that is not an absolute http(s) URL with a host", async () => {
      for (const url of rejected) {
        const { controller, views } = harness();
        await expect(controller.navigate(url)).rejects.toThrow();
        // The view may be created eagerly, but it must never be asked to load.
        expect(views.every((view) => view.loaded.length === 0)).toBe(true);
        expect(controller.currentUrl).toBeNull();
      }
    });

    it("accepts absolute http and https URLs", async () => {
      const { controller, view } = harness();
      await expect(controller.navigate("https://example.com/path")).resolves.toBeUndefined();
      expect(controller.currentUrl).toBe("https://example.com/path");
      expect(view().loaded).toEqual(["https://example.com/path"]);

      await expect(controller.navigate("http://localhost:3000/")).resolves.toBeUndefined();
      expect(controller.currentUrl).toBe("http://localhost:3000/");
      expect(view().loaded).toHaveLength(2);
    });
  });

  describe("isolation options", () => {
    it("passes immutable, locked-down web preferences", async () => {
      const { controller, options } = harness();
      await controller.navigate("https://example.com/");

      const prefs = options().webPreferences;
      expect(prefs).toEqual({
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      });
      expect(Object.isFrozen(prefs)).toBe(true);
    });

    it("reuses the same allowlist for adapter-driven navigation", async () => {
      const { controller, options } = harness();
      await controller.navigate("https://example.com/");
      const allowed = options().navigationAllowed;

      expect(allowed("https://example.com/next")).toBe(true);
      expect(allowed("http://other.test/")).toBe(true);
      expect(allowed("file:///etc/passwd")).toBe(false);
      expect(allowed("javascript:alert(1)")).toBe(false);
      expect(allowed("data:text/html,x")).toBe(false);
      expect(allowed("https://user:secret@example.com/")).toBe(false);
      expect(allowed("not a url")).toBe(false);
    });

    it("denies every permission, download and popup by default", async () => {
      const { controller, options } = harness();
      await controller.navigate("https://example.com/");
      const config = options();

      for (const permission of ["media", "geolocation", "notifications", "clipboard-read"]) {
        expect(config.permissionAllowed(permission)).toBe(false);
      }
      expect(config.downloadAllowed("https://example.com/file.zip")).toBe(false);
      expect(config.popupAllowed("https://example.com/")).toBe(false);
    });
  });

  describe("navigation state", () => {
    it("only publishes currentUrl after a successful load", async () => {
      const { controller, setLoadImpl } = harness();
      const gate = deferred();
      setLoadImpl(() => gate.promise);

      const pending = controller.navigate("https://example.com/slow");
      await Promise.resolve();
      expect(controller.currentUrl).toBeNull();

      gate.resolve();
      await pending;
      expect(controller.currentUrl).toBe("https://example.com/slow");
    });

    it("keeps the previous URL when a load fails", async () => {
      const { controller, setLoadImpl } = harness();
      await controller.navigate("https://example.com/ok");

      setLoadImpl(() => Promise.reject(new Error("net down")));
      await expect(controller.navigate("https://example.com/broken")).rejects.toThrow();
      expect(controller.currentUrl).toBe("https://example.com/ok");
    });

    it("does not let a late completion overwrite the latest navigation", async () => {
      const { controller, setLoadImpl } = harness();
      const first = deferred();
      const second = deferred();
      setLoadImpl((url) => (url.includes("one") ? first.promise : second.promise));

      const p1 = controller.navigate("https://one.test/");
      const p2 = controller.navigate("https://two.test/");
      await Promise.resolve();

      second.resolve();
      await p2;
      expect(controller.currentUrl).toBe("https://two.test/");

      first.resolve();
      await p1;
      expect(controller.currentUrl).toBe("https://two.test/");
    });

    it("never updates state from a navigation that outlives disposal", async () => {
      const { controller, setLoadImpl } = harness();
      const gate = deferred();
      setLoadImpl(() => gate.promise);

      const pending = controller.navigate("https://example.com/late");
      await Promise.resolve();
      controller.dispose();

      gate.resolve();
      await expect(pending).resolves.toBeUndefined();
      expect(controller.currentUrl).toBeNull();
    });
  });

  describe("history and reload", () => {
    it("checks capability before going back or forward", async () => {
      const { controller, view } = harness();
      await controller.navigate("https://example.com/");

      controller.back();
      controller.forward();
      expect(view().backCalls).toBe(0);
      expect(view().forwardCalls).toBe(0);

      view().canBack = true;
      view().canForward = true;
      controller.back();
      controller.forward();
      expect(view().backCalls).toBe(1);
      expect(view().forwardCalls).toBe(1);
    });

    it("forwards reload", async () => {
      const { controller, view } = harness();
      await controller.navigate("https://example.com/");
      controller.reload();
      expect(view().reloadCalls).toBe(1);
    });
  });

  describe("bounds and audio", () => {
    it("copies valid bounds into the adapter", async () => {
      const { controller, view } = harness();
      await controller.navigate("https://example.com/");

      const rect: Rect = { x: 10, y: 20, width: 640, height: 480 };
      controller.setBounds(rect);
      rect.width = 9999;
      expect(view().bounds).toEqual({ x: 10, y: 20, width: 640, height: 480 });
    });

    it("rejects non-finite or non-positive bounds", async () => {
      const { controller, view } = harness();
      await controller.navigate("https://example.com/");

      const invalid: Rect[] = [
        { x: 0, y: 0, width: 0, height: 100 },
        { x: 0, y: 0, width: 100, height: 0 },
        { x: 0, y: 0, width: -5, height: 100 },
        { x: 0, y: 0, width: 100, height: -5 },
        { x: 0, y: 0, width: Number.NaN, height: 100 },
        { x: 0, y: 0, width: 100, height: Number.POSITIVE_INFINITY },
      ];
      for (const rect of invalid) {
        expect(() => controller.setBounds(rect)).toThrow();
      }
      expect(view().bounds).toBeNull();
    });

    it("mutes and unmutes the adapter", async () => {
      const { controller, view } = harness();
      await controller.navigate("https://example.com/");

      controller.setMuted(true);
      expect(view().muted).toBe(true);
      controller.setMuted(false);
      expect(view().muted).toBe(false);
    });

    it("forces mute while recording and restores the requested mute after", async () => {
      const { controller, view } = harness();
      await controller.navigate("https://example.com/");

      controller.setRecording(true);
      expect(view().muted).toBe(true);
      controller.setMuted(false);
      expect(view().muted).toBe(true);

      controller.setRecording(false);
      expect(view().muted).toBe(false);
    });

    it("restores a user-requested mute when recording stops", async () => {
      const { controller, view } = harness();
      await controller.navigate("https://example.com/");

      controller.setMuted(true);
      controller.setRecording(true);
      controller.setRecording(false);
      expect(view().muted).toBe(true);
    });
  });

  describe("dispose", () => {
    it("destroys the adapter exactly once", async () => {
      const { controller, view } = harness();
      await controller.navigate("https://example.com/");

      controller.dispose();
      controller.dispose();
      expect(view().destroyCalls).toBe(1);
    });

    it("is safe before any navigation", () => {
      const { controller, views } = harness();
      expect(() => {
        controller.dispose();
        controller.dispose();
      }).not.toThrow();
      expect(views.length).toBeLessThanOrEqual(1);
      expect(views.every((view) => view.destroyCalls <= 1)).toBe(true);
    });

    it("makes every other method fail clearly", async () => {
      const { controller } = harness();
      await controller.navigate("https://example.com/");
      controller.dispose();

      await expect(controller.navigate("https://example.com/again")).rejects.toThrow();
      expect(() => controller.back()).toThrow();
      expect(() => controller.forward()).toThrow();
      expect(() => controller.reload()).toThrow();
      expect(() => controller.setBounds({ x: 0, y: 0, width: 10, height: 10 })).toThrow();
      expect(() => controller.setMuted(true)).toThrow();
      expect(() => controller.setRecording(true)).toThrow();
    });
  });
});
