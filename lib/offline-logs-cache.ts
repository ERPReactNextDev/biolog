// lib/offline-logs-cache.ts
// Caches activity logs in IndexedDB so the calendar/home tab
// shows data even when the user is offline.

const DB_NAME    = "acculog-logs";
const DB_VERSION = 2;
const STORE_NAME = "logs";
const META_STORE = "meta";
const ACTION_QUEUE_STORE = "action-queue";

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
        const store = db.createObjectStore(STORE_NAME, { keyPath: "_id" });
        store.createIndex("ReferenceID", "ReferenceID", { unique: false });
        store.createIndex("date_created", "date_created", { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(ACTION_QUEUE_STORE)) {
        const aqStore = db.createObjectStore(ACTION_QUEUE_STORE, { keyPath: "id" });
        aqStore.createIndex("syncStatus", "syncStatus", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Save a batch of logs to the local cache. Merges with existing. */
export async function cacheLogs(logs: Record<string, unknown>[]): Promise<void> {
  if (!logs.length) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction([STORE_NAME, META_STORE], "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const meta  = tx.objectStore(META_STORE);

      for (const log of logs) {
        // Ensure every log has a string _id key
        const entry = { ...log, _id: String((log as any)._id ?? (log as any).id ?? `${Date.now()}_${Math.random()}`) };
        store.put(entry);
      }

      meta.put({ key: "lastFetched", value: Date.now() });

      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.warn("[offline-logs] cacheLogs failed:", err);
  }
}

/** Get all cached logs, sorted newest-first. */
export async function getCachedLogs(): Promise<Record<string, unknown>[]> {
  try {
    const db = await openDB();
    return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const tx    = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req   = store.getAll();
      tx.oncomplete = () => db.close();
      req.onsuccess = () => {
        const sorted = (req.result as Record<string, unknown>[]).sort((a, b) => {
          const da = new Date((a as any).date_created).getTime();
          const db2 = new Date((b as any).date_created).getTime();
          return db2 - da;
        });
        resolve(sorted);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return [];
  }
}

/** Returns ms since last successful fetch, or Infinity if never fetched. */
export async function getLastFetchedAge(): Promise<number> {
  try {
    const db = await openDB();
    const meta = await new Promise<{ key: string; value: number } | undefined>((resolve, reject) => {
      const tx    = db.transaction(META_STORE, "readonly");
      const store = tx.objectStore(META_STORE);
      const req   = store.get("lastFetched");
      tx.oncomplete = () => db.close();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => { db.close(); reject(req.error); };
    });
    return meta ? Date.now() - meta.value : Infinity;
  } catch {
    return Infinity;
  }
}

// ─── Action Queue ──────────────────────────────────────────────────────────

export interface ActionQueueEntry {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  createdAt: number;
  syncStatus: "pending" | "synced" | "failed" | "dead-letter";
  lastAttemptAt: number | null;
  attempts: number;
  errorMessage: string | null;
}

/**
 * Enqueue an action for offline sync.
 * Works without a network connection — writes directly to IndexedDB.
 * Returns the generated id within 1 second.
 */
export async function enqueueAction(
  action: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const id =
    "aq_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);

  const entry: ActionQueueEntry = {
    id,
    action,
    payload,
    createdAt: Date.now(),
    syncStatus: "pending",
    lastAttemptAt: null,
    attempts: 0,
    errorMessage: null,
  };

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(ACTION_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(ACTION_QUEUE_STORE);
      store.put(entry);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.warn("[offline-logs] enqueueAction failed:", err);
  }

  return id;
}

/**
 * Returns all action-queue entries with syncStatus "pending" or "failed",
 * sorted by createdAt ascending. Falls back to [] on any IDB error.
 */
export async function getUnsyncedActions(): Promise<ActionQueueEntry[]> {
  try {
    const db = await openDB();
    return await new Promise<ActionQueueEntry[]>((resolve, reject) => {
      const tx    = db.transaction(ACTION_QUEUE_STORE, "readonly");
      const store = tx.objectStore(ACTION_QUEUE_STORE);
      const req   = store.getAll();
      tx.oncomplete = () => db.close();
      req.onsuccess = () => {
        const all = req.result as ActionQueueEntry[];
        const unsynced = all
          .filter(e => e.syncStatus === "pending" || e.syncStatus === "failed")
          .sort((a, b) => a.createdAt - b.createdAt);
        resolve(unsynced);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return [];
  }
}

/**
 * Marks an action-queue entry as synced.
 * Sets syncStatus = "synced" and lastAttemptAt = Date.now().
 */
export async function markSynced(id: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(ACTION_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(ACTION_QUEUE_STORE);
      const req   = store.get(id);
      req.onsuccess = () => {
        const entry = req.result as ActionQueueEntry | undefined;
        if (!entry) { resolve(); return; }
        entry.syncStatus    = "synced";
        entry.lastAttemptAt = Date.now();
        store.put(entry);
      };
      req.onerror   = () => { db.close(); reject(req.error); };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.warn("[offline-logs] markSynced failed:", err);
  }
}

/**
 * Marks an action-queue entry as failed (or dead-letter after 5 attempts).
 * Increments attempts, sets lastAttemptAt, sets errorMessage.
 * If attempts >= 5 after increment, sets syncStatus = "dead-letter";
 * otherwise sets syncStatus = "failed".
 */
export async function markFailed(id: string, errorMessage: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(ACTION_QUEUE_STORE, "readwrite");
      const store = tx.objectStore(ACTION_QUEUE_STORE);
      const req   = store.get(id);
      req.onsuccess = () => {
        const entry = req.result as ActionQueueEntry | undefined;
        if (!entry) { resolve(); return; }
        entry.attempts     += 1;
        entry.lastAttemptAt = Date.now();
        entry.errorMessage  = errorMessage;
        entry.syncStatus    = entry.attempts >= 5 ? "dead-letter" : "failed";
        store.put(entry);
      };
      req.onerror   = () => { db.close(); reject(req.error); };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  } catch (err) {
    console.warn("[offline-logs] markFailed failed:", err);
  }
}
