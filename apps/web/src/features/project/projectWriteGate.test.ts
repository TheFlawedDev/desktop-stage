/**
 * Tests for the startup write gate.
 *
 * These pin the three write paths the persistence audit found mis-gated: a
 * manual save (`Ctrl/Cmd+S` → `saveNow`) fired inside the startup window, the
 * automatic writers after a *failed* restore, and the settle itself when React
 * development StrictMode replays the restore effect.
 */

import { describe, expect, it, vi } from "vitest";
import {
  ProjectWriteGate,
  mayWriteProject,
  settleRestoreAttempt,
} from "./projectWriteGate";

describe("mayWriteProject", () => {
  it("blocks every write while the restore is pending", () => {
    expect(mayWriteProject("pending", false)).toBe(false);
    expect(mayWriteProject("pending", true)).toBe(false);
  });

  it("allows writes once the restore settled restored or empty", () => {
    expect(mayWriteProject("restored", false)).toBe(true);
    expect(mayWriteProject("empty", false)).toBe(true);
    expect(mayWriteProject("empty", true)).toBe(true);
  });

  it("blocks the untouched starter after a failed restore", () => {
    // Writing it would create a fresh-id record with `savedAt = now` that wins
    // `loadMostRecentProject` and hides the record that failed to open.
    expect(mayWriteProject("failed", true)).toBe(false);
  });

  it("allows writes after a failed restore once the document changed", () => {
    expect(mayWriteProject("failed", false)).toBe(true);
  });
});

describe("settleRestoreAttempt", () => {
  it("settles nothing from a cancelled attempt", () => {
    const gate = new ProjectWriteGate();

    expect(settleRestoreAttempt(gate, true, "failed")).toBe(false);
    expect(settleRestoreAttempt(gate, true, "empty")).toBe(false);
    expect(gate.state).toBe("pending");
  });

  it("lets the live replay settle after a cancelled attempt finishes first", () => {
    const gate = new ProjectWriteGate();

    // StrictMode mounts the restore effect twice: the first mount's cleanup
    // cancels its attempt and a replay starts. The cancelled attempt's read
    // resolves first, and the gate is first-settle-wins — so if it settled, the
    // replay's real outcome could never land and the restored document would be
    // gated off as a failure.
    expect(settleRestoreAttempt(gate, true, "failed")).toBe(false);
    expect(gate.state).toBe("pending");

    expect(settleRestoreAttempt(gate, false, "restored")).toBe(true);
    expect(gate.state).toBe("restored");
  });
});

describe("ProjectWriteGate", () => {
  it("blocks a save requested before the restore settles", async () => {
    const gate = new ProjectWriteGate();
    const write = vi.fn(async () => {});

    const outcome = gate.runManualSave(write, () => false);

    // Nothing may be written while the restore is still reading the shelf.
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();

    gate.settle("restored");

    await expect(outcome).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("writes immediately once the restore has settled", async () => {
    const gate = new ProjectWriteGate();
    gate.settle("restored");

    const write = vi.fn(async () => {});
    await gate.runManualSave(write, () => false);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("skips a manual save of the untouched starter after a failed restore", async () => {
    const gate = new ProjectWriteGate();
    gate.settle("failed");

    const write = vi.fn(async () => {});
    await gate.runManualSave(write, () => true);

    expect(write).not.toHaveBeenCalled();
  });

  it("skips a save that was waiting when the restore failed", async () => {
    const gate = new ProjectWriteGate();
    const write = vi.fn(async () => {});

    const outcome = gate.runManualSave(write, () => true);
    gate.settle("failed");

    await expect(outcome).resolves.toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it("writes a manual save after a failed restore once the document changed", async () => {
    const gate = new ProjectWriteGate();
    gate.settle("failed");

    const write = vi.fn(async () => {});
    await gate.runManualSave(write, () => false);

    expect(write).toHaveBeenCalledTimes(1);
  });

  it("settles once, so a later settle cannot reopen the gate", async () => {
    const gate = new ProjectWriteGate();
    gate.settle("empty");
    gate.settle("failed");

    expect(gate.state).toBe("empty");
  });

  it("does not settle until something settles it", async () => {
    const gate = new ProjectWriteGate();
    expect(gate.state).toBe("pending");

    let resolved = false;
    void gate.whenRestored().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    gate.settle("restored");
    await expect(gate.whenRestored()).resolves.toBeUndefined();
  });
});
