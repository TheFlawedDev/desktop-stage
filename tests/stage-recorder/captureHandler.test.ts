/**
 * `installStageCaptureHandler` — Electron display-media permission binding.
 *
 * The stage window's capture permission must be granted for exactly one source:
 * the nonempty window ID the main process supplies through `getStageSourceId`,
 * and only for a request frame the main process trusts. Everything else — an
 * empty getter, an unknown source, an untrusted frame, a rejected lookup, or a
 * lookup that was still pending when the handler was disposed — must be denied
 * with an empty result and exactly one callback invocation. There is no name
 * matching and no host-screen fallback.
 */

import { describe, expect, it, vi } from "vitest";
import { installStageCaptureHandler } from "../../packages/desktop-engine/src/stage/recorder/index";

interface Source {
  id: string;
  [key: string]: unknown;
}

type CaptureResult = { video?: unknown; audio?: unknown };
type DisplayMediaHandler = (
  request: { frame: unknown },
  callback: (result: CaptureResult) => void,
) => void;

interface HarnessOptions {
  sources?: Source[];
  sourceId?: string | null;
  trusted?: boolean;
  getSources?: () => Promise<Source[]>;
}

function harness(options: HarnessOptions = {}) {
  const sources: Source[] = options.sources ?? [{ id: "window:1" }, { id: "window:2" }];
  const getSources = vi.fn(options.getSources ?? (async () => sources));
  const desktopCapturer = { getSources };

  let registered: DisplayMediaHandler | undefined;
  const setDisplayMediaRequestHandler = vi.fn((handler: DisplayMediaHandler | null) => {
    registered = handler ?? undefined;
  });
  const session = { setDisplayMediaRequestHandler };

  const getStageSourceId = vi.fn(() =>
    options.sourceId === undefined ? "window:2" : options.sourceId,
  );
  const isTrustedFrame = vi.fn(() => options.trusted ?? true);

  const dispose = installStageCaptureHandler({
    desktopCapturer,
    session,
    getStageSourceId,
    isTrustedFrame,
  });

  return {
    sources,
    getSources,
    setDisplayMediaRequestHandler,
    getStageSourceId,
    isTrustedFrame,
    dispose,
    handler: () => {
      if (!registered) throw new Error("no display media request handler was installed");
      return registered;
    },
  };
}

/** Let the async source lookup settle. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("installStageCaptureHandler — registration", () => {
  it("installs a display media request handler", () => {
    const h = harness();
    expect(h.setDisplayMediaRequestHandler).toHaveBeenCalledTimes(1);
    expect(typeof h.setDisplayMediaRequestHandler.mock.calls[0]![0]).toBe("function");
  });

  it("clears the handler with null when disposed", () => {
    const h = harness();
    h.dispose();
    expect(h.setDisplayMediaRequestHandler).toHaveBeenLastCalledWith(null);
  });

  it("is safe to dispose more than once", () => {
    const h = harness();
    h.dispose();
    expect(() => h.dispose()).not.toThrow();
    expect(h.setDisplayMediaRequestHandler).toHaveBeenLastCalledWith(null);
  });

  it("only asks Electron for window sources", async () => {
    const h = harness();
    const callback = vi.fn();
    h.handler()({ frame: "frame" }, callback);
    await tick();
    expect(h.getSources).toHaveBeenCalledWith({ types: ["window"] });
  });

  it("passes the request frame to the trust predicate", async () => {
    const h = harness();
    const frame = { some: "frame" };
    const callback = vi.fn();
    h.handler()({ frame }, callback);
    await tick();
    expect(h.isTrustedFrame).toHaveBeenCalledWith(frame);
  });
});

describe("installStageCaptureHandler — granting", () => {
  it("grants the exact window source named by the getter", async () => {
    const h = harness();
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledTimes(1);
    const result = callback.mock.calls[0]![0] as CaptureResult;
    expect(result.video).toBe(h.sources[1]);
  });

  it("never grants audio", async () => {
    const h = harness();
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    const result = callback.mock.calls[0]![0] as CaptureResult;
    expect(result.audio).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, "audio")).toBe(false);
  });

  it("matches the id exactly rather than by prefix", async () => {
    const h = harness({
      sources: [{ id: "window:4" }, { id: "window:40" }],
      sourceId: "window:4",
    });
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback.mock.calls[0]![0]).toEqual({ video: h.sources[0] });
  });

  it("ignores sources whose name merely resembles the stage", async () => {
    const h = harness({
      sources: [
        { id: "window:1", name: "Stage" },
        { id: "screen:0", name: "Entire Screen" },
      ],
      sourceId: null,
    });
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({});
  });

  it("never falls back to a host screen source", async () => {
    const h = harness({
      sources: [{ id: "screen:0", name: "Entire Screen" }],
      sourceId: null,
    });
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledWith({});
  });

  it("does not treat a source name as an id", async () => {
    const h = harness({
      sources: [{ id: "window:1", name: "Stage Desktop" }],
      sourceId: "Stage Desktop",
    });
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledWith({});
  });
});

describe("installStageCaptureHandler — denial", () => {
  it("denies when the getter returns null", async () => {
    const h = harness({ sourceId: null });
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({});
  });

  it("denies when the getter returns an empty string", async () => {
    const h = harness({ sourceId: "" });
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledWith({});
  });

  it("denies when the requested source is not present", async () => {
    const h = harness({ sourceId: "window:999" });
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({});
  });

  it("denies an untrusted request frame", async () => {
    const h = harness({ trusted: false });
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]![0]).toEqual({});
  });

  it("denies when the async source lookup fails", async () => {
    const h = harness({
      getSources: () => Promise.reject(new Error("desktopCapturer unavailable")),
    });
    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]![0]).toEqual({});
  });

  it("denies a lookup that resolves after disposal and calls back only once", async () => {
    let resolveSources!: (sources: Source[]) => void;
    const h = harness({
      getSources: () =>
        new Promise<Source[]>((resolve) => {
          resolveSources = resolve;
        }),
    });

    const callback = vi.fn();
    h.handler()({ frame: "f" }, callback);
    h.dispose();
    resolveSources([{ id: "window:2" }]);
    await tick();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]![0]).toEqual({});
  });

  it("does not grant after the handler was disposed", async () => {
    const h = harness();
    const callback = vi.fn();
    const handler = h.handler();
    h.dispose();
    handler({ frame: "f" }, callback);
    await tick();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]![0]).toEqual({});
  });
});
