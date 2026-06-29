// lib/offline-store.ts
// IndexedDB-based offline queue for activity logs

const DB_NAME    = "acculog-offline";
const DB_VERSION = 2;
const STORE_NAME = "pending-logs";

// ── Global sync lock ──────────────────────────────────────────────────────────
//
// Prevents duplicate processing when both OfflineStatusProvider (app-level
// sync loop) and useOfflineSync (page-level hook) are active simultaneously.
// Only one sync loop may hold this lock at a time; the other will find an
// empty queue or see the lock taken and return without submitting duplicates.

let _globalSyncLocked = false;

/**
 * Attempt to acquire the global sync lock.
 * Returns `true` if the lock was acquired (caller may proceed with sync).
 * Returns `false` if another sync is already in progress (caller must skip).
 */
export function acquireSyncLock(): boolean {
  if (_globalSyncLocked) return false;
  _globalSyncLocked = true;
  return true;
}

/**
 * Release the global sync lock so the next sync attempt can proceed.
 * Always call this in a `finally` block after sync completes or errors.
 */
export function releaseSyncLock(): void {
  _globalSyncLocked = false;
}

/**
 * Returns `true` if the global sync lock is currently held.
 * Useful for skipping redundant sync attempts without acquiring the lock.
 */
export function isSyncLocked(): boolean {
  return _globalSyncLocked;
}

/**
 * Reset the global sync lock to its initial (unlocked) state.
 * Intended for use in test `beforeEach` / `afterEach` hooks to prevent
 * stale lock state from leaking between tests.
 *
 * @internal Do not call in production code.
 */
export function resetSyncLock(): void {
  _globalSyncLocked = false;
}

export interface PendingLog {
  id: string;
  payload: Record<string, unknown>;
  createdAt: number;
  retries: number;
}

// ── Generic CRUD record shape ─────────────────────────────────────────────────

export interface StoreRecord<T> {
  _key: string;
  _value: T;
  _version: number;
  _createdAt: number;
  _expiresAt: number | null;
}

