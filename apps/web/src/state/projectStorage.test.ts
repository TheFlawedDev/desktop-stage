/**
 * Tests for the project document store.
 *
 * These are the durability tests for autosave: a save is only "saved" once the
 * IndexedDB transaction has committed, and a storage failure must not be cached
 * into a session where every later save silently fails.
 *
 * The module caches its connection, so each test re-imports it after installing
 * the fake — `vi.resetModules()` is what makes the cache tests meaningful.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "@cutaway/utils";
import type { ProjectDocument } from "@cutaway/types";
import {
  createFakeIndexedDb,
  type FakeIndexedDb,
} from "../../../../packages/media-engine/src/__tests__/fakeIndexedDb";

function project(id: string, name: string): ProjectDocument {
  return { ...createProject(name), id };
}

describe("projectStorage", () => {
  let fake: FakeIndexedDb;
  let restoreGlobals: () => void;
  let storage: typeof import("./projectStorage");

  beforeEach(async () => {
    fake = createFakeIndexedDb();
    restoreGlobals = fake.install();
    vi.resetModules();
    storage = await import("./projectStorage");
  });

  afterEach(() => {
    restoreGlobals();
  });

  it("saves and loads a project document", async () => {
    await storage.saveProject(project("p1", "First"));

    const loaded = await storage.loadProject("p1");
    expect(loaded?.name).toBe("First");
    expect(loaded?.document.name).toBe("First");
  });

  it("returns null for a project that was never saved", async () => {
    expect(await storage.loadProject("missing")).toBeNull();
  });

  it("does not report a save whose transaction aborts at commit", async () => {
    // The request succeeded; the commit did not. Autosave must see the failure
    // rather than reporting a saved project that is not there.
    fake.abortNextCommit(new Error("QuotaExceededError at commit"));

    await expect(storage.saveProject(project("p1", "First"))).rejects.toThrow(
      "QuotaExceededError at commit",
    );
    expect(await storage.loadProject("p1")).toBeNull();
  });

  it("retries after a failed open instead of caching the rejection", async () => {
    fake.failNextOpen(new Error("VersionError"));

    await expect(storage.listProjects()).rejects.toThrow("VersionError");

    await storage.saveProject(project("p1", "First"));
    expect((await storage.listProjects()).map((entry) => entry.id)).toEqual([
      "p1",
    ]);
  });

  it("retries after a blocked open instead of caching the rejection", async () => {
    fake.blockNextOpen();

    await expect(storage.saveProject(project("p1", "First"))).rejects.toThrow(
      /another tab/i,
    );

    await storage.saveProject(project("p1", "First"));
    expect(await storage.loadProject("p1")).not.toBeNull();
  });

  it("closes an abandoned open that succeeds late", async () => {
    // An IDBOpenDBRequest cannot be cancelled, so a blocked open is abandoned
    // while still queued. If the blocking connection later goes away it fires
    // `success` anyway; that connection must be closed, not leaked, or it holds
    // the database open against another tab's upgrade forever.
    fake.blockNextOpen();

    await expect(storage.saveProject(project("p1", "First"))).rejects.toThrow(
      /another tab/i,
    );

    await fake.releaseBlockedOpen();

    // The retry's own connection is closed first, so a non-zero count here can
    // only be the abandoned request's connection.
    fake.triggerVersionChange();
    expect(fake.triggerVersionChange()).toBe(0);

    await storage.saveProject(project("p2", "Second"));
    expect((await storage.loadProject("p2"))?.name).toBe("Second");
  });

  it("returns the most recently saved project first", async () => {
    await storage.saveProject(project("older", "Older"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await storage.saveProject(project("newer", "Newer"));

    const projects = await storage.listProjects();
    expect(projects.map((entry) => entry.id)).toEqual(["newer", "older"]);
    expect((await storage.loadMostRecentProject())?.id).toBe("newer");
  });

  it("reopens after another tab closes the connection", async () => {
    await storage.saveProject(project("p1", "First"));

    fake.triggerVersionChange();

    expect((await storage.listProjects()).map((entry) => entry.id)).toEqual([
      "p1",
    ]);
  });
});
