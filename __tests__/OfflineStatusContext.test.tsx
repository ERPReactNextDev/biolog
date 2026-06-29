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
    await act(async () => {
      setOnlineStatus(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(getByTestId("consumer").getAttribute("data-is-online")).toBe("false");
  });

  // ---------------------------------------------------------------------------
  // Test 2: isOnline changes to true on "online" event
  // ---------------------------------------------------------------------------

  it("sets isOnline to true when window fires an 'online' event after going offline", async () => {
    // Start offline
    setOnlineStatus(false);

    const { getByTestId } = render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Trigger the offline event so initial state reflects offline
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(getByTestId("consumer").getAttribute("data-is-online")).toBe("false");

    // Now come back online
    await act(async () => {
      setOnlineStatus(true);
      window.dispatchEvent(new Event("online"));
      // Allow syncNow promise to settle
      await Promise.resolve();
    });

    expect(getByTestId("consumer").getAttribute("data-is-online")).toBe("true");
  });

  // ---------------------------------------------------------------------------
  // Test 3: Sync re-entrant guard — two rapid "online" events only trigger
  //         syncNow logic once
  // ---------------------------------------------------------------------------

  it("calls getAllPendingLogs only once when two 'online' events fire in quick succession", async () => {
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
  });

  // ---------------------------------------------------------------------------
  // Test 4: OfflineBanner is rendered with correct props from provider state
  // ---------------------------------------------------------------------------

  it("renders OfflineBanner inside the provider with props wired from provider state", async () => {
    setOnlineStatus(true);

    render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // OfflineBanner must always be present in the tree (it decides internally
    // whether to show anything)
    const banner = screen.getByTestId("offline-banner");
    expect(banner).toBeInTheDocument();

    // Props must reflect provider state
    expect(banner.getAttribute("data-is-online")).toBe("true");
    expect(banner.getAttribute("data-is-syncing")).toBe("false");
    expect(banner.getAttribute("data-pending-count")).toBe("0");
    expect(banner.getAttribute("data-has-sync-now")).toBe("true");
  });

  it("passes updated isOnline=false to OfflineBanner when device goes offline", async () => {
    setOnlineStatus(true);

    render(
      <OfflineStatusProvider>
        <ContextConsumer />
      </OfflineStatusProvider>
    );

    // Initially online — banner reflects that
    expect(screen.getByTestId("offline-banner").getAttribute("data-is-online")).toBe("true");

    // Go offline
    await act(async () => {
      setOnlineStatus(false);
      window.dispatchEvent(new Event("offline"));
    });

    // Banner should now reflect offline state
    expect(screen.getByTestId("offline-banner").getAttribute("data-is-online")).toBe("false");
  });

  it("passes pendingCount from store to OfflineBanner on mount", async () => {
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

    await waitFor(() => {
      expect(
        screen.getByTestId("offline-banner").getAttribute("data-pending-count")
      ).toBe("3");
    });
  });
});