// ── DB helper ─────────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("cached-api-responses")) {
        db.createObjectStore("cached-api-responses", { keyPath: "_key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Add a log payload to the offline queue. Returns the generated id. */
export async function enqueuePendingLog(
  payload: Record<string, unknown>
): Promise<string> {
  const db  = await openDB();
  const id  = `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();

  // Stamp the original submission time into the payload so the API can
  // use it as date_created instead of the sync time.
  const stampedPayload = {
    ...payload,
    date_created: payload.date_created ?? new Date(now).toISOString(),
  };

  const entry: PendingLog = { id, payload: stampedPayload, createdAt: now, retries: 0 };

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.add(entry);

    tx.oncomplete = () => { db.close(); resolve(id); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
    req.onerror   = () => reject(req.error);
  });
}

/** Return all queued logs sorted oldest-first. */
export async function getAllPendingLogs(): Promise<PendingLog[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();

    tx.oncomplete = () => db.close();
    req.onsuccess = () => {
      resolve(
        (req.result as PendingLog[]).sort((a, b) => a.createdAt - b.createdAt)
      );
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Remove a successfully-synced log. */
export async function removePendingLog(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
    req.onerror   = () => reject(req.error);
  });
}

/** Bump the retry counter for a failed log. */
export async function incrementRetry(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx     = db.transaction(STORE_NAME, "readwrite");
    const store  = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const entry = getReq.result as PendingLog | undefined;
      if (!entry) { resolve(); return; }
      entry.retries += 1;
      const putReq = store.put(entry);
      putReq.onerror = () => reject(putReq.error);
    };

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Return the count of queued logs without loading them all. */
export async function getPendingCount(): Promise<number> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.count();

    tx.oncomplete = () => db.close();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => { db.close(); reject(req.error); };
  });
}

/** Clear all pending logs from the queue. */
export async function clearAllPendingLogs(): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.clear();

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
    req.onerror   = () => reject(req.error);
  });
}

// ── Generic getItem / setItem ─────────────────────────────────────────────────

/**
 * Read a value from any IDB object store by key.
 * Returns `null` if the record does not exist, has expired, or IDB is unavailable.
 */
export async function getItem<T>(store: string, key: string): Promise<T | null> {
  try {
    const db = await openDB();

    return new Promise<T | null>((resolve) => {
      const tx      = db.transaction(store, "readonly");
      const objStore = tx.objectStore(store);
      const req      = objStore.get(key);

      req.onsuccess = () => {
        db.close();
        const record = req.result as StoreRecord<T> | undefined;
        if (!record) { resolve(null); return; }
        if (record._expiresAt !== null && record._expiresAt <= Date.now()) {
          resolve(null);
          return;
        }
        resolve(record._value);
      };

      req.onerror = () => { db.close(); resolve(null); };
      tx.onerror  = () => { db.close(); resolve(null); };
    });
  } catch {
    return null;
  }
}

/**
 * Write a value to any IDB object store.
 * Increments `_version` on each write for conflict detection.
 * Silent no-op when IndexedDB is unavailable.
 */
export async function setItem<T>(
  store: string,
  key: string,
  value: T,
  ttlMs?: number
): Promise<void> {
  try {
    const db = await openDB();

    return new Promise<void>((resolve) => {
      // First read the existing record to get the current _version.
      const readTx      = db.transaction(store, "readonly");
      const readStore   = readTx.objectStore(store);
      const readReq     = readStore.get(key);

      readReq.onsuccess = () => {
        const existing = readReq.result as StoreRecord<T> | undefined;
        const nextVersion = (existing?._version ?? 0) + 1;
        const now = Date.now();

        const record: StoreRecord<T> = {
          _key: key,
          _value: value,
          _version: nextVersion,
          _createdAt: now,
          _expiresAt: ttlMs != null ? now + ttlMs : null,
        };

        // Now open a readwrite transaction to persist.
        const writeTx    = db.transaction(store, "readwrite");
        const writeStore = writeTx.objectStore(store);
        const putReq     = writeStore.put(record);

        writeTx.oncomplete = () => { db.close(); resolve(); };
        writeTx.onerror    = () => { db.close(); resolve(); }; // silent no-op on error
        putReq.onerror     = () => { /* handled by writeTx.onerror */ };
      };

      readTx.onerror = () => { db.close(); resolve(); }; // silent no-op on error
    });
  } catch {
    // Silent no-op when IndexedDB is unavailable
  }
}

// ── deleteItem / getAllItems / runExpiry / withTransaction ─────────────────────

/**
 * Delete a value from any IDB object store by key.
 * Silent no-op when IndexedDB is unavailable or an error occurs.
 */
export async function deleteItem(store: string, key: string): Promise<void> {
  try {
    const db = await openDB();

    return new Promise<void>((resolve) => {
      const tx      = db.transaction(store, "readwrite");
      const objStore = tx.objectStore(store);
      const req      = objStore.delete(key);

      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); resolve(); }; // silent no-op on error
      req.onerror   = () => { /* handled by tx.onerror */ };
    });
  } catch {
    // Silent no-op when IndexedDB is unavailable
  }
}

/**
 * Return all non-expired values from any IDB object store.
 * Excludes records where `_expiresAt` is set and `<= Date.now()`.
 * Falls back to `[]` on error.
 */
export async function getAllItems<T>(store: string): Promise<T[]> {
  try {
    const db = await openDB();

    return new Promise<T[]>((resolve) => {
      const tx       = db.transaction(store, "readonly");
      const objStore = tx.objectStore(store);
      const req      = objStore.getAll();

      req.onsuccess = () => {
        db.close();
        const now = Date.now();
        const records = req.result as StoreRecord<T>[];
        const values = records
          .filter(
            (r) => r._expiresAt === null || r._expiresAt > now
          )
          .map((r) => r._value);
        resolve(values);
      };

      req.onerror = () => { db.close(); resolve([]); };
      tx.onerror  = () => { db.close(); resolve([]); };
    });
  } catch {
    return [];
  }
}

/**
 * Delete all expired records from any IDB object store.
 * Iterates via a cursor and removes entries where `_expiresAt !== null && _expiresAt <= Date.now()`.
 * Silent no-op when IndexedDB is unavailable.
 */
export async function runExpiry(store: string): Promise<void> {
  try {
    const db = await openDB();

    return new Promise<void>((resolve) => {
      const tx       = db.transaction(store, "readwrite");
      const objStore = tx.objectStore(store);
      const req      = objStore.openCursor();

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return; // no more records

        const record = cursor.value as StoreRecord<unknown>;
        const now = Date.now();

        if (record._expiresAt !== null && record._expiresAt <= now) {
          cursor.delete();
        }

        cursor.continue();
      };

      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); resolve(); }; // silent no-op on error
      req.onerror   = () => { /* handled by tx.onerror */ };
    });
  } catch {
    // Silent no-op when IndexedDB is unavailable
  }
}

/**
 * Open a single IDB transaction across multiple stores and pass it to `fn`.
 * Resolves when the transaction completes; rejects on transaction error.
 * Falls back to no-op if IndexedDB is unavailable.
 */
export async function withTransaction(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => void
): Promise<void> {
  try {
    const db = await openDB();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, mode);

      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };

      fn(tx);
    });
  } catch {
    // Silent no-op when IndexedDB is unavailable
  }
}
