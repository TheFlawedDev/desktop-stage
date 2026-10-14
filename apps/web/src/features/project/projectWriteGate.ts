/**
 * The startup write gate.
 *
 * Until startup restore has read the shelf, the document in memory is the
 * starter scene, not the user's project. Every write path must therefore be
 * gated on the restore settling, and there are three:
 *
 * - the debounced autosave and the `beforeunload` flush refuse to write while
 *   the restore is pending (`useProjectPersistence`);
 * - a manual save (`Ctrl/Cmd+S` → `saveNow`) is different: the user asked for
 *   it, so it waits for the restore rather than racing it.
 *
 * After a *failed* restore the untouched starter must not be written either. It
 * carries a fresh id and a current timestamp, so a record of it would outrank —
 * and so permanently hide — the record that could not be read. Once the user
 * edits, imports, or starts a new project the document is theirs, and it may be
 * written.
 *
 * Kept as a plain module rather than inside the hook so the whole decision is
 * testable without React: none of the write paths need a rendered component to
 * pin their behavior.
 */

/** How far startup restore has got. */
export type RestoreState = "pending" | "restored" | "empty" | "failed";

/**
 * Whether a write may reach the shelf right now.
 *
 * `pending` blocks everything: the shelf has not been read, so the document in
 * memory is still the starter. `failed` blocks too, but only while that starter
 * is untouched — otherwise a fresh-id record with `savedAt = now` would be
 * written beside the record that failed to open and win `loadMostRecentProject`,
 * hiding it for good.
 */
export function mayWriteProject(
  state: RestoreState,
  untouchedStarter: boolean,
): boolean {
  if (state === "pending") return false;
  return !(state === "failed" && untouchedStarter);
}

export class ProjectWriteGate {
  private current: RestoreState = "pending";
  private resolveRestored: () => void = () => {};
  private readonly restored = new Promise<void>((resolve) => {
    this.resolveRestored = resolve;
  });

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
   * Runs one manual save, waiting for the restore first.
   *
   * The save is dropped when {@link mayWriteProject} refuses: either the
   * restore is still reading, or it failed and the document is still the
   * untouched starter. A cancelled restore attempt cannot pin the gate, so it
   * cannot make this decision on the replay's behalf.
   */
  async runManualSave(
    save: () => Promise<void>,
    isUntouchedStarter: () => boolean,
  ): Promise<void> {
    if (this.current === "pending") {
      await this.restored;
    }

    if (!mayWriteProject(this.current, isUntouchedStarter())) return;

    await save();
  }
}

/**
 * Records one restore attempt's outcome in the gate.
 *
 * React development StrictMode mounts the restore effect twice: the cleanup
 * cancels the first attempt, then a live replay starts. The gate is
 * first-settle-wins, so an attempt that has been cancelled must settle nothing.
 * Otherwise the cancelled attempt's `empty`/`failed` outcome is permanent and
 * the replay's real outcome — the document the user is waiting for — is
 * discarded. Returns whether the gate was settled.
 */
export function settleRestoreAttempt(
  gate: ProjectWriteGate,
  cancelled: boolean,
  state: Exclude<RestoreState, "pending">,
): boolean {
  if (cancelled) return false;
  gate.settle(state);
  return true;
}
