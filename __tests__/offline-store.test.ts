/**
 * Unit Tests for D5 — `offline-store` generic CRUD layer
 * Task 8.3
 *
 * Tests the setItem, getItem, deleteItem, getAllItems, runExpiry, and
 * withTransaction exports using fake-indexeddb as the IDB backend.
 *
 * Validates: Requirements 2.5
 */

import { indexedDB as fakeIndexedDB, IDBKeyRange as fakeIDBKeyRange } from "fake-indexeddb";

// ---------------------------------------------------------------------------
// Set up fake IndexedDB globals BEFORE importing the module under test.
// The offline-store module checks `typeof indexedDB` at call-time inside
// openDB(), so we only need the global set before the first call.
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Each beforeEach below installs a fresh IDBFactory instance so tests
  // are isolated.  We set a baseline here so TypeScript is happy.
  global.indexedDB = fakeIndexedDB as unknown as IDBFactory;
  if (typeof global.IDBKeyRange === "undefined") {
    global.IDBKeyRange = fakeIDBKeyRange as unknown as typeof IDBKeyRange;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for `ms` milliseconds. */
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Return a fresh IDBFactory backed by an isolated in-memory database so each
 * test starts with a clean slate without needing jest.resetModules().
 */
function freshIDB() {
  const { IDBFactory } = require("fake-indexeddb");
  return new IDBFactory();
}

// ---------------------------------------------------------------------------
// Module import — re-imported after global.indexedDB is set so openDB() sees
// the fake implementation.
// ---------------------------------------------------------------------------

// We import after the beforeAll hook by using dynamic require inside each
// describe block.  However, because Jest caches module imports per test file
// we can import once at the top after setting the global.
import {
  getItem,
  setItem,
  deleteItem,
  getAllItems,
  runExpiry,
  withTransaction,
} from "@/lib/offline-store";

// The test object store name — must exist in the IDB schema.
// offline-store.ts opens "acculog-offline" DB (version 2) with two stores:
//   "pending-logs"  (keyPath: "id")
//   "cached-api-responses"  (keyPath: "_key")
// We use "cached-api-responses" for all CRUD tests.
const TEST_STORE = "cached-api-responses";

// ---------------------------------------------------------------------------
// Before each test, replace global.indexedDB with a fresh isolated instance
// so tests do not share state.
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.indexedDB = freshIDB() as unknown as IDBFactory;
});

// ============================================================================
// setItem + getItem — version tracking
// ============================================================================

describe("setItem + getItem — _version increments on successive writes", () => {
  it("_version is 1 on the first write, 2 on the second write for the same key", async () => {
    const key = "version-test-key";

    // First write
    await setItem(TEST_STORE, key, { data: "first" });
    const firstRead = await getItem<{ data: string }>(TEST_STORE, key);
    expect(firstRead).toEqual({ data: "first" });

    // Read the raw record to check _version.
    // We open IDB directly to inspect the stored StoreRecord.
    const rawRecord1 = await readRawRecord(key);
    expect(rawRecord1).not.toBeNull();
    expect(rawRecord1!._version).toBe(1);

    // Second write — same key, different value
    await setItem(TEST_STORE, key, { data: "second" });
    const secondRead = await getItem<{ data: string }>(TEST_STORE, key);
    expect(secondRead).toEqual({ data: "second" });

    const rawRecord2 = await readRawRecord(key);
    expect(rawRecord2).not.toBeNull();
    expect(rawRecord2!._version).toBe(2);
  });
});

// ============================================================================
// getItem with expired TTL
// ============================================================================

