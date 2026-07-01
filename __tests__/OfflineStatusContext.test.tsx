/**
 * Unit Tests for D3/D6 — OfflineStatusProvider (Task 8.4)
 *
 * Tests:
 *  1. isOnline state changes to false when window.dispatchEvent(new Event("offline")) fires
 *  2. isOnline state changes to true when window.dispatchEvent(new Event("online")) fires
 *  3. Sync re-entrant guard: dispatching "online" twice in quick succession calls syncNow
 *     logic only once (second call returns early while isSyncing === true)
 *  4. OfflineBanner is rendered inside the provider with correct props wired from provider state
 *
 * Validates: Requirements 2.3, 2.6
 */

import React from "react";
import { render, screen, act, cleanup, waitFor } from "@testing-library/react";
import * as fc from "fast-check";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that reference them
// ---------------------------------------------------------------------------

// Mock offline-store so we never touch real IndexedDB in jsdom
jest.mock("@/lib/offline-store", () => ({
  getAllPendingLogs: jest.fn(),
  removePendingLog: jest.fn(),
  incrementRetry: jest.fn(),
  getPendingCount: jest.fn(),
  clearAllPendingLogs: jest.fn(),
  getItem: jest.fn(),
  setItem: jest.fn(),
  deleteItem: jest.fn(),
  getAllItems: jest.fn(),
  runExpiry: jest.fn(),
  withTransaction: jest.fn(),
  // Global sync lock exports (added for Req 3.9 no-duplicate guarantee)
  acquireSyncLock: jest.fn().mockReturnValue(true),
  releaseSyncLock: jest.fn(),
  isSyncLocked: jest.fn().mockReturnValue(false),
  resetSyncLock: jest.fn(),
}));

// Mock sonner so we can assert toast calls without needing a real DOM toast layer
jest.mock("sonner", () => ({ toast: jest.fn() }));

