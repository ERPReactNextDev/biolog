/**
 * Integration Test — Activity Page Sync Compatibility (Task 9.4)
 *
 * Validates Requirements 3.9:
 *   - After adding app-level OfflineStatusProvider, the Activity page's
 *     useOfflineSync continues to work independently.
 *   - A pending log is synced exactly once — NOT twice — even with both
 *     the provider sync loop and useOfflineSync active simultaneously.
 *   - Cloudinary photo upload fires via useOfflineSync.
 *   - 300 ms inter-log delay fires via useOfflineSync.
 *   - Toast notifications fire via useOfflineSync.
 *
 * Validates: Requirements 3.9
 */

import React from "react";
import {
  render,
  screen,
  act,
  cleanup,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// Set up fake IndexedDB BEFORE any module that touches IDB is loaded.
// ---------------------------------------------------------------------------
import { IDBFactory, IDBKeyRange as fakeIDBKeyRange } from "fake-indexeddb";

beforeAll(() => {
  if (typeof global.IDBKeyRange === "undefined") {
    global.IDBKeyRange = fakeIDBKeyRange as unknown as typeof IDBKeyRange;
  }
});

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => "/time-attendance/activity",
  useSearchParams: () => ({
    get: (_key: string) => null,
  }),
}));

// Mock Cloudinary upload — tracks calls so we can assert it fires
const mockUploadToCloudinary = jest.fn();
jest.mock("@/lib/cloudinary", () => ({
  uploadToCloudinary: (...args: unknown[]) => mockUploadToCloudinary(...args),
}));

// Mock sonner toast — tracks calls so we can assert notifications fire
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockToastInfo = jest.fn();
jest.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    warning: jest.fn(),
  },
  Toaster: () => null,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import { OfflineStatusProvider } from "@/contexts/OfflineStatusContext";
import { enqueuePendingLog, resetSyncLock } from "@/lib/offline-store";
import { useOfflineSync } from "@/hooks/useOfflineSync";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

/** Flush async microtasks N times to let IDB, fetch, and React state settle. */
async function flushPromises(n = 30) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

/**
 * Test double for the Activity page — mounts useOfflineSync exactly as the
 * real Activity page does, without the heavy UI dependencies.
 */
function ActivityPageDouble() {
  const { pendingCount, isSyncing } = useOfflineSync();
  return (
    <div
      data-testid="activity-page"
      data-pending-count={String(pendingCount)}
      data-is-syncing={String(isSyncing)}
    />
  );
}

/**
 * Full app tree: OfflineStatusProvider (from layout.tsx) wrapping the Activity
 * page double (which mounts useOfflineSync). This is the scenario where BOTH
 * the provider sync loop and the hook are active simultaneously.
 */
function AppWithActivityPage() {
  return (
    <OfflineStatusProvider>
      <ActivityPageDouble />
    </OfflineStatusProvider>
  );
}

/**
 * Hook-only tree: Activity page double WITHOUT OfflineStatusProvider.
 * Used to verify hook-specific features (Cloudinary, toast, delay) in isolation.
 */
function HookOnlyActivityPage() {
  return <ActivityPageDouble />;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalFetch: typeof global.fetch;

/**
 * Track every call made to the two sync endpoints:
 *   - OfflineStatusProvider → /api/activity-logs
 *   - useOfflineSync        → /api/ModuleSales/Activity/AddLog
 */
let syncEndpointCalls: { url: string; body: unknown }[] = [];

beforeEach(() => {
  jest.useFakeTimers();

  // Fresh isolated IndexedDB per test — prevents cross-test contamination
  global.indexedDB = new IDBFactory() as unknown as IDBFactory;

  // Reset the global sync lock — prevents stale lock state leaking between tests
  resetSyncLock();

  // Clean up OfflineBanner side-effect state
  if (typeof window !== "undefined") {
    delete (window as Record<string, unknown>).__prevSyncing;
  }

  // Clear mock call histories
  syncEndpointCalls = [];
  mockUploadToCloudinary.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  mockToastInfo.mockReset();

  // Default: Cloudinary returns a hosted URL
  mockUploadToCloudinary.mockResolvedValue("https://res.cloudinary.com/test/photo.jpg");

  // Start offline so enqueuing doesn't trigger premature sync
  setOnlineStatus(false);

  originalFetch = global.fetch;

  // Mock both sync endpoints as successful.
  global.fetch = jest.fn().mockImplementation((url: unknown, opts?: RequestInit) => {
    const urlStr = String(url);
    const isProviderEndpoint = urlStr.includes("/api/activity-logs");
    const isHookEndpoint = urlStr.includes("/api/ModuleSales/Activity/AddLog");

    if (
      (isProviderEndpoint || isHookEndpoint) &&
      opts?.method === "POST"
    ) {
      let body: unknown = null;
      try { body = JSON.parse(opts.body as string); } catch { body = opts.body; }
      syncEndpointCalls.push({ url: urlStr, body });
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true }),
      text: () => Promise.resolve(""),
    });
  });
});

