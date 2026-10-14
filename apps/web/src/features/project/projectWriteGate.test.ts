/**
 * Tests for the startup write gate.
 *
 * These pin the one write path the persistence audit found ungated: a manual
 * save (`Ctrl/Cmd+S` → `saveNow`) fired inside the startup window. Before the
 * gate, that wrote the in-memory starter — a fresh id with `savedAt = now` —
 * so retrieval by highest `savedAt` made the project being restored permanently
 * unreachable.
 */

import { describe, expect, it, vi } from "vitest";
import { ProjectWriteGate } from "./projectWriteGate";

describe("ProjectWriteGate", () => {
  it("blocks a save requested before the restore settles", async () => {
    const onSkipped = vi.fn();
    const gate = new ProjectWriteGate(onSkipped);
    const write = vi.fn(async () => {});

    const outcome = gate.runManualSave(write);

    // Nothing may be written while the restore is still reading the shelf.
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();

    gate.settle("restored");

    await expect(outcome).resolves.toBe("written");
    expect(write).toHaveBeenCalledTimes(1);
    expect(onSkipped).not.toHaveBeenCalled();
  });

  it("writes immediately once the restore has settled", async () => {
    const gate = new ProjectWriteGate(() => {});
    gate.settle("restored");

    const write = vi.fn(async () => {});
    await expect(gate.runManualSave(write)).resolves.toBe("written");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("skips a save requested after a failed restore", async () => {
    const onSkipped = vi.fn();
    const gate = new ProjectWriteGate(onSkipped);
    gate.settle("failed");

    const write = vi.fn(async () => {});
    await expect(gate.runManualSave(write)).resolves.toBe("skipped");

    expect(write).not.toHaveBeenCalled();
    expect(onSkipped).toHaveBeenCalledTimes(1);
  });

  it("skips a save that was waiting when the restore failed", async () => {
    const onSkipped = vi.fn();
    const gate = new ProjectWriteGate(onSkipped);
    const write = vi.fn(async () => {});

    const outcome = gate.runManualSave(write);
    gate.settle("failed");

    await expect(outcome).resolves.toBe("skipped");
    expect(write).not.toHaveBeenCalled();
    expect(onSkipped).toHaveBeenCalledTimes(1);
  });

  it("settles once, so a later settle cannot reopen the gate", async () => {
    const gate = new ProjectWriteGate(() => {});
    gate.settle("empty");
    gate.settle("failed");

    expect(gate.state).toBe("empty");
  });

  it("does not settle until something settles it", async () => {
    const gate = new ProjectWriteGate(() => {});
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