describe("getItem — TTL expiry behaviour", () => {
  it("returns null after TTL has elapsed (ttlMs = 1, wait 5 ms)", async () => {
    const key = "ttl-expired-key";

    // Write with a 1 ms TTL
    await setItem(TEST_STORE, key, { secret: "hidden" }, 1);

    // Wait long enough for the TTL to expire
    await wait(5);

    const result = await getItem<{ secret: string }>(TEST_STORE, key);
    expect(result).toBeNull();
  });

  it("returns the stored value before TTL has elapsed (ttlMs = 5000)", async () => {
    const key = "ttl-valid-key";

    // Write with a generous TTL — still valid at read time
    await setItem(TEST_STORE, key, { payload: "alive" }, 5000);

    const result = await getItem<{ payload: string }>(TEST_STORE, key);
    expect(result).toEqual({ payload: "alive" });
  });

  it("returns stored value when no TTL is set (expiresAt is null)", async () => {
    const key = "no-ttl-key";

    await setItem(TEST_STORE, key, { alwaysLive: true });

    const result = await getItem<{ alwaysLive: boolean }>(TEST_STORE, key);
    expect(result).toEqual({ alwaysLive: true });
  });
});

// ============================================================================
// deleteItem
// ============================================================================

describe("deleteItem", () => {
  it("subsequent getItem returns null after deleteItem", async () => {
    const key = "delete-me";

    await setItem(TEST_STORE, key, { temporary: true });

    // Confirm it's there first
    const before = await getItem<{ temporary: boolean }>(TEST_STORE, key);
    expect(before).toEqual({ temporary: true });

    // Delete it
    await deleteItem(TEST_STORE, key);

    // Now it should be gone
    const after = await getItem<{ temporary: boolean }>(TEST_STORE, key);
    expect(after).toBeNull();
  });

  it("is a no-op when the key does not exist (no error thrown)", async () => {
    await expect(deleteItem(TEST_STORE, "non-existent-key")).resolves.toBeUndefined();
  });
});

// ============================================================================
// getAllItems
// ============================================================================

describe("getAllItems", () => {
  it("excludes records whose TTL has expired", async () => {
    const expiredKey = "all-expired";
    const liveKey = "all-live";

    // Write one expired and one live record
    await setItem(TEST_STORE, expiredKey, { expired: true }, 1);
    await setItem(TEST_STORE, liveKey, { live: true }, 5000);

    // Wait for the expired record's TTL to elapse
    await wait(5);

    const results = await getAllItems<{ expired?: boolean; live?: boolean }>(TEST_STORE);

    // Should contain only the live record
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ live: true });
  });

  it("includes records with no TTL (expiresAt is null)", async () => {
    const key1 = "no-ttl-1";
    const key2 = "no-ttl-2";

    await setItem(TEST_STORE, key1, { n: 1 });
    await setItem(TEST_STORE, key2, { n: 2 });

    const results = await getAllItems<{ n: number }>(TEST_STORE);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.n).sort()).toEqual([1, 2]);
  });

  it("returns empty array when the store is empty", async () => {
    const results = await getAllItems(TEST_STORE);
    expect(results).toEqual([]);
  });

  it("returns empty array when all records are expired", async () => {
    await setItem(TEST_STORE, "exp-a", { x: 1 }, 1);
    await setItem(TEST_STORE, "exp-b", { x: 2 }, 1);

    await wait(5);

    const results = await getAllItems(TEST_STORE);
    expect(results).toEqual([]);
  });
});

// ============================================================================
// runExpiry
// ============================================================================

