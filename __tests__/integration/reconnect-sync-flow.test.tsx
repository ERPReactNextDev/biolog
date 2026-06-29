/**
 * Integration Test — Full Reconnect Sync Flow (Task 9.2)
 *
 * Validates end-to-end reconnect sync:
 *   1. Enqueue 3 pending logs via `enqueuePendingLog` while offline
 *   2. Render `OfflineStatusProvider` (which renders `OfflineBanner` internally)
 *   3. Simulate `window.dispatchEvent(new Event("online"))`
 *   4. Assert all 3 records are processed by the sync engine → pendingCount reaches 0
 *   5. Assert `OfflineBanner` flashes "All records synced successfully"
 *   6. Assert the banner disappears after 2.5 s
 *
 * Validates: Requirements 2.6
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
// Set up fake IndexedDB BEFORE importing any module that touches IDB.
// We use a fresh IDBFactory per test (see beforeEach) so tests are isolated.
// ---------------------------------------------------------------------------
import { IDBFactory, IDBKeyRange as fakeIDBKeyRange } from "fake-indexeddb";

beforeAll(() => {
  if (typeof global.IDBKeyRange === "undefined") {
    global.IDBKeyRange = fakeIDBKeyRange as unknown as typeof IDBKeyRange;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// next/navigation — not needed by the provider, but imported transitively
// by some components; mock to avoid "invariant failed" errors.
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => "/",
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import { OfflineStatusProvider } from "@/contexts/OfflineStatusContext";
import { enqueuePendingLog } from "@/lib/offline-store";

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalFetch: typeof global.fetch;

beforeEach(() => {
  jest.useFakeTimers();

  // Fresh isolated IndexedDB for each test — prevents cross-test contamination
  global.indexedDB = new IDBFactory() as unknown as IDBFactory;

  // Clean up the window.__prevSyncing side-effect used by OfflineBanner
  if (typeof window !== "undefined") {
    delete (window as Record<string, unknown>).__prevSyncing;
  }

  // Start offline so we can enqueue logs without triggering premature sync
  setOnlineStatus(false);

  // Save real fetch
  originalFetch = global.fetch;

  // Default fetch mock: all POSTs to /api/activity-logs succeed.
  // Use a plain object that satisfies the checks in OfflineStatusProvider's
  // syncNow (response.ok / response.status) without needing the Response constructor.
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true }),
    text: () => Promise.resolve(""),
  });
});

afterEach(() => {
  cleanup();
  jest.runAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
  setOnlineStatus(true);
  if (typeof window !== "undefined") {
    delete (window as Record<string, unknown>).__prevSyncing;
  }
});

// ---------------------------------------------------------------------------
// Helper component — reads context values and exposes them in the DOM
// ---------------------------------------------------------------------------

import { useOfflineStatus } from "@/contexts/OfflineStatusContext";

function StatusConsumer() {
  const { isOnline, isSyncing, pendingCount } = useOfflineStatus();
  return (
    <div
      data-testid="status"
      data-is-online={String(isOnline)}
      data-is-syncing={String(isSyncing)}
      data-pending-count={String(pendingCount)}
    />
  );
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe("Integration — Full Reconnect Sync Flow", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Test 1 — pendingCount reaches 0 after 3 pending logs are synced (Req 2.6)
  // ─────────────────────────────────────────────────────────────────────────

  it("processes all 3 pending logs and reaches pendingCount === 0 after coming online", async () => {
    // Enqueue 3 logs while offline (IDB writes)
    await enqueuePendingLog({ action: "time_in", userId: "u1", ts: Date.now() });
    await enqueuePendingLog({ action: "time_out", userId: "u1", ts: Date.now() + 1 });
    await enqueuePendingLog({ action: "activity_create", userId: "u1", ts: Date.now() + 2 });

    // Render the provider (OfflineBanner is rendered inside it)
    await act(async () => {
      render(
        <OfflineStatusProvider>
          <StatusConsumer />
        </OfflineStatusProvider>
      );
      // Let getPendingCount (called on mount) resolve
      await Promise.resolve();
      await Promise.resolve();
    });

    // Mount should reflect 3 pending logs
    await waitFor(() => {
      const status = screen.getByTestId("status");
      expect(status.getAttribute("data-pending-count")).toBe("3");
    });

    // Come back online — triggers the sync engine
    setOnlineStatus(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      // Allow all chained promises (IDB reads, fetch calls, state updates) to
      // settle.  We run multiple microtask ticks since the sync loop is async.
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    // pendingCount must reach 0 once all logs are successfully uploaded
    await waitFor(
      () => {
        const status = screen.getByTestId("status");
        expect(status.getAttribute("data-pending-count")).toBe("0");
      },
      { timeout: 3000 }
    );

    // All 3 logs posted to the sync endpoint
    const fetchMock = global.fetch as jest.Mock;
    const syncCalls = fetchMock.mock.calls.filter(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes("/api/activity-logs") &&
        opts?.method === "POST"
    );
    expect(syncCalls).toHaveLength(3);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 2 — OfflineBanner shows "All records synced successfully" flash (Req 2.6)
  // ─────────────────────────────────────────────────────────────────────────

  it("shows 'All records synced successfully' banner after sync completes", async () => {
    // Enqueue 3 logs while offline
    await enqueuePendingLog({ action: "time_in", userId: "u2", ts: Date.now() });
    await enqueuePendingLog({ action: "time_out", userId: "u2", ts: Date.now() + 1 });
    await enqueuePendingLog({ action: "note_save", userId: "u2", ts: Date.now() + 2 });

    await act(async () => {
      render(
        <OfflineStatusProvider>
          <StatusConsumer />
        </OfflineStatusProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Confirm 3 pending before sync
    await waitFor(() => {
      expect(screen.getByTestId("status").getAttribute("data-pending-count")).toBe("3");
    });

    // Come back online
    setOnlineStatus(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    // Wait for sync to complete and pendingCount to reach 0
    await waitFor(
      () => {
        expect(screen.getByTestId("status").getAttribute("data-pending-count")).toBe("0");
      },
      { timeout: 3000 }
    );

    // The "All records synced successfully" flash banner should now be visible.
    // OfflineBanner detects the isSyncing true→false transition with pendingCount===0
    // and renders this message.
    await waitFor(
      () => {
        expect(
          screen.getByText(/all records synced successfully/i)
        ).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 3 — The success banner disappears after 2.5 s (Req 2.3, 2.6)
  // ─────────────────────────────────────────────────────────────────────────

  it("sync success banner disappears after 2.5 seconds", async () => {
    // Enqueue 3 logs while offline
    await enqueuePendingLog({ action: "time_in", userId: "u3", ts: Date.now() });
    await enqueuePendingLog({ action: "time_out", userId: "u3", ts: Date.now() + 1 });
    await enqueuePendingLog({ action: "activity_edit", userId: "u3", ts: Date.now() + 2 });

    await act(async () => {
      render(
        <OfflineStatusProvider>
          <StatusConsumer />
        </OfflineStatusProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("status").getAttribute("data-pending-count")).toBe("3");
    });

    // Come back online and let sync complete
    setOnlineStatus(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    // Wait for the success banner to appear
    await waitFor(
      () => {
        expect(
          screen.getByText(/all records synced successfully/i)
        ).toBeInTheDocument();
      },
      { timeout: 3000 }
    );

    // Advance fake timers past the 2500 ms auto-hide timeout
    await act(async () => {
      jest.advanceTimersByTime(2600);
      // Flush any React state updates triggered by the timer
      await Promise.resolve();
    });

    // Banner should no longer be in the DOM
    expect(
      screen.queryByText(/all records synced successfully/i)
    ).not.toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test 4 — Re-entrant guard: two rapid "online" events only trigger one sync
  // ─────────────────────────────────────────────────────────────────────────

  it("calls the sync endpoint exactly 3 times (not 6) when 'online' fires twice rapidly", async () => {
    await enqueuePendingLog({ action: "a", userId: "u4", ts: Date.now() });
    await enqueuePendingLog({ action: "b", userId: "u4", ts: Date.now() + 1 });
    await enqueuePendingLog({ action: "c", userId: "u4", ts: Date.now() + 2 });

    await act(async () => {
      render(
        <OfflineStatusProvider>
          <StatusConsumer />
        </OfflineStatusProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("status").getAttribute("data-pending-count")).toBe("3");
    });

    setOnlineStatus(true);

    // Dispatch two online events without awaiting in between
    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online")); // should be blocked by re-entrant guard
    });

    // Flush the sync
    await act(async () => {
      for (let i = 0; i < 30; i++) {
        await Promise.resolve();
      }
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("status").getAttribute("data-pending-count")).toBe("0");
      },
      { timeout: 3000 }
    );

    // Each log should be uploaded exactly once — not duplicated by the second event
    const fetchMock = global.fetch as jest.Mock;
    const syncCalls = fetchMock.mock.calls.filter(
      ([url, opts]) =>
        typeof url === "string" &&
        url.includes("/api/activity-logs") &&
        opts?.method === "POST"
    );
    expect(syncCalls).toHaveLength(3);
  });
});
