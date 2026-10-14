/**
 * Bringing a stored document back into the editor.
 *
 * IndexedDB is not a trusted input: a record can have been written by a newer
 * build, by an older one that never stamped a schema version, or by a partial
 * write. It therefore goes through exactly the same migrate-then-validate path
 * as a file on disk, so the editor only ever renders a document the validator
 * has repaired, and anything that was repaired or dropped is reported to the
 * user instead of silently rendering wrong.
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

export interface RestoredStoredProject {
  project: ProjectDocument;
  /** Human-readable log: migrations applied, then every repair or drop. */
  issues: string[];
  /** True when the stored document is newer than this build understands. */
  fromFuture: boolean;
}

export type RestoreStoredResult =
  | { ok: true; restored: RestoredStoredProject }
  | { ok: false; error: string };

function isRecord(value: unknown): value is RawDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Migrates and validates one stored record.
 *
 * Never throws, and never returns a document the validator has not seen. A
 * record that cannot even be migrated reports `ok: false`; the caller must then
 * leave it untouched rather than saving over it.
 */
export function restoreStoredProject(raw: unknown): RestoreStoredResult {
  try {
    const issues: string[] = [];
    let candidate: unknown = raw;
    let fromFuture = false;

    // Only a record can be migrated; anything else is handed straight to the
    // validator, which reports it and returns an empty project.
    if (isRecord(raw)) {
      const migrated = migrateDocument(raw);
      candidate = migrated.document;
      fromFuture = migrated.fromFuture;
      issues.push(...migrated.applied.map((entry) => `Migrated: ${entry}`));
    }

    const { project, issues: validationIssues } = validateProject(candidate);

    return {
      ok: true,
      restored: {
        project,
        issues: [...issues, ...validationIssues.map((issue) => issue.message)],
        fromFuture,
      },
    };
  } catch (error) {
    // `validateProject` is written to be total, but this is the last line of
    // defence before a stored record reaches the editor: a failure here must be
    // a reported load error, not a crash on startup.
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `The saved project could not be read: ${detail}` };
  }
}
