// lib/offline-logs-cache.ts
// Caches activity logs in IndexedDB so the calendar/home tab
// shows data even when the user is offline.

const DB_NAME    = "acculog-logs";
const DB_VERSION = 1;
const STORE_NAME = "logs";
const META_STORE = "meta";

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
