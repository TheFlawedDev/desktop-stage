/**
 * Tests for restoring a document from storage.
 *
 * IndexedDB is untrusted input: a record can predate the current schema, come
 * from a newer build, or be damaged. The restore path must therefore migrate and
 * validate it, report what it repaired, and — because the record is the only
 * copy and an autosave follows within a second — never let the restored document
 * be written back over it unless it is byte-identical to what is stored.
 */

import { describe, expect, it } from "vitest";
import { createStarterProject } from "@desktop-stage/desktop-engine";
import { SCHEMA_VERSION } from "@cutaway/types";
import { createProject } from "@cutaway/utils";
import { restoreStoredProject } from "./restoreStoredProject";

describe("restoreStoredProject", () => {
  it("keeps the stored id for a clean restore", () => {
    const stored = createProject("Clean");

    const result = restoreStoredProject(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.restored.issues).toEqual([]);
    expect(result.restored.fromFuture).toBe(false);
    expect(result.restored.recovered).toBe(false);
    // The id is preserved so the next autosave updates this record instead of
    // creating a second one.
    expect(result.restored.project.id).toBe(stored.id);
  });

  it("opens a migrated document as a fresh-id copy", () => {
    const stored = { ...createStarterProject(), schemaVersion: 0 };

    const result = restoreStoredProject(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.restored.issues).toContain(
      "Migrated: Stamp Desktop Stage plugin content versions",
    );
    expect(result.restored.fromFuture).toBe(false);
    // Migration rewrites the document, so the original record must not be
    // overwritten by the autosave that follows.
    expect(result.restored.recovered).toBe(true);
    expect(result.restored.project.id).not.toBe(stored.id);
    expect(Object.keys(result.restored.project.entities.clips)).toHaveLength(7);
  });

  it("reports what validation repaired and recovers a fresh id", () => {
    const starter = createStarterProject();
    const stored = {
      ...starter,
      entities: {
        ...starter.entities,
        media: {
          m1: {
            id: "m1",
            name: "clip",
            kind: "image",
            source: { type: "indexeddb", key: "b1" },
          },
        },
      },
    };

    const result = restoreStoredProject(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      result.restored.issues.some((message) => message.includes("metadata")),
    ).toBe(true);
    expect(result.restored.project.entities.media["m1"]).toBeDefined();
    expect(result.restored.recovered).toBe(true);
    expect(result.restored.project.id).not.toBe(stored.id);
  });

  it("flags a document written by a newer build without refusing it", () => {
    const stored = {
      ...createStarterProject(),
      schemaVersion: SCHEMA_VERSION + 1,
    };

    const result = restoreStoredProject(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.restored.fromFuture).toBe(true);
    expect(
      Object.keys(result.restored.project.entities.clips).length,
    ).toBeGreaterThan(0);
    // A future document may hold fields this build drops on save, so it is
    // opened as a copy rather than downgraded in place.
    expect(result.restored.recovered).toBe(true);
    expect(result.restored.project.id).not.toBe(stored.id);
  });

  it("mints the recovered id through the injected factory", () => {
    const stored = { ...createStarterProject(), schemaVersion: 0 };

    const result = restoreStoredProject(stored, {
      createProjectId: () => "project_recovered",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.restored.project.id).toBe("project_recovered");
  });

  it("fails a stored value that is not a document", () => {
    for (const stored of [null, "not a project", [], 42]) {
      const result = restoreStoredProject(stored);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The preconditions that catch a non-document pass, so the read of the
      // record's contents is what throws.
      expect(result.error).toContain("not a project document");
    }
  });

  it("fails a record with no usable project id", () => {
    const stored = { ...createProject(), id: undefined as unknown as string };

    const result = restoreStoredProject(stored);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/id/i);
  });

  it("reports a failure instead of throwing into startup", () => {
    // A record whose properties cannot even be read: the defensive catch must
    // turn it into a reported error, never an exception on the startup path.
    const hostile = new Proxy(
      { id: "hostile" },
      {
        get() {
          throw new Error("unreadable record");
        },
      },
    );

    const result = restoreStoredProject(hostile);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toContain("unreadable record");
  });
});
