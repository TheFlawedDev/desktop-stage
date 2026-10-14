/**
 * A deliberately small in-memory IndexedDB, for the storage tests.
 *
 * `fake-indexeddb` is not a dependency and pulling one in for two helpers is not
 * worth the supply chain; the parts the stores actually use are the parts
 * modeled here. The important property is that the fake is **asynchronous and
 * event-driven like the real thing**: a request settles in a microtask and a
 * transaction fires `complete` only after its last request has succeeded. That
 * is what makes "request success" and "transaction commit" separately testable —
 * the distinction the stores must observe — which a synchronous stub could not
 * express.
 *
 * It also exposes the failure switches the real implementation cannot be asked
 * for on demand: abort before the request runs, abort at commit, a blocked open
 * (and the late `success` that follows once the blocker goes away), a failed
 * open, and a `versionchange` from another tab.
 *
 * What it deliberately does not model, so nobody trusts it further than it
 * goes: `onclose` is declared but never fired (the stores rely on the next
 * `transaction` call to notice an abnormal close), `put`/`get` do not
 * structured-clone, `getAll` returns insertion order rather than key order, and
 * there is one connection object per database name, so "two tabs" cannot be
 * expressed directly — `triggerVersionChange` is the stand-in for the other tab.
 */

type Handler = (() => void) | null;

interface StoreData {
  keyPath: string | null;
  records: Map<IDBValidKey, unknown>;
}

interface TransactionControls {
  takeAbortBeforeRequest: () => Error | null;
  takeAbortAtCommit: () => Error | null;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function abortError(): Error {
  return new DOMException("The transaction was aborted.", "AbortError");
}

class FakeRequest<T> {
  result: T | undefined;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

class FakeObjectStore {
  constructor(
    private readonly tx: FakeTransaction,
    private readonly data: StoreData,
  ) {}

  private resolveKey(value: unknown, explicit?: IDBValidKey): IDBValidKey {
    if (explicit !== undefined) return explicit;

    const keyPath = this.data.keyPath;
    if (keyPath && typeof value === "object" && value !== null) {
      const key = (value as Record<string, unknown>)[keyPath];
      if (typeof key === "string" || typeof key === "number") return key;
    }

    throw new Error(
      "A key is required for an object store without a key path.",
    );
  }

  put(value: unknown, key?: IDBValidKey): FakeRequest<IDBValidKey> {
    return this.tx.run(() => {
      const resolved = this.resolveKey(value, key);
      this.data.records.set(resolved, value);
      return resolved;
    });
  }

  get(key: IDBValidKey): FakeRequest<unknown> {
    return this.tx.run(() => this.data.records.get(key));
  }

  getAll(): FakeRequest<unknown[]> {
    return this.tx.run(() => [...this.data.records.values()]);
  }

  getAllKeys(): FakeRequest<IDBValidKey[]> {
    return this.tx.run(() => [...this.data.records.keys()]);
  }

  delete(key: IDBValidKey): FakeRequest<undefined> {
    return this.tx.run(() => {
      this.data.records.delete(key);
      return undefined;
    });
  }

  clear(): FakeRequest<undefined> {
    return this.tx.run(() => {
      this.data.records.clear();
      return undefined;
    });
  }
}

class FakeTransaction {
  oncomplete: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;
  error: Error | null = null;

  private pending = 0;
  private finished = false;
  /** Records as they were before a readwrite transaction, restored on abort. */
  private readonly snapshot: Map<IDBValidKey, unknown> | null;

  constructor(
    private readonly data: StoreData,
    private readonly mode: IDBTransactionMode,
    private readonly controls: TransactionControls,
  ) {
    this.snapshot = mode === "readwrite" ? new Map(data.records) : null;
  }

  objectStore(_name?: string): FakeObjectStore {
    return new FakeObjectStore(this, this.data);
  }

