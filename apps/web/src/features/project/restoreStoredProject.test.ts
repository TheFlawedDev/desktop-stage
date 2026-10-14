/**
 * Tests for restoring a document from storage.
 *
 * IndexedDB is untrusted input: a record can predate the current schema, be a
 * partial write, or come from a newer build. The restore path must therefore
 * behave exactly like opening a file — migrate, validate, report — and must
 * never throw into startup, where a crash has no UI to recover from.
 */

import { describe, expect, it } from "vitest";
import { createStarterProject } from "@desktop-stage/desktop-engine";
import { SCHEMA_VERSION } from "@cutaway/types";
import { restoreStoredProject } from "./restoreStoredProject";

describe("restoreStoredProject", () => {
  it("migrates and keeps the stored document's own id", () => {
    const stored = { ...createStarterProject(), schemaVersion: 0 };

    const result = restoreStoredProject(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.restored.issues).toContain("Migrated: Stamp Desktop Stage plugin content versions");
    expect(result.restored.fromFuture).toBe(false);
    // The id is preserved so the next autosave updates this record instead of
    // creating a second one.
    expect(result.restored.project.id).toBe(stored.id);
    expect(Object.keys(result.restored.project.entities.clips)).toHaveLength(7);
  });

  it("reports what validation repaired", () => {
    const starter = createStarterProject();
    const stored = {
      ...starter,
      entities: {
        ...starter.entities,
        media: {
          m1: { id: "m1", name: "clip", kind: "image", source: { type: "indexeddb", key: "b1" } },
        },
      },
    };

    const result = restoreStoredProject(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.restored.issues.some((message) => message.includes("metadata"))).toBe(true);
    expect(result.restored.project.entities.media["m1"]).toBeDefined();
  });

  it("flags a document written by a newer build without refusing it", () => {
    const stored = { ...createStarterProject(), schemaVersion: SCHEMA_VERSION + 1 };

    const result = restoreStoredProject(stored);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.restored.fromFuture).toBe(true);
    expect(Object.keys(result.restored.project.entities.clips).length).toBeGreaterThan(0);
  });

  it("turns a record that is not a document into an empty project", () => {
    const result = restoreStoredProject(null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.restored.issues.length).toBeGreaterThan(0);
    expect(result.restored.project.entities.clips).toEqual({});
  });

  it("reports a failure instead of throwing into startup", () => {
    // A record whose properties cannot even be read: the defensive catch must
    // turn it into a reported error, never an exception on the startup path.
    const hostile = new Proxy(
      {},
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