afterEach(() => {
  cleanup();
  jest.runAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
  setOnlineStatus(true);
  resetSyncLock();
  if (typeof window !== "undefined") {
    delete (window as Record<string, unknown>).__prevSyncing;
  }
});

// ---------------------------------------------------------------------------
// Helper: trigger sync and wait for pendingCount to reach 0
// ---------------------------------------------------------------------------

async function triggerOnlineAndWaitForSync(
  expectedFinalCount = "0",
  { advanceMs = 600 }: { advanceMs?: number } = {}
) {
  setOnlineStatus(true);
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await flushPromises(30);
  });

  // Advance timers to fire:
  //   - 300 ms inter-log delay in useOfflineSync (if multiple logs)
  //   - 500 ms deferred refreshCount when hook loses the lock to provider
  await act(async () => {
    jest.advanceTimersByTime(advanceMs);
    await flushPromises(30);
  });

  await waitFor(
    () => {
      const page = screen.getByTestId("activity-page");
      expect(page.getAttribute("data-pending-count")).toBe(expectedFinalCount);
    },
    { timeout: 8000 }
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Integration — Activity Page Sync Compatibility (Req 3.9)", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Test 1 — A pending log is synced exactly once, not twice
  //
  // Both OfflineStatusProvider (provider sync) and useOfflineSync (hook sync)
  // are active. The global sync lock ensures only ONE of them processes the
  // log — the other is blocked and defers a count refresh.
  //
  // The two sync loops use DIFFERENT endpoints:
  //   provider:  /api/activity-logs
  //   hook:      /api/ModuleSales/Activity/AddLog
  //
  // After triggering both, the total POST count across BOTH endpoints must
  // equal 1 (not 2).
  // ─────────────────────────────────────────────────────────────────────────
  it("syncs a pending log exactly once even with both provider and useOfflineSync active", async () => {
    await enqueuePendingLog({ action: "time_in", userId: "user-001", ts: Date.now() });

    await act(async () => {
      render(<AppWithActivityPage />);
      await flushPromises(10);
    });

    await waitFor(() => {
      expect(screen.getByTestId("activity-page").getAttribute("data-pending-count")).toBe("1");
    });

    await triggerOnlineAndWaitForSync("0");

    // CRITICAL: exactly one POST across both endpoints combined
    const totalSyncCalls = syncEndpointCalls.filter(
      ({ url }) =>
        url.includes("/api/activity-logs") ||
        url.includes("/api/ModuleSales/Activity/AddLog")
    );
    expect(totalSyncCalls).toHaveLength(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2 — Cloudinary photo upload still fires via useOfflineSync (Req 3.9)
  //
  // When a pending log has a base64 PhotoURL, useOfflineSync must upload it
  // to Cloudinary before submitting the log to the API. This behavior must
  // continue to work after the app-level OfflineStatusProvider is added.
  //
  // We test this in isolation (hook only, no provider) to specifically verify
  // the hook's Cloudinary path is preserved. A separate test (Test 1) verifies
  // the no-duplicate guarantee in the combined scenario.
  // ─────────────────────────────────────────────────────────────────────────
  it("uploads base64 photo to Cloudinary via useOfflineSync when syncing", async () => {
    const base64Photo = "data:image/jpeg;base64,/9j/fakebase64==";

    await enqueuePendingLog({
      action: "time_in",
      userId: "user-002",
      PhotoURL: base64Photo,
      ts: Date.now(),
    });

    await act(async () => {
      render(<HookOnlyActivityPage />);
      await flushPromises(10);
    });

    await waitFor(() => {
      expect(screen.getByTestId("activity-page").getAttribute("data-pending-count")).toBe("1");
    });

    await triggerOnlineAndWaitForSync("0");

    // Cloudinary upload must have been called with the base64 string
    expect(mockUploadToCloudinary).toHaveBeenCalledTimes(1);
    expect(mockUploadToCloudinary).toHaveBeenCalledWith(base64Photo);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3 — 300 ms inter-log delay fires between consecutive logs (Req 3.9)
  //
  // useOfflineSync inserts a 300 ms setTimeout between processing each log.
  // We test this via the hook in isolation and verify the delay is respected.
  // ─────────────────────────────────────────────────────────────────────────
  it("applies 300 ms inter-log delay between syncing consecutive logs via useOfflineSync", async () => {
    const now = Date.now();
    await enqueuePendingLog({ action: "time_in",  userId: "user-003", ts: now });
    await enqueuePendingLog({ action: "time_out", userId: "user-003", ts: now + 1 });

    await act(async () => {
      render(<HookOnlyActivityPage />);
      await flushPromises(10);
    });

    await waitFor(() => {
      expect(screen.getByTestId("activity-page").getAttribute("data-pending-count")).toBe("2");
    });

    setOnlineStatus(true);

    // Kick off sync without draining timers
    act(() => { window.dispatchEvent(new Event("online")); });

    // Flush microtasks for first log to be processed (no delay before first)
    await act(async () => { await flushPromises(20); });

    // Before the 300 ms delay fires, at most 1 hook-endpoint call
    const callsBeforeDelay = syncEndpointCalls.filter(
      ({ url }) => url.includes("/api/ModuleSales/Activity/AddLog")
    ).length;
    expect(callsBeforeDelay).toBeLessThanOrEqual(1);

    // Advance past the 300 ms delay to let the second log process
    await act(async () => {
      jest.advanceTimersByTime(400);
      await flushPromises(20);
    });

    await waitFor(
      () => {
        expect(
          screen.getByTestId("activity-page").getAttribute("data-pending-count")
        ).toBe("0");
      },
      { timeout: 5000 }
    );

    // Both logs processed via the hook endpoint
    const hookCalls = syncEndpointCalls.filter(
      ({ url }) => url.includes("/api/ModuleSales/Activity/AddLog")
    );
    expect(hookCalls).toHaveLength(2);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4 — Toast notifications fire via useOfflineSync (Req 3.9)
  //
  // useOfflineSync calls toast.success() when at least one log syncs.
  // Tested in isolation to verify the hook's toast logic is preserved.
  // ─────────────────────────────────────────────────────────────────────────
  it("fires a toast success notification via useOfflineSync after syncing", async () => {
    await enqueuePendingLog({ action: "time_in", userId: "user-004", ts: Date.now() });

    await act(async () => {
      render(<HookOnlyActivityPage />);
      await flushPromises(10);
    });

    await waitFor(() => {
      expect(screen.getByTestId("activity-page").getAttribute("data-pending-count")).toBe("1");
    });

    await triggerOnlineAndWaitForSync("0");

    // toast.success must have fired with the hook's sync completion message
    expect(mockToastSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/offline record.*synced and cleared/i)
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 5 — 3 logs synced exactly 3 times total (no duplication) (Req 3.9)
  // ─────────────────────────────────────────────────────────────────────────
  it("syncs 3 pending logs exactly 3 times total across both sync loops", async () => {
    const base = Date.now();
    await enqueuePendingLog({ action: "time_in",         userId: "user-005", ts: base });
    await enqueuePendingLog({ action: "activity_create", userId: "user-005", ts: base + 1 });
    await enqueuePendingLog({ action: "time_out",        userId: "user-005", ts: base + 2 });

    await act(async () => {
      render(<AppWithActivityPage />);
      await flushPromises(10);
    });

    await waitFor(() => {
      expect(screen.getByTestId("activity-page").getAttribute("data-pending-count")).toBe("3");
    });

    // Use a longer advance to cover: 300ms × 2 inter-log delays + 500ms deferred refresh
    await triggerOnlineAndWaitForSync("0", { advanceMs: 1100 });

    const totalSyncCalls = syncEndpointCalls.filter(
      ({ url }) =>
        url.includes("/api/activity-logs") ||
        url.includes("/api/ModuleSales/Activity/AddLog")
    );
    // Each log processed exactly once — no duplicates from the two sync loops
    expect(totalSyncCalls).toHaveLength(3);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 6 — Re-entrant guard: two rapid "online" events → sync runs once
  //
  // Dispatching "online" twice rapidly should not cause duplicate syncing.
  // The global lock (or useOfflineSync's own syncingRef) blocks the second.
  // ─────────────────────────────────────────────────────────────────────────
  it("useOfflineSync re-entrant guard prevents duplicate sync from rapid online events", async () => {
    await enqueuePendingLog({ action: "time_in",  userId: "user-006", ts: Date.now() });
    await enqueuePendingLog({ action: "time_out", userId: "user-006", ts: Date.now() + 1 });

    await act(async () => {
      render(<AppWithActivityPage />);
      await flushPromises(10);
    });

    await waitFor(() => {
      expect(screen.getByTestId("activity-page").getAttribute("data-pending-count")).toBe("2");
    });

    setOnlineStatus(true);

    // Dispatch two online events without yielding between them
    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online")); // blocked by global lock or syncingRef
    });

    await act(async () => { await flushPromises(40); });

    // Advance through 300 ms delay + deferred refresh
    await act(async () => {
      jest.advanceTimersByTime(1100);
      await flushPromises(30);
    });

    await waitFor(
      () => {
        expect(
          screen.getByTestId("activity-page").getAttribute("data-pending-count")
        ).toBe("0");
      },
      { timeout: 6000 }
    );

    // Each log submitted exactly once — 2 total, not 4
    const totalSyncCalls = syncEndpointCalls.filter(
      ({ url }) =>
        url.includes("/api/activity-logs") ||
        url.includes("/api/ModuleSales/Activity/AddLog")
    );
    expect(totalSyncCalls).toHaveLength(2);
  });
});
