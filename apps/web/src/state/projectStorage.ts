"use client";

import type { Id, ProjectDocument } from "@cutaway/types";

/**
 * Project persistence in IndexedDB.
 *
 * Projects live in a **separate database** from media blobs, so a document is
 * small and cheap to write on every autosave while the gigabytes of footage
 * stay untouched.
 *
 * Separate databases rather than a second object store in `cutaway`: two places
 * opening the same database at different versions throws `VersionError`, and
 * the media store (owned by `@cutaway/media-engine`) has no business knowing
 * the project schema. Independent databases let each layer version itself.
 */

const DATABASE_NAME = "cutaway-projects";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";

export interface StoredProject {
  id: Id;
  name: string;
  savedAt: number;
  document: ProjectDocument;
}

/**
 * Read/write failures, kept as `Error`s so callers can distinguish them from
 * whatever IndexedDB itself raised.
 */
const OPEN_BLOCKED_MESSAGE =
  "Project storage is held open by another tab, so it could not be opened. Close other tabs of the editor and try again.";

let databasePromise: Promise<IDBDatabase> | null = null;

/**
 * Opens the project database, caching the connection.
 *
 * The cached promise is only ever a *pending or fulfilled* one: a blocked or
 * failed open resets the cache, so a later autosave retries instead of reusing
 * a rejection for the rest of the session.
 */
function createDatabasePromise(): Promise<IDBDatabase> {
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
      }
    };

    // Fires when another connection holds an older version open. Without a
    // handler the open never settles and the status bar says "Saving…" forever.
    request.onblocked = () => reject(new Error(OPEN_BLOCKED_MESSAGE));
    request.onerror = () =>
      reject(request.error ?? new Error("Project storage could not be opened."));
    request.onsuccess = () => {
      const database = request.result;

      // Another tab upgrading or deleting the database closes this connection.
      // Drop the cached handle so the next operation reopens instead of failing
      // with `InvalidStateError` for the life of the tab.
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };

      resolve(database);
    };
  });

  return pending.catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
}

function openDatabase(): Promise<IDBDatabase> {
  const cached = databasePromise;
  if (cached) return cached;

  const created = createDatabasePromise();
  databasePromise = created;
  return created;
}

/**
 * Runs one request in its own transaction.
 *
 * The promise settles on the **transaction**, not the request: `request
 * .onsuccess` only means the request was processed, and a readwrite transaction
 * can still abort at commit on quota enforcement, an I/O error, or a torn-down
 * connection. Resolving there would let callers report bytes as saved before
 * they are, so the request's result is captured and handed over from
 * `tx.oncomplete`; an abort or error rejects.
 */
function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        let tx: IDBTransaction;
        try {
          tx = database.transaction(PROJECT_STORE, mode);
        } catch (error) {
          // The cached connection was closed underneath us (another tab
          // upgraded, or site data was cleared). Let the next call reopen.
          databasePromise = null;
          reject(error);
          return;
        }

        const request = run(tx.objectStore(PROJECT_STORE));

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
      }),
  );
}

export async function saveProject(project: ProjectDocument): Promise<void> {
  const record: StoredProject = {
    id: project.id,
    name: project.name,
    savedAt: Date.now(),
    // Cloned so a later in-memory mutation cannot alter what IndexedDB is
    // mid-way through writing.
    document: structuredClone(project),
  };

  await runTransaction("readwrite", (store) => store.put(record));
}

export async function loadProject(id: Id): Promise<StoredProject | null> {
  const result = await runTransaction<StoredProject | undefined>("readonly", (store) =>
    store.get(id),
  );
  return result ?? null;
}

export async function listProjects(): Promise<StoredProject[]> {
  const all = await runTransaction<StoredProject[]>("readonly", (store) => store.getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteProject(id: Id): Promise<void> {
  await runTransaction("readwrite", (store) => store.delete(id));
}

/** The most recently saved project, used to restore the session on startup. */
export async function loadMostRecentProject(): Promise<StoredProject | null> {
  const projects = await listProjects();
  return projects[0] ?? null;
}

export function isStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
