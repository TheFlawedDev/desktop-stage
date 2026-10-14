/**
 * Tests for the legacy v1 import decisions.
 *
 * These cover the parts a user would notice if they were wrong: converting a
 * real v1 document, keeping a malformed one from replacing the open project,
 * and asking at most once. Storage is a fake, so nothing here needs a browser or
 * a clean origin.
 */

import { describe, expect, it } from "vitest";
import {
  V1_DESKTOP_TRACK_ID,
  V1_DURATION_FRAMES,
  V1_PROJECT_ID,
  V1_STORAGE_KEY,
  starterV1Project,
} from "@desktop-stage/desktop-engine";
import {
  LEGACY_IMPORT_DECISION_KEY,
  inspectLegacyProjectText,
  readLegacyCandidateJson,
  readLegacyImportDecision,
  recordLegacyImportDecision,
  shouldOfferLegacyImport,
  type LegacyStorage,
} from "./legacyImport";

function memoryStorage(initial: Record<string, string> = {}): LegacyStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** Storage that refuses every access, as a blocked-privacy-mode browser does. */
const blockedStorage: LegacyStorage = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
};

/** A bare current document, the shape the Cutaway parser owns. */
const currentDocumentJson = JSON.stringify({
  schemaVersion: 1,
  entities: { clips: {}, tracks: {}, media: {}, captionTracks: {} },
  trackOrder: [],
  settings: {},
  durationFrames: 0,
});

describe("inspectLegacyProjectText", () => {
  it("converts a well-formed v1 project", () => {
    const result = inspectLegacyProjectText(JSON.stringify(starterV1Project()));

    expect(result.kind).toBe("converted");
    if (result.kind !== "converted") return;

    expect(result.project.id).toBe(V1_PROJECT_ID);
    expect(result.project.durationFrames).toBe(V1_DURATION_FRAMES);
    expect(result.project.entities.tracks[V1_DESKTOP_TRACK_ID]).toBeDefined();
    expect(Object.keys(result.project.entities.clips)).toHaveLength(
      starterV1Project().windows.length,
    );
  });

  it("defers a current document to the Cutaway parser", () => {
    expect(inspectLegacyProjectText(currentDocumentJson).kind).toBe("not-legacy");
  });

  it("defers plain JSON that is neither format", () => {
    expect(inspectLegacyProjectText('{"hello":"world"}').kind).toBe("not-legacy");
    expect(inspectLegacyProjectText("[]").kind).toBe("not-legacy");
  });

  it("reports unparseable input instead of guessing", () => {
    const result = inspectLegacyProjectText("{not json");

    expect(result).toEqual({ kind: "invalid", error: "File is not valid JSON." });
  });

  it("rejects a v1 project with a malformed window", () => {
    const result = inspectLegacyProjectText(
      JSON.stringify({ version: 1, windows: [{ id: "browser" }], keyframes: {} }),
    );

    expect(result.kind).toBe("invalid");
  });

  it("rejects v1-shaped JSON whose version field was lost", () => {
    const result = inspectLegacyProjectText(JSON.stringify({ windows: [], keyframes: {} }));

    expect(result.kind).toBe("invalid");
  });

  it("is deterministic: the same text converts to the same document", () => {
    const text = JSON.stringify(starterV1Project());
    const first = inspectLegacyProjectText(text);
    const second = inspectLegacyProjectText(text);

    expect(first).toEqual(second);
  });
});

describe("shouldOfferLegacyImport", () => {
  const converted = inspectLegacyProjectText(JSON.stringify(starterV1Project()));

  it("offers once, when nothing was restored and nothing was decided", () => {
    expect(
      shouldOfferLegacyImport({
        hasRestoredProject: false,
        decision: null,
        candidate: converted,
      }),
    ).toBe(true);
  });

  it("stays quiet when a current project was restored", () => {
    expect(
      shouldOfferLegacyImport({
        hasRestoredProject: true,
        decision: null,
        candidate: converted,
      }),
    ).toBe(false);
  });

  it("does not nag after the user declined", () => {
    expect(
      shouldOfferLegacyImport({
        hasRestoredProject: false,
        decision: "declined",
        candidate: converted,
      }),
    ).toBe(false);
  });

  it("does not offer again after a completed import", () => {
    expect(
      shouldOfferLegacyImport({
        hasRestoredProject: false,
        decision: "imported",
        candidate: converted,
      }),
    ).toBe(false);
  });

  it("has nothing to offer for a malformed or foreign candidate", () => {
    const malformed = inspectLegacyProjectText("{not json");
    const foreign = inspectLegacyProjectText(currentDocumentJson);

    for (const candidate of [malformed, foreign]) {
      expect(shouldOfferLegacyImport({ hasRestoredProject: false, decision: null, candidate })).toBe(
        false,
      );
    }
  });
});

describe("readLegacyCandidateJson", () => {
  it("reads the key the prototype actually wrote", () => {
    // Pinned here because this is an external contract: renaming the constant
    // would silently stop finding every existing user's saved project.
    expect(V1_STORAGE_KEY).toBe("desktop-stage-project-v1");
  });

  it("reads the old value without needing it to be valid", () => {
    const storage = memoryStorage({ [V1_STORAGE_KEY]: "not json" });
    expect(readLegacyCandidateJson(storage)).toBe("not json");
  });

  it("returns null when the key is absent or storage is unavailable", () => {
    expect(readLegacyCandidateJson(memoryStorage())).toBeNull();
    expect(readLegacyCandidateJson(null)).toBeNull();
    expect(readLegacyCandidateJson(blockedStorage)).toBeNull();
  });
});

describe("legacy import decision", () => {
  it("round-trips a recorded decision", () => {
    const storage = memoryStorage();
    expect(readLegacyImportDecision(storage)).toBeNull();

    expect(recordLegacyImportDecision(storage, "declined")).toBe(true);
    expect(readLegacyImportDecision(storage)).toBe("declined");

    expect(recordLegacyImportDecision(storage, "imported")).toBe(true);
    expect(readLegacyImportDecision(storage)).toBe("imported");
  });

  it("uses its own key and never rewrites the old document", () => {
    const storage = memoryStorage({ [V1_STORAGE_KEY]: "keep me" });
    recordLegacyImportDecision(storage, "declined");

    expect(readLegacyCandidateJson(storage)).toBe("keep me");
    expect(storage.getItem(LEGACY_IMPORT_DECISION_KEY)).toBe("declined");
  });

  it("ignores unrecognized decision values", () => {
    const storage = memoryStorage({ [LEGACY_IMPORT_DECISION_KEY]: "maybe" });
    expect(readLegacyImportDecision(storage)).toBeNull();
  });

  it("reports failure instead of throwing when storage is blocked", () => {
    expect(readLegacyImportDecision(blockedStorage)).toBeNull();
    expect(recordLegacyImportDecision(blockedStorage, "declined")).toBe(false);
    expect(recordLegacyImportDecision(null, "declined")).toBe(false);
  });
});
