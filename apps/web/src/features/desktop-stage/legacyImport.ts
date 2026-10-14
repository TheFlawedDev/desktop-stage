"use client";

/**
 * Bringing a prototype version 1 project into the current editor.
 *
 * The old app kept its document under `desktop-stage-project-v1` in
 * `localStorage`, and users also have copies of it as exported JSON. This module
 * owns the two decisions that path needs, and nothing else:
 *
 * 1. **Recognition** — is this JSON a v1 project, a current project, or
 *    garbage? `inspectLegacyProjectText` answers before the current parser sees
 *    the file, because a v1 document is valid JSON that the forgiving current
 *    validator would otherwise repair into a plausible-looking empty project.
 * 2. **Whether to ask at all** — `shouldOfferLegacyImport` composes what was
 *    restored, what the user chose last time, and what is actually in storage.
 *
 * Both are pure, so the behavior that matters here — never silently replacing a
 * project, never nagging after a decline, never converting malformed input — is
 * unit tested without a browser.
 *
 * A few things this module deliberately does **not** do:
 *
 * - It never removes or rewrites the old `localStorage` value. The conversion is
 *   additive; a bug in the new editor must not be able to destroy the only copy
 *   of someone's old work.
 * - It never touches IndexedDB or the editor store. Saving the converted
 *   document is the caller's job, and it must succeed *before* the offer is
 *   recorded as done — see `useProjectPersistence`.
 * - It does not read the `.desktopstage` archive. That is a later milestone.
 */

import type { ProjectDocument } from "@cutaway/types";
import { V1_STORAGE_KEY, convertV1ProjectChecked, isV1Project } from "@desktop-stage/desktop-engine";

/**
 * The slice of `localStorage` this module uses.
 *
 * Injected rather than read from `window` so the decisions below are testable
 * without a browser, and so a storage access that throws — a `SecurityError`
 * when storage is blocked, which is a different origin's problem, not ours — is
 * contained in one place.
 */
export interface LegacyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Where the user's choice is remembered.
 *
 * A separate key rather than a flag on the old document: the old value must stay
 * byte-for-byte as the prototype left it. `imported` is only written after the
 * converted document is safely in IndexedDB; `declined` is written the moment
 * the user says no.
 */
export const LEGACY_IMPORT_DECISION_KEY = "desktop-stage-v1-import-decision";

export type LegacyImportDecision = "imported" | "declined";

/** What a piece of JSON claiming to be a project turned out to be. */
export type LegacyProjectInspection =
  | { kind: "converted"; project: ProjectDocument }
  | { kind: "not-legacy" }
  | { kind: "invalid"; error: string };

export interface LegacyOfferContext {
  /** Whether an IndexedDB project was restored, which makes the offer moot. */
  hasRestoredProject: boolean;
  /** The user's recorded choice from a previous session, if any. */
  decision: LegacyImportDecision | null;
  /** What the stored value actually is. */
  candidate: LegacyProjectInspection;
}

/**
 * `localStorage`, or null when there is none.
 *
 * Null covers all three ways this can be unavailable: server rendering, a
 * privacy mode that throws on access, and an environment without `window`.
 * Callers treat null as "nothing to import", which is the honest reading —
 * a *different origin* simply has different, unreadable storage.
 */
export function browserLegacyStorage(): LegacyStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The raw old document, or null when it is absent or unreadable. */
export function readLegacyCandidateJson(storage: LegacyStorage | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(V1_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readLegacyImportDecision(
  storage: LegacyStorage | null,
): LegacyImportDecision | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(LEGACY_IMPORT_DECISION_KEY);
    return value === "imported" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Records the user's choice. Returns false when storage refused the write, in
 * which case the caller must not pretend the offer was handled.
 */
export function recordLegacyImportDecision(
  storage: LegacyStorage | null,
  decision: LegacyImportDecision,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LEGACY_IMPORT_DECISION_KEY, decision);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classifies project JSON.
 *
 * - `converted` — a well-formed v1 project, already mapped to the current model.
 * - `not-legacy` — valid JSON that is not v1. The caller hands it to the current
 *   parser, so Cutaway project files keep loading exactly as before.
 * - `invalid` — unparseable JSON, or something that claims to be v1 but is not
 *   well formed. Both are reported rather than guessed at, so a malformed file
 *   leaves the open project untouched.
 */
export function inspectLegacyProjectText(text: string): LegacyProjectInspection {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "invalid", error: "File is not valid JSON." };
  }

  if (isV1Project(parsed)) {
    const outcome = convertV1ProjectChecked(parsed);
    return outcome.ok
      ? { kind: "converted", project: outcome.project }
      : { kind: "invalid", error: outcome.error };
  }

  if (looksLikeV1Project(parsed)) {
    return {
      kind: "invalid",
      error: "This file looks like a Desktop Stage version 1 project, but it is malformed.",
    };
  }

  return { kind: "not-legacy" };
}

/**
 * Whether a value announces itself as the prototype's format without passing
 * `isV1Project`.
 *
 * `version: 1` is the prototype's marker and never appears on a current
 * document, whose schema is gated by `schemaVersion`. The window/keyframes pair
 * catches a v1 file whose version field was lost — a hand-edit, or a partial
 * copy — before the current parser can repair it into nonsense.
 */
function looksLikeV1Project(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.version === 1) return true;
  return Array.isArray(value.windows) && isRecord(value.keyframes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether to interrupt the user at startup with the import offer.
 *
 * Four independent reasons to stay quiet, each of which has been a real
 * annoyance in editors that get this wrong:
 *
 * - a project was restored, so there is nothing the old copy could add;
 * - the user already declined, so the question has been answered;
 * - the user already imported, so the document is in the library;
 * - the stored value is not a usable v1 project, so there is nothing to offer.
 */
export function shouldOfferLegacyImport(context: LegacyOfferContext): boolean {
  return (
    context.candidate.kind === "converted" &&
    !context.hasRestoredProject &&
    context.decision === null
  );
}
