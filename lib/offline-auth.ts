// lib/offline-auth.ts
// IndexedDB-based offline authentication + session cache.

const DB_NAME       = "acculog-auth";
const DB_VERSION    = 4;             // v4: safe upgrade from any prior version
const AUTH_STORE    = "credentials";
const USER_STORE    = "users";
const SESSION_STORE = "session";

const CRED_TTL_MS    = 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;  // 7 days

export interface CachedCredential {
  key: string;          // "email:password" or "email:pin"
  email: string;
  hash: string;         // sha-256(email::secret)
  isPinLogin: boolean;
  userId: string;
  cachedAt: number;
}

export interface CachedUser {
  userId: string;
  data: Record<string, unknown>;
  cachedAt: number;
}

export interface OfflineSession {
  id: "current";
  userId: string;
  cachedAt: number;
}

// ── IndexedDB open ────────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;

      // ── credentials store ──────────────────────────────────────────────
      // v1/v2 used key = email (no type suffix).
      // v3+ uses key = "email:password" or "email:pin".
      // Drop and recreate so old entries with wrong key format don't linger.
      if (db.objectStoreNames.contains(AUTH_STORE)) {
        db.deleteObjectStore(AUTH_STORE);
      }
      db.createObjectStore(AUTH_STORE, { keyPath: "key" });

      // ── users store ────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains(USER_STORE)) {
        db.createObjectStore(USER_STORE, { keyPath: "userId" });
      }

      // ── session store ──────────────────────────────────────────────────
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
    req.onblocked = () => {
      // Another tab has the DB open at an older version.
      // Reject so the caller can fall back gracefully.
      reject(new Error("IndexedDB upgrade blocked by another tab"));
    };
  });
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function sha256(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hashCredential(email: string, secret: string): Promise<string> {
  return sha256(`${email.toLowerCase()}::${secret}`);
}

function credKey(email: string, isPinLogin: boolean): string {
  return `${email.toLowerCase()}:${isPinLogin ? "pin" : "password"}`;
}

// ── Credential cache ──────────────────────────────────────────────────────────

/**
 * Cache credentials after a successful online login so the user can
 * authenticate offline later. Stores password and PIN entries separately.
 */
export async function cacheCredential(args: {
  email: string;
  secret: string;
  isPinLogin: boolean;
  userId: string;
}): Promise<void> {
  const db   = await openDB();
  const hash = await hashCredential(args.email, args.secret);
  const entry: CachedCredential = {
    key:        credKey(args.email, args.isPinLogin),
    email:      args.email,
    hash,
    isPinLogin: args.isPinLogin,
    userId:     args.userId,
    cachedAt:   Date.now(),
  };

  return new Promise<void>((resolve, reject) => {
    const tx    = db.transaction(AUTH_STORE, "readwrite");
    const store = tx.objectStore(AUTH_STORE);
    const req   = store.put(entry);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
    req.onerror   = () => reject(req.error);
  });
}

/** Verify credentials against the offline cache. Returns userId on match. */
export async function verifyOfflineCredential(args: {
  email: string;
  secret: string;
  isPinLogin: boolean;
}): Promise<{ userId: string } | null> {
  try {
    const db  = await openDB();
    const key = credKey(args.email, args.isPinLogin);

    const cached = await new Promise<CachedCredential | undefined>((resolve, reject) => {
      const tx    = db.transaction(AUTH_STORE, "readonly");
      const store = tx.objectStore(AUTH_STORE);
      const req   = store.get(key);
      tx.oncomplete = () => db.close();
      req.onsuccess = () => resolve(req.result as CachedCredential | undefined);
      req.onerror   = () => { db.close(); reject(req.error); };
    });

    if (!cached) return null;
    if (Date.now() - cached.cachedAt > CRED_TTL_MS) return null;

    const candidateHash = await hashCredential(args.email, args.secret);
    if (candidateHash !== cached.hash) return null;

    return { userId: cached.userId };
  } catch {
    return null;
  }
}

// ── User profile cache ────────────────────────────────────────────────────────

export async function cacheUser(userId: string, data: Record<string, unknown>): Promise<void> {
  try {
    const db    = await openDB();
    const entry: CachedUser = { userId, data, cachedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(USER_STORE, "readwrite");
      const store = tx.objectStore(USER_STORE);
      const req   = store.put(entry);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
      req.onerror   = () => reject(req.error);
    });
  } catch {
    // ignore — non-critical
  }
}

export async function getCachedUser(userId: string): Promise<Record<string, unknown> | null> {
  try {
    const db = await openDB();
    return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
      const tx    = db.transaction(USER_STORE, "readonly");
      const store = tx.objectStore(USER_STORE);
      const req   = store.get(userId);
      tx.oncomplete = () => db.close();
      req.onsuccess = () => {
        const result = req.result as CachedUser | undefined;
        resolve(result ? result.data : null);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return null;
  }
}

// ── Offline Session ───────────────────────────────────────────────────────────

export async function setOfflineSession(userId: string): Promise<void> {
  try {
    const db    = await openDB();
    const entry: OfflineSession = { id: "current", userId, cachedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(SESSION_STORE, "readwrite");
      const store = tx.objectStore(SESSION_STORE);
      const req   = store.put(entry);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
      req.onerror   = () => reject(req.error);
    });
  } catch {
    // ignore — non-critical
  }
}

export async function getOfflineSession(): Promise<string | null> {
  try {
    const db = await openDB();
    const session = await new Promise<OfflineSession | undefined>((resolve, reject) => {
      const tx    = db.transaction(SESSION_STORE, "readonly");
      const store = tx.objectStore(SESSION_STORE);
      const req   = store.get("current");
      tx.oncomplete = () => db.close();
      req.onsuccess = () => resolve(req.result as OfflineSession | undefined);
      req.onerror   = () => { db.close(); reject(req.error); };
    });

    if (!session) return null;
    if (Date.now() - session.cachedAt > SESSION_TTL_MS) return null;
    return session.userId;
  } catch {
    return null;
  }
}

export async function clearOfflineSession(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(SESSION_STORE, "readwrite");
      const store = tx.objectStore(SESSION_STORE);
      const req   = store.delete("current");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
      req.onerror   = () => reject(req.error);
    });
  } catch {
    // ignore
  }
}
