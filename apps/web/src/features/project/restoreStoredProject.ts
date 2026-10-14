/**
 * Bringing a stored document back into the editor.
 *
 * IndexedDB is not a trusted input: a record can have been written by a newer
 * build, by an older one that never stamped a schema version, or edited by hand
 * in DevTools. It therefore goes through the same migrate-then-validate chain as
 * a file on disk, so the editor only ever renders a document the validator has
 * repaired, and anything that was repaired or dropped is reported to the user
 * instead of silently rendering wrong.
 *
 * Two differences from a file matter, and they are deliberate:
 *
 * 1. **A record that is not a document fails the restore.** For a file, a
 *    non-record is rejected by the parser before the validator ever runs. A
 *    stored record has no such gate: `validateProject` is total and would accept
 *    `null` as a fresh empty project, which would open an empty editor and then
 *    autosave it as a *second* record, orphaning the one it could not
 *    understand. The same holds for a record with no usable `id`. Both are
 *    reported as failures so the original record survives untouched.
 * 2. **Anything repaired is opened as a fresh-id copy.** The record is the only
 *    copy of the document, and the restore is followed by an autosave about a
 *    second later. Writing the repaired document back over the original would
 *    destroy the bytes the repair came from, with no user action and no backup.
 *    So a repaired or future-schema document keeps its contents but gets a new
 *    id, and the next autosave therefore creates a new record beside the
 *    original rather than on top of it.
 *
 * Kept separate from the persistence hook so the whole decision is a pure
 * function that can be tested without a browser.
 */

import {
  migrateDocument,
  validateProject,
  type RawDocument,
} from "@cutaway/project-io";
import type { ProjectDocument } from "@cutaway/types";
import { createId } from "@cutaway/utils";

/** Shown when the restored document could not be used as-is. */
export const RESTORE_RECOVERED_MESSAGE =
  "The saved project needed repairs, so this session opened a repaired copy under a new id. The original stored version was left untouched.";

export interface RestoredStoredProject {
  project: ProjectDocument;
  /** Human-readable log: migrations applied, then every repair or drop. */
  issues: string[];
  /** True when the stored document is newer than this build understands. */
  fromFuture: boolean;
  /**
   * True when the document was migrated, repaired, or written by a newer build,
   * and `project.id` is therefore a fresh id that must not overwrite the record
   * it came from.
   */
  recovered: boolean;
}

export type RestoreStoredResult =
  { ok: true; restored: RestoredStoredProject } | { ok: false; error: string };

/** Overrides the id of a document the restore had to repair. */
export interface RestoreStoredOptions {
  /** Mints the recovered copy's id; injectable so tests can pin it. */
  createProjectId?: () => string;
}

const NOT_A_DOCUMENT_ERROR =
  "The saved project is not a project document, so it was not loaded. The stored copy was left untouched.";

const MISSING_ID_ERROR =
  "The saved project has no usable project id, so it was not loaded. The stored copy was left untouched.";

function isRecord(value: unknown): value is RawDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultProjectId(): string {
  return createId("project");
}

/**
 * Migrates and validates one stored record.
 *
 * Never throws, and never returns a document the validator has not seen. A
 * record that cannot be read at all reports `ok: false`; the caller must then
 * leave it untouched rather than saving over it.
 */
export function restoreStoredProject(
  raw: unknown,
  options: RestoreStoredOptions = {},
): RestoreStoredResult {
  try {
    // Checked before migration because neither can be repaired into the record
    // the user actually stored: the validator would substitute a fresh id, and
    // the session would then autosave an empty document as a second record.
    if (!isRecord(raw)) {
      return { ok: false, error: NOT_A_DOCUMENT_ERROR };
    }
    if (typeof raw.id !== "string" || raw.id.length === 0) {
      return { ok: false, error: MISSING_ID_ERROR };
    }

    const issues: string[] = [];
    const migrated = migrateDocument(raw);
    const { project, issues: validationIssues } = validateProject(
      migrated.document,
    );

    issues.push(...migrated.applied.map((entry) => `Migrated: ${entry}`));
    issues.push(...validationIssues.map((issue) => issue.message));

    // A migration ran, the validator repaired or dropped something, or the
    // record came from a build this one does not fully understand. In every case
    // the restored document is not byte-identical to what is stored, so it must
    // be saved as a copy rather than over the original.
    const recovered =
      migrated.applied.length > 0 ||
      validationIssues.length > 0 ||
      migrated.fromFuture;

    return {
      ok: true,
      restored: {
        project: recovered
          ? { ...project, id: recoveredProjectId(options) }
          : project,
        issues,
        fromFuture: migrated.fromFuture,
        recovered,
      },
    };
  } catch (error) {
    // `validateProject` is written to be total, but this is the last line of
    // defence before a stored record reaches the editor: a failure here must be
    // a reported load error, not a crash on startup.
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `The saved project could not be read: ${detail}`,
    };
  }
}

function recoveredProjectId(options: RestoreStoredOptions): string {
  return (options.createProjectId ?? defaultProjectId)();
}