// Mock OfflineBanner so we can assert on the exact props passed to it
// without dealing with its internal window.__prevSyncing side-effects
jest.mock("@/components/OfflineBanner", () => {
  return function MockOfflineBanner(props: {
    isOnline: boolean;
    isSyncing: boolean;
    pendingCount: number;
    onSyncNow: () => void;
  }) {
    return (
      <div
        data-testid="offline-banner"
        data-is-online={String(props.isOnline)}
        data-is-syncing={String(props.isSyncing)}
        data-pending-count={String(props.pendingCount)}
        data-has-sync-now={typeof props.onSyncNow === "function" ? "true" : "false"}
      />
    );
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { OfflineStatusProvider, useOfflineStatus } from "@/contexts/OfflineStatusContext";
import * as offlineStore from "@/lib/offline-store";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A simple consumer component that exposes the context value in the DOM. */
function ContextConsumer() {
  const { isOnline, isSyncing, pendingCount } = useOfflineStatus();
  return (
    <div
      data-testid="consumer"
      data-is-online={String(isOnline)}
      data-is-syncing={String(isSyncing)}
      data-pending-count={String(pendingCount)}
    />
  );
}

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const getPendingCountMock = offlineStore.getPendingCount as jest.Mock;
const getAllPendingLogsMock = offlineStore.getAllPendingLogs as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();

  // Default: device is online
  setOnlineStatus(true);

  // getPendingCount is called on mount — return 0 by default
  getPendingCountMock.mockResolvedValue(0);

  // getAllPendingLogs is called by syncNow — return empty array by default
  getAllPendingLogsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  setOnlineStatus(true);
});

// ---------------------------------------------------------------------------
// Test 1: isOnline changes to false on "offline" event
// ---------------------------------------------------------------------------

describe("OfflineStatusProvider — online/offline event listeners", () => {
  it("sets isOnline to false when window fires an 'offline' event", async () => {
    jest.useFakeTimers();
    // Start online
    setOnlineStatus(true);

    const { getByTestId } = render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Initially online
    expect(getByTestId("consumer").getAttribute("data-is-online")).toBe("true");

    // Simulate going offline
    act(() => {
      setOnlineStatus(false);
      window.dispatchEvent(new Event("offline"));
      jest.advanceTimersByTime(600); // advance past 500ms stability delay
    });

    expect(getByTestId("consumer").getAttribute("data-is-online")).toBe("false");
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Test 2: isOnline changes to true on "online" event
  // ---------------------------------------------------------------------------

  it("sets isOnline to true when window fires an 'online' event after going offline", async () => {
    jest.useFakeTimers();
    // Start offline
    setOnlineStatus(false);

    const { getByTestId } = render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Trigger the offline event so initial state reflects offline
    act(() => {
      window.dispatchEvent(new Event("offline"));
      jest.advanceTimersByTime(600);
    });

    expect(getByTestId("consumer").getAttribute("data-is-online")).toBe("false");

    // Now come back online
    act(() => {
      setOnlineStatus(true);
      window.dispatchEvent(new Event("online"));
      jest.advanceTimersByTime(600);
    });

    expect(getByTestId("consumer").getAttribute("data-is-online")).toBe("true");
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Test 3: Sync re-entrant guard — two rapid "online" events only trigger
  //         syncNow logic once
  // ---------------------------------------------------------------------------

  it("calls getAllPendingLogs only once when two 'online' events fire in quick succession", async () => {
    jest.useFakeTimers();
    setOnlineStatus(true);

    // Make getAllPendingLogs slow so the first call is still in-flight when
    // the second "online" event fires, ensuring syncingRef.current === true
    // for the second call.
    let resolveFirstSync!: () => void;
    const firstSyncPromise = new Promise<void>((res) => {
      resolveFirstSync = res;
    });

    getAllPendingLogsMock.mockImplementationOnce(() => firstSyncPromise.then(() => []));

    render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Dispatch two online events without awaiting in between
    act(() => {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online")); // second — should be a no-op
      jest.advanceTimersByTime(600); // advance past stability delay for both events
    });

    // Resolve the first (and only) sync that got past the guard
    await act(async () => {
      resolveFirstSync();
      await Promise.resolve();
    });

    // The re-entrant guard must have blocked the second call:
    // getAllPendingLogs is the first IDB call inside syncNow — if it was
    // called twice, the guard failed.
    expect(getAllPendingLogsMock).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Test 4: OfflineBanner is rendered with correct props from provider state
  // ---------------------------------------------------------------------------

  it("does NOT render OfflineBanner inside the provider (banner removed from provider JSX)", async () => {
    setOnlineStatus(true);

    render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // OfflineBanner must NOT be present in the tree — provider no longer mounts it
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  it("does not render OfflineBanner after going offline (banner removed from provider)", async () => {
    setOnlineStatus(true);

    render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Banner must never be present regardless of connectivity state
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();

    // Go offline — banner still must not appear
    await act(async () => {
      setOnlineStatus(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });

  it("does not render OfflineBanner on mount regardless of pendingCount (banner removed from provider)", async () => {
    setOnlineStatus(true);
    getPendingCountMock.mockResolvedValue(3);

    await act(async () => {
      render(
        <OfflineStatusProvider>
          <ContextConsumer />
        </OfflineStatusProvider>
      );
      // Allow the getPendingCount promise to settle
      await Promise.resolve();
    });

    // Banner must not be in the tree — provider no longer renders it
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task 5.1 — Offline toast shown with correct message after stability delay
// Validates: Requirements 6.1, 6.2, 10.3
// ---------------------------------------------------------------------------

describe("OfflineStatusProvider — toast notifications", () => {
  // toast is mocked at module level via jest.mock("sonner") — cast through unknown
  // to satisfy TypeScript since the mock type doesn't match the real sonner signature.
  const toastMock = toast as unknown as jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    toastMock.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows offline toast with correct message and duration after the 500 ms stability delay", () => {
    setOnlineStatus(true);

    render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Dispatch the "offline" event — handler queues a 500 ms stability timer
    act(() => {
      setOnlineStatus(false);
      window.dispatchEvent(new Event("offline"));
    });

    // Toast must NOT have fired yet (stability delay hasn't elapsed)
    expect(toastMock).not.toHaveBeenCalled();

    // Advance past the 500 ms stability delay
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Now the toast should have been called with the offline message
    expect(toastMock).toHaveBeenCalledWith(
      "You're offline. Changes will be saved locally and synced automatically.",
      { duration: 4000 }
    );
  });

  // ---------------------------------------------------------------------------
  // Task 5.2 — Online toast shown with correct message after stability delay
  // Validates: Requirements 7.1, 7.2, 10.4
  // ---------------------------------------------------------------------------

  it("shows online toast with correct message and duration after the 500 ms stability delay", () => {
    // Start the provider in an offline state
    setOnlineStatus(false);

    render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Commit the offline state by firing "offline" and advancing past the stability delay
    act(() => {
      window.dispatchEvent(new Event("offline"));
      jest.advanceTimersByTime(500);
    });

    // Clear any toast calls from the offline transition before testing the online one
    toastMock.mockClear();

    // Simulate device coming back online — handler queues a 500 ms stability timer
    act(() => {
      setOnlineStatus(true);
      window.dispatchEvent(new Event("online"));
    });

    // Toast must NOT have fired yet (stability delay hasn't elapsed)
    expect(toastMock).not.toHaveBeenCalled();

    // Advance past the 500 ms stability delay
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Now the online toast should have been called with the reconnect message
    expect(toastMock).toHaveBeenCalledWith(
      "You're back online. Syncing pending changes...",
      { duration: 3000 }
    );
  });

  // ---------------------------------------------------------------------------
  // Task 5.4 — Debounce suppresses second offline toast within DEBOUNCE_WINDOW_MS
  // Validates: Requirements 5.3, 6.3, 10.5
  // ---------------------------------------------------------------------------

  it("does not show a second offline toast when a second 'offline' event fires within the 5 s debounce window", () => {
    setOnlineStatus(true);

    render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // ── First offline event ───────────────────────────────────────────────
    // Dispatch "offline", let the 500 ms stability delay fire → first toast shown
    act(() => {
      setOnlineStatus(false);
      window.dispatchEvent(new Event("offline"));
      jest.advanceTimersByTime(500);
    });

    // Confirm the first offline toast fired
    expect(toastMock).toHaveBeenCalledWith(
      "You're offline. Changes will be saved locally and synced automatically.",
      { duration: 4000 }
    );
    const callCountAfterFirst = toastMock.mock.calls.length;

    // ── Advance 1 s (still inside the 5 s debounce window) ───────────────
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // ── Briefly go online then offline again (within the debounce window) ─
    act(() => {
      setOnlineStatus(true);
      window.dispatchEvent(new Event("online"));
      jest.advanceTimersByTime(500); // stability delay — commits online state
    });

    act(() => {
      setOnlineStatus(false);
      window.dispatchEvent(new Event("offline"));
      jest.advanceTimersByTime(500); // stability delay — second offline fires here
    });

    // The total elapsed time since the first offline toast is 1000 + 500 + 500 = 2000 ms,
    // well within the 5000 ms DEBOUNCE_WINDOW_MS, so no second offline toast must fire.
    const offlineToastCalls = toastMock.mock.calls.filter(
      ([msg]) => msg === "You're offline. Changes will be saved locally and synced automatically."
    );
    expect(offlineToastCalls).toHaveLength(1);

    // Total toast call count for offline must not have increased beyond the first
    const offlineCallsNow = toastMock.mock.calls.filter(
      ([msg]) => msg === "You're offline. Changes will be saved locally and synced automatically."
    ).length;
    expect(offlineCallsNow).toBe(callCountAfterFirst > 0 ? 1 : 0);
  });

  // ---------------------------------------------------------------------------
  // Task 5.5 — Stability delay suppresses flapping: rapid offline→online within
  //            500 ms does NOT commit offline state
  // Validates: Requirements 5.2, 10.6
  // ---------------------------------------------------------------------------

  it("does not commit offline state when 'online' fires within 500 ms of 'offline' (flap suppression)", () => {
    setOnlineStatus(true);

    const { getByTestId } = render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Confirm initial state is online
    expect(getByTestId("consumer").getAttribute("data-is-online")).toBe("true");

    // Dispatch "offline" — starts the 500 ms stability timer
    act(() => {
      setOnlineStatus(false);
      window.dispatchEvent(new Event("offline"));
    });

    // Advance 200 ms — stability timer has NOT yet fired; dispatch "online"
    // This cancels the pending offline timer and starts a new 500 ms online timer
    act(() => {
      jest.advanceTimersByTime(200);
      setOnlineStatus(true);
      window.dispatchEvent(new Event("online"));
    });

    // Advance the remaining 500 ms so the online timer commits online state
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // isOnline must remain true — the offline state was never committed
    expect(getByTestId("consumer").getAttribute("data-is-online")).toBe("true");

    // No offline toast must have been shown — the offline timer was cancelled
    const offlineToastCalls = toastMock.mock.calls.filter(
      ([msg]) => msg === "You're offline. Changes will be saved locally and synced automatically."
    );
    expect(offlineToastCalls).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Task 5.3 — Sync-complete toast shown when pendingCount transitions from >0
  //            to 0 while online
  // Validates: Requirements 7.3, 7.4, 10.5
  // ---------------------------------------------------------------------------

  it("shows sync-complete toast when pendingCount transitions from 2 to 0 while online", async () => {
    // Phase 1: mount with pendingCount = 2 so prevPendingCountRef starts at 2
    // after the initial getPendingCount resolves.
    setOnlineStatus(true);
    getPendingCountMock.mockResolvedValue(2);

    render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Let the initial getPendingCount(2) promise settle so prevPendingCountRef
    // is updated to 2 by the sync-complete effect.
    await act(async () => {
      await Promise.resolve();
    });

    // Clear any spurious toast calls that may have occurred during mount
    toastMock.mockClear();

    // Phase 2: simulate pendingCount dropping to 0.
    // syncNow fetches getAllPendingLogs first (return []) then calls
    // getPendingCount() at the end to refresh the count — mock it to 0 now.
    getPendingCountMock.mockResolvedValue(0);
    getAllPendingLogsMock.mockResolvedValue([]);

    // Trigger syncNow by dispatching "online" and advancing past the stability delay
    act(() => {
      window.dispatchEvent(new Event("online"));
      jest.advanceTimersByTime(500);
    });

    // Allow the async syncNow chain (getAllPendingLogs + getPendingCount) to settle
    await act(async () => {
      await Promise.resolve(); // microtask: getAllPendingLogs resolves
      await Promise.resolve(); // microtask: getPendingCount resolves
      await Promise.resolve(); // microtask: setState + effect flush
    });

    // The sync-complete toast must have been called with the correct message
    expect(toastMock).toHaveBeenCalledWith(
      "All offline changes have been synced.",
      { duration: 3000 }
    );
  });

  // ---------------------------------------------------------------------------
  // Task 5.7 — Property 2: Stability Delay
  // FOR ALL rapid event sequences (inter-event gap < 500 ms), the committed
  // isOnline state after the sequence ends equals the final event's value.
  // Validates: Requirements 5.2, 10.10
  // ---------------------------------------------------------------------------

  it("Property 2: committed isOnline state equals the final event in any rapid sequence", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }),
        (events) => {
          const { getByTestId } = render(
            <OfflineStatusProvider>
              <ContextConsumer />
            </OfflineStatusProvider>
          );

          // Dispatch each event with 100 ms gap (< 500 ms stability delay),
          // so each new event cancels the previous pending stability timer.
          for (const goingOnline of events) {
            act(() => {
              setOnlineStatus(goingOnline);
              window.dispatchEvent(new Event(goingOnline ? "online" : "offline"));
              jest.advanceTimersByTime(100); // less than STABILITY_DELAY_MS
            });
          }

          // Advance past the stability delay to commit the final pending state
          act(() => {
            jest.advanceTimersByTime(500);
          });

          const finalEvent = events[events.length - 1];
          expect(
            getByTestId("consumer").getAttribute("data-is-online")
          ).toBe(String(finalEvent));

          // Reset DOM between property runs to avoid accumulation
          cleanup();
        }
      )
    );
  });
});