describe("runExpiry", () => {
  it("deletes only records where _expiresAt <= Date.now(), leaves non-expired ones", async () => {
    const expiredKey = "expiry-expired";
    const liveKey = "expiry-live";
    const noTTLKey = "expiry-no-ttl";

    await setItem(TEST_STORE, expiredKey, { status: "expired" }, 1);
    await setItem(TEST_STORE, liveKey, { status: "live" }, 5000);
    await setItem(TEST_STORE, noTTLKey, { status: "permanent" }); // no TTL

    // Wait for the expired record's TTL to elapse
    await wait(5);

    // Run the expiry sweep
    await runExpiry(TEST_STORE);

    // Expired record is gone
    const expiredResult = await getItem(TEST_STORE, expiredKey);
    expect(expiredResult).toBeNull();

    // Live record survives
    const liveResult = await getItem<{ status: string }>(TEST_STORE, liveKey);
    expect(liveResult).toEqual({ status: "live" });

    // No-TTL record survives
    const noTTLResult = await getItem<{ status: string }>(TEST_STORE, noTTLKey);
    expect(noTTLResult).toEqual({ status: "permanent" });
  });

  it("is a no-op on an empty store (no error thrown)", async () => {
    await expect(runExpiry(TEST_STORE)).resolves.toBeUndefined();
  });

  it("does not delete records that have not yet expired", async () => {
    await setItem(TEST_STORE, "future-1", { v: 1 }, 10000);
    await setItem(TEST_STORE, "future-2", { v: 2 }, 10000);

    await runExpiry(TEST_STORE);

    const results = await getAllItems<{ v: number }>(TEST_STORE);
    expect(results).toHaveLength(2);
  });
});

// ============================================================================
// withTransaction
// ============================================================================

describe("withTransaction", () => {
  it("callback receives a valid IDBTransaction object", async () => {
    let capturedTx: IDBTransaction | null = null;

    await withTransaction([TEST_STORE], "readonly", (tx) => {
      capturedTx = tx;
    });

    expect(capturedTx).not.toBeNull();
    expect(typeof (capturedTx as unknown as IDBTransaction).objectStore).toBe("function");
  });

  it("resolves when the transaction completes (oncomplete fires)", async () => {
    let callbackRan = false;

    await expect(
      withTransaction([TEST_STORE], "readonly", (_tx) => {
        callbackRan = true;
      })
    ).resolves.toBeUndefined();

    expect(callbackRan).toBe(true);
  });

  it("allows reading a previously written value inside the transaction", async () => {
    const key = "tx-read-key";
    await setItem(TEST_STORE, key, { fromTx: true });

    let readValue: unknown = undefined;

    await withTransaction([TEST_STORE], "readonly", (tx) => {
      const store = tx.objectStore(TEST_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        readValue = (req.result as { _value: unknown })?._value;
      };
    });

    expect(readValue).toEqual({ fromTx: true });
  });

  it("allows writing a value inside a readwrite transaction", async () => {
    const key = "tx-write-key";
    const record = {
      _key: key,
      _value: { written: "via-tx" },
      _version: 1,
      _createdAt: Date.now(),
      _expiresAt: null,
    };

    await withTransaction([TEST_STORE], "readwrite", (tx) => {
      const store = tx.objectStore(TEST_STORE);
      store.put(record);
    });

    const result = await getItem<{ written: string }>(TEST_STORE, key);
    expect(result).toEqual({ written: "via-tx" });
  });
});

// ============================================================================
// Internal helper — read a raw StoreRecord from IDB directly
// (bypasses the getItem TTL filter so we can inspect _version)
// ============================================================================

interface RawRecord {
  _key: string;
  _value: unknown;
  _version: number;
  _createdAt: number;
  _expiresAt: number | null;
}

function readRawRecord(key: string): Promise<RawRecord | null> {
  return new Promise((resolve, reject) => {
    const openReq = global.indexedDB.open("acculog-offline", 2);

    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains("pending-logs")) {
        db.createObjectStore("pending-logs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("cached-api-responses")) {
        db.createObjectStore("cached-api-responses", { keyPath: "_key" });
      }
    };

    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction("cached-api-responses", "readonly");
      const store = tx.objectStore("cached-api-responses");
      const getReq = store.get(key);

      getReq.onsuccess = () => {
        db.close();
        resolve((getReq.result as RawRecord) ?? null);
      };
      getReq.onerror = () => {
        db.close();
        reject(getReq.error);
      };
    };

    openReq.onerror = () => reject(openReq.error);
  });
}
