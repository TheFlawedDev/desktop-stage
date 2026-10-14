/**
 * Tests for the IndexedDB blob store.
 *
 * The store exists to make one promise: when `put` resolves, the bytes are
 * durable. IndexedDB does not report that at request time — a readwrite
 * transaction can still abort at commit — so these tests drive the store
 * through the fake's failure switches and pin the difference between "the
 * request succeeded" and "the transaction committed".
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexedDBMediaStore } from "../storage";
import { createFakeIndexedDb, type FakeIndexedDb } from "./fakeIndexedDb";

describe("IndexedDBMediaStore", () => {
  let fake: FakeIndexedDb;
  let restoreGlobals: () => void;
  let store: IndexedDBMediaStore;

  beforeEach(() => {
    fake = createFakeIndexedDb();
    restoreGlobals = fake.install();
    store = new IndexedDBMediaStore();
  });

  afterEach(() => {
    restoreGlobals();
  });

  it("stores, retrieves, lists, and deletes blobs", async () => {
    const blob = new Blob(["hello"]);

    await store.put("a", blob);
    await store.put("b", new Blob(["world"]));

    expect(await store.keys()).toEqual(["a", "b"]);
    expect(await store.get("a")).toBeInstanceOf(Blob);
    expect(await store.get("a")).toMatchObject({ size: blob.size });

    await store.delete("a");
    expect(await store.keys()).toEqual(["b"]);

    await store.clear();
    expect(await store.keys()).toEqual([]);
  });

  it("returns null for a missing key", async () => {
    expect(await store.get("nope")).toBeNull();
  });

  it("does not report a put whose transaction aborts at commit", async () => {
    // The request succeeds, then the commit fails — quota enforcement or an I/O
    // error. Resolving on the request would have made the caller believe the
    // bytes were saved.
    fake.abortNextCommit(new Error("QuotaExceededError at commit"));

    await expect(store.put("a", new Blob(["hello"]))).rejects.toThrow(
      "QuotaExceededError at commit",
    );
    expect(await store.keys()).toEqual([]);
  });

  it("does not report a delete whose transaction aborts at commit", async () => {
    await store.put("a", new Blob(["hello"]));

    fake.abortNextCommit(new Error("I/O error at commit"));

    await expect(store.delete("a")).rejects.toThrow("I/O error at commit");
    expect(await store.keys()).toEqual(["a"]);
  });

  it("rejects when the transaction aborts before the request succeeds", async () => {
    fake.abortNextTransaction(new Error("AbortError from another writer"));

    await expect(store.put("a", new Blob(["hello"]))).rejects.toThrow(
      "AbortError from another writer",
    );
    expect(await store.keys()).toEqual([]);
  });

  it("retries after a blocked open instead of caching the rejection", async () => {
    fake.blockNextOpen();

    await expect(store.keys()).rejects.toThrow(/another tab/i);

    await store.put("a", new Blob(["hello"]));
    expect(await store.keys()).toEqual(["a"]);
  });

  it("closes an abandoned open that succeeds late", async () => {
    // The request cannot be cancelled, so the blocked open is abandoned while
    // still queued. The late `success` hands back a connection nobody caches;
    // leaving it open would block another tab's upgrade for the tab's lifetime.
    fake.blockNextOpen();

    await expect(store.put("a", new Blob(["hello"]))).rejects.toThrow(
      /another tab/i,
    );

    await fake.releaseBlockedOpen();

    // The retry's connection is closed first, so a non-zero count can only be
    // the abandoned request's connection.
    fake.triggerVersionChange();
    expect(fake.triggerVersionChange()).toBe(0);

    await store.put("b", new Blob(["world"]));
    expect(await store.keys()).toEqual(["b"]);
  });

  it("retries after a failed open instead of caching the rejection", async () => {
    fake.failNextOpen(new Error("VersionError"));

    await expect(store.keys()).rejects.toThrow("VersionError");

    await store.put("a", new Blob(["hello"]));
    expect(await store.get("a")).not.toBeNull();
  });

  it("reopens after another tab closes the connection", async () => {
    await store.put("a", new Blob(["hello"]));

    // Another tab upgrading or deleting the database closes this connection.
    fake.triggerVersionChange();

    // The cached handle was dropped, so the next operation opens a fresh one
    // rather than throwing InvalidStateError for the rest of the tab's life.
    expect(await store.keys()).toEqual(["a"]);
  });
});
