/**
 * Integration Test — Banner Visible on /dashboard While Offline (Task 9.3)
 *
 * Validates that `OfflineBanner` shows "You are offline" when the device goes
 * offline, using the same `OfflineStatusProvider` that is mounted in
 * `app/layout.tsx`.
 *
 * Steps:
 *   1. Start with `navigator.onLine = true`
 *   2. Render `OfflineStatusProvider` with a child component simulating the dashboard
 *   3. Dispatch `window.dispatchEvent(new Event("offline"))`
 *   4. Assert `OfflineBanner` with "You are offline" text is present in the DOM
 *
 * Validates: Requirements 2.3
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
  usePathname: () => "/dashboard",
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are declared)
// ---------------------------------------------------------------------------

import { OfflineStatusProvider } from "@/contexts/OfflineStatusContext";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

// Minimal stand-in for the /dashboard page content
function DashboardPage() {
  return <main data-testid="dashboard-content">Dashboard</main>;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalFetch: typeof global.fetch;

beforeEach(() => {
  jest.useFakeTimers();

  // Fresh isolated IndexedDB for each test
  global.indexedDB = new IDBFactory() as unknown as IDBFactory;

  // Clean up OfflineBanner's side-effect sentinel
  if (typeof window !== "undefined") {
    delete (window as Record<string, unknown>).__prevSyncing;
  }

  // Start online
  setOnlineStatus(true);

  originalFetch = global.fetch;

  // Default fetch mock — no real network calls expected in this test
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
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
// Integration Tests
// ---------------------------------------------------------------------------

describe("Integration — Banner Visible on /dashboard While Offline", () => {
  /**
   * Core test: OfflineBanner shows "You are offline" when the offline event fires.
   * Validates: Requirements 2.3
   */
  it("shows 'You are offline' banner when the offline event is dispatched from /dashboard", async () => {
    // 1. Start online and render the provider with a dashboard-like child
    await act(async () => {
      render(
        <OfflineStatusProvider>
          <DashboardPage />
        </OfflineStatusProvider>
      );
      // Allow getPendingCount (called on mount) to resolve
      await Promise.resolve();
      await Promise.resolve();
    });

    // Confirm the dashboard content rendered and the banner is absent while online
    expect(screen.getByTestId("dashboard-content")).toBeInTheDocument();
    expect(screen.queryByText(/you are offline/i)).not.toBeInTheDocument();

    // 2. Go offline
    setOnlineStatus(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      await Promise.resolve();
      await Promise.resolve();
    });

    // 3. Assert the "You are offline" banner is now visible
    await waitFor(() => {
      expect(screen.getByText(/you are offline/i)).toBeInTheDocument();
    });
  });

  /**
   * Verify the banner disappears again when connectivity is restored.
   * Validates: Requirements 2.3 (nothing shown when fully online with no pending)
   */
  it("hides the offline banner when connectivity is restored", async () => {
    await act(async () => {
      render(
        <OfflineStatusProvider>
          <DashboardPage />
        </OfflineStatusProvider>
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Go offline
    setOnlineStatus(false);
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/you are offline/i)).toBeInTheDocument();
    });

    // Come back online (no pending records → banner should disappear)
    setOnlineStatus(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      // Allow sync engine and state updates to settle
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    await waitFor(() => {
      expect(screen.queryByText(/you are offline/i)).not.toBeInTheDocument();
    });
  });
});