  /**
   * Queues one request. `work` runs in a microtask so the caller has attached
   * its handlers by the time they fire, exactly as a real request behaves.
   */
  run<T>(work: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;

    queueMicrotask(() => {
      if (this.finished) {
        request.error = this.error ?? abortError();
        request.onerror?.();
        return;
      }

      const preemptive = this.controls.takeAbortBeforeRequest();
      if (preemptive) {
        request.error = preemptive;
        request.onerror?.();
        this.fail(preemptive);
        return;
      }

      try {
        request.result = work();
        request.onsuccess?.();
      } catch (error) {
        request.error = toError(error);
        request.onerror?.();
        this.fail(request.error);
        return;
      }

      this.pending -= 1;
      if (this.pending === 0) queueMicrotask(() => this.commit());
    });

    return request;
  }

  private commit(): void {
    if (this.finished) return;

    const abort = this.controls.takeAbortAtCommit();
    if (abort) {
      this.fail(abort);
      return;
    }

    this.finished = true;
    this.oncomplete?.();
  }

  private fail(error: Error): void {
    if (this.finished) return;

    this.finished = true;
    this.error = error;

    // A real readwrite transaction rolls its writes back when it aborts.
    if (this.snapshot) this.data.records = this.snapshot;

    queueMicrotask(() => {
      this.onerror?.();
      this.onabort?.();
    });
  }
}

class FakeDatabase {
  onversionchange: Handler = null;
  onclose: Handler = null;

  private readonly stores = new Map<string, StoreData>();
  private closed = false;

  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  constructor(
    readonly name: string,
    public version: number,
    private readonly controls: TransactionControls,
    /** Live connections for this database, so `close` can deregister itself. */
    private readonly connections: Set<FakeDatabase>,
  ) {}

  createObjectStore(name: string, options?: { keyPath?: string }): void {
    this.stores.set(name, {
      keyPath: options?.keyPath ?? null,
      records: new Map(),
    });
  }

  transaction(
    name: string,
    mode: IDBTransactionMode = "readonly",
  ): FakeTransaction {
    if (this.closed) {
      throw new DOMException(
        "The database connection is closed.",
        "InvalidStateError",
      );
    }

    const data = this.stores.get(name);
    if (!data)
      throw new DOMException(
        `No object store named "${name}".`,
        "NotFoundError",
      );

    return new FakeTransaction(data, mode, this.controls);
  }

  close(): void {
    this.closed = true;
    // A real close deregisters the connection. Keeping it here would make
    // `triggerVersionChange` fire on an already-closed connection, which would
    // hide a store that forgot to drop its cached handle.
    this.connections.delete(this);
  }

