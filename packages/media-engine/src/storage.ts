/**
 * Media blob persistence.
 *
 * Defined as an interface first, with IndexedDB as one implementation. The
 * indirection is not speculative: tests need an in-memory store, and the
 * planned desktop build will back this with the real filesystem. Nothing above
 * this layer should know which one it is talking to.
 */

/** Key-value store for media bytes. Keys are opaque strings. */
export interface MediaBlobStore {
  put(key: string, blob: Blob): Promise<void>;
  get(key: string): Promise<Blob | null>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

const DATABASE_NAME = "cutaway";
const DATABASE_VERSION = 1;
const BLOB_STORE = "media-blobs";

/** Fires when another connection holds an older version open. */
const OPEN_BLOCKED_MESSAGE =
  "Media storage is held open by another tab, so it could not be opened. Close other tabs of the editor and try again.";

/**
 * IndexedDB-backed store.
 *
 * IndexedDB rather than the Cache API or localStorage: it is the only web
 * storage that holds large binary blobs, survives reloads, and has a quota
 * measured in gigabytes. A 4K video does not fit anywhere else.
 */
export class IndexedDBMediaStore implements MediaBlobStore {
  private databasePromise: Promise<IDBDatabase> | null = null;

  /**
   * The cached connection is only ever pending or fulfilled. A blocked or
   * failed open resets it, so a later import retries instead of reusing a
   * settled rejection for the life of the tab.
   */
  private createDatabasePromise(): Promise<IDBDatabase> {
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BLOB_STORE)) {
          database.createObjectStore(BLOB_STORE);
        }
      };

      request.onblocked = () => reject(new Error(OPEN_BLOCKED_MESSAGE));
      request.onerror = () => reject(request.error ?? new Error("Media storage could not be opened."));
      request.onsuccess = () => {
        const database = request.result;

        // Another tab upgrading or deleting the database closes this
        // connection. Drop the cached handle so the next operation reopens
        // instead of failing with `InvalidStateError` for the life of the tab.
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };

        resolve(database);
      };
    });

    return pending.catch((error: unknown) => {
      this.databasePromise = null;
      throw error;
    });
  }

  private open(): Promise<IDBDatabase> {
    // Cached so concurrent imports share one connection instead of racing to
    // open several and triggering version-change conflicts.
    const cached = this.databasePromise;
    if (cached) return cached;

    const created = this.createDatabasePromise();
    this.databasePromise = created;
    return created;
  }

  /**
   * Runs one request in its own transaction.
   *
   * The promise settles on the **transaction**, not the request. A readwrite
   * transaction can abort at commit even after its request reported success
   * (quota enforcement, an I/O error, a torn-down connection), and resolving
   * on the request would make every caller believe the bytes were durable.
   * The request result is captured and handed over from `tx.oncomplete`.
   */
  private async transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();

    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = database.transaction(BLOB_STORE, mode);
      } catch (error) {
        // The cached connection was closed underneath us. Let the next call
        // reopen rather than failing this store for the session.
        this.databasePromise = null;
        reject(error);
        return;
      }

      const request = run(tx.objectStore(BLOB_STORE));

      let result: T | undefined;
      let hasResult = false;

      request.onsuccess = () => {
        result = request.result;
        hasResult = true;
      };
      request.onerror = () => reject(request.error ?? new Error("The storage request failed."));

      tx.oncomplete = () => {
        if (hasResult) resolve(result as T);
        else reject(new Error("The storage transaction completed without a result."));
      };
      tx.onabort = () => reject(tx.error ?? new Error("The storage transaction was aborted."));
      tx.onerror = () => reject(tx.error ?? new Error("The storage transaction failed."));
    });
  }

  async put(key: string, blob: Blob): Promise<void> {
    await this.transaction("readwrite", (store) => store.put(blob, key));
  }

  async get(key: string): Promise<Blob | null> {
    const result = await this.transaction<Blob | undefined>("readonly", (store) => store.get(key));
    return result ?? null;
  }

  async delete(key: string): Promise<void> {
    await this.transaction("readwrite", (store) => store.delete(key));
  }

  async keys(): Promise<string[]> {
    const result = await this.transaction<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
    return result.map(String);
  }

  async clear(): Promise<void> {
    await this.transaction("readwrite", (store) => store.clear());
  }
}

/** In-memory store, for tests and for SSR where IndexedDB does not exist. */
export class MemoryMediaStore implements MediaBlobStore {
  private readonly entries = new Map<string, Blob>();

  async put(key: string, blob: Blob): Promise<void> {
    this.entries.set(key, blob);
  }

  async get(key: string): Promise<Blob | null> {
    return this.entries.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async keys(): Promise<string[]> {
    return [...this.entries.keys()];
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

/** Returns the appropriate store for the current environment. */
export function createMediaStore(): MediaBlobStore {
  return typeof indexedDB === "undefined" ? new MemoryMediaStore() : new IndexedDBMediaStore();
}
