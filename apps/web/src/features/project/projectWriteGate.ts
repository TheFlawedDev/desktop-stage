/**
 * The startup write gate.
 *
 * Until startup restore has read the shelf, the document in memory is the
 * starter scene, not the user's project. Every write path must therefore be
 * gated on the restore settling, and the gate has three writers to cover:
 *
 * - the debounced autosave and the `beforeunload` flush simply refuse to write
 *   while the restore is pending (`useProjectPersistence`);
 * - a manual save (`Ctrl/Cmd+S` → `saveNow`) is different: the user asked for
 *   it, so silently doing nothing would look like a broken shortcut. It waits
 *   for the restore to settle, then reports either "written" or "skipped".
 *
 * The waiting is the same promise on every call, so a keypress during startup
 * can never run two writes or race the restore itself.
 *
 * Kept as a plain class rather than inside the hook so the whole decision is
 * testable without React: `saveNow`'s guard is the one write path the audit
 * found completely untested.
 */

/** How far startup restore has got. */
export type RestoreState = "pending" | "restored" | "empty" | "failed";

/** What a manual save actually did. */
export type ManualSaveOutcome = "written" | "skipped";

export class ProjectWriteGate {
  private current: RestoreState = "pending";
  private resolveRestored: () => void = () => {};
  private readonly restored = new Promise<void>((resolve) => {
    this.resolveRestored = resolve;
  });

  constructor(private readonly onSkipped: () => void) {}

  get state(): RestoreState {
    return this.current;
  }

  /**
   * Records where the restore ended. The first call wins: a later call cannot
   * re-open the gate or settle it twice.
   */
  settle(state: Exclude<RestoreState, "pending">): void {
    if (this.current !== "pending") return;
    this.current = state;
    this.resolveRestored();
  }

  /** Resolves once startup restore has settled, however it settled. */
  whenRestored(): Promise<void> {
    return this.restored;
  }

  /**
   * Runs one manual save, but only once the restore has settled.
   *
   * A save requested while the restore is still reading waits for it rather
   * than writing the starter document into the shelf. A save requested after a
   * *failed* or *empty* restore is still skipped: the starter's fresh id would
   * create a record the user never authored, shadowing the stored one that
   * could not be read.
   */
  async runManualSave(save: () => Promise<void>): Promise<ManualSaveOutcome> {
    if (this.current === "pending") {
      await this.restored;
    }

    // Re-read the state after waiting: the restore may have failed while the
    // keypress was queued, and that is exactly the case this gate exists for.
    if (this.current !== "restored" && this.current !== "empty") {
      this.onSkipped();
      return "skipped";
    }

    await save();
    return "written";
  }
}