  /**
   * Marks this database as having a live connection again.
   *
   * A real `open` hands back a new connection object even for an existing
   * database; the fake keeps one per name, so reopening simply clears the
   * closed state. Records are kept, which is what makes "reopen after another
   * tab closed the connection" observable.
   */
  connect(): void {
    this.closed = false;
    this.connections.add(this);
  }
}

export interface FakeIndexedDb {
  /** The `IDBFactory`-shaped object handed to the module under test. */
  readonly factory: IDBFactory;
  /** Make the next commit fail *after* its request reported success. */
  abortNextCommit(error?: Error): void;
  /** Make the next request fail, taking its transaction down with it. */
  abortNextTransaction(error?: Error): void;
  /** Make the next `open` fire `blocked` and never settle. */
  blockNextOpen(): void;
  /**
   * Settle the open that `blockNextOpen` left pending, as the real request does
   * once the blocking connection goes away. Resolves after `onsuccess` ran.
   */
  releaseBlockedOpen(): Promise<void>;
  /** Make the next `open` reject. */
  failNextOpen(error?: Error): void;
  /**
   * Fire `versionchange` on every open connection, as another tab would.
   * Returns how many were still open.
   */
  triggerVersionChange(): number;
  /** Installs as `globalThis.indexedDB`; returns a restore function. */
  install(): () => void;
}

export function createFakeIndexedDb(): FakeIndexedDb {
  const databases = new Map<string, FakeDatabase>();
  const connections = new Set<FakeDatabase>();

  let abortBeforeRequest: Error | null = null;
  let abortAtCommit: Error | null = null;
  let blockNextOpenFlag = false;
  let failNextOpenError: Error | null = null;
  /** The open left pending by `blockNextOpen`, with what it was opening. */
  let blockedOpen: {
    request: FakeOpenRequest;
    name: string;
    target: number;
  } | null = null;

  const controls: TransactionControls = {
    takeAbortBeforeRequest: () => {
      const error = abortBeforeRequest;
      abortBeforeRequest = null;
      return error;
    },
    takeAbortAtCommit: () => {
      const error = abortAtCommit;
      abortAtCommit = null;
      return error;
    },
  };

  /**
   * Creates or reopens the database and settles `request`.
   *
   * Shared between the immediate open path and `releaseBlockedOpen` so a
   * connection that only arrives later is created, upgraded, and registered
   * exactly like one that arrived on time.
   */
  const settleOpen = (
    request: FakeOpenRequest,
    name: string,
    target: number,
  ): FakeDatabase => {
    let database = databases.get(name);
    // `onupgradeneeded` runs for a new database or a version bump, which is when
    // the module's handler creates its object store.
    const needsUpgrade = !database || target > database.version;

    if (!database) {
      database = new FakeDatabase(name, target, controls, connections);
      databases.set(name, database);
    } else {
      database.version = target;
    }

    if (needsUpgrade) {
      request.result = database;
      request.onupgradeneeded?.();
    }

    database.connect();
    request.result = database;
    request.onsuccess?.();

    return database;
  };

  const factory = {
    open(name: string, version?: number): IDBOpenDBRequest {
      const request = new FakeOpenRequest();
      const target = version ?? 1;

      queueMicrotask(() => {
        if (blockNextOpenFlag) {
          blockNextOpenFlag = false;
          // A real blocked upgrade stays pending until the blocking connection
          // goes away, so the request is deliberately left unsettled — and
          // remembered, so a test can make it succeed later.
          blockedOpen = { request, name, target };
          request.onblocked?.();
          return;
        }

        if (failNextOpenError) {
          const error = failNextOpenError;
          failNextOpenError = null;
          request.error = error;
          request.onerror?.();
          return;
        }

        settleOpen(request, name, target);
      });

      return request as unknown as IDBOpenDBRequest;
    },
  };

  const asFactory = factory as unknown as IDBFactory;

  return {
    factory: asFactory,
    abortNextCommit: (
      error = new DOMException("Quota exceeded.", "QuotaExceededError"),
    ) => {
      abortAtCommit = error;
    },
    abortNextTransaction: (error = abortError()) => {
      abortBeforeRequest = error;
    },
    blockNextOpen: () => {
      blockNextOpenFlag = true;
    },
    releaseBlockedOpen: async () => {
      const pending = blockedOpen;
      if (!pending) {
        throw new Error(
          "No blocked open is waiting; call blockNextOpen() first.",
        );
      }

      blockedOpen = null;
      settleOpen(pending.request, pending.name, pending.target);
      // Let the promise callbacks that `onsuccess` scheduled run before the
      // caller asserts on their effects.
      await Promise.resolve();
    },
    failNextOpen: (
      error = new DOMException("Version error.", "VersionError"),
    ) => {
      failNextOpenError = error;
    },
    triggerVersionChange: () => {
      const open = [...connections];
      for (const database of open) database.onversionchange?.();
      return open.length;
    },
    install: () => {
      const globals = globalThis as { indexedDB?: unknown };
      const previous = globals.indexedDB;
      globals.indexedDB = asFactory;

      return () => {
        if (previous === undefined) delete globals.indexedDB;
        else globals.indexedDB = previous;
      };
    },
  };
}
