/**
 * @jest-environment jsdom
 *
 * Integration Tests — PWA Offline Launch Fix (Task 6)
 *
 * Subtask 6.1 — SW install precaches STATIC_ASSETS; navigation request
 *               offline returns app shell (status 200)
 *   Uses a vm sandbox (same approach as service-worker.test.ts) to load the
 *   real SW source and exercise both the install handler and the navigation
 *   fetch handler in sequence.
 *   Validates: Requirements 1.5, 2.8, 10.7
 *
 * Subtask 6.2 — Full offline lifecycle
 *   offline toast → online toast → sync-complete toast → no OfflineBanner
 *   Mounts OfflineStatusProvider, drives connectivity events through the
 *   stability-delay + debounce logic, and asserts toast messages and the
 *   absence of OfflineBanner at every step.
 *   Validates: Requirements 6.1, 7.1, 7.3, 8.1, 10.7
 */

import React from "react";
import fs from "fs";
import path from "path";
import vm from "vm";
import { render, screen, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

// node-fetch provides a WHATWG-compatible Response/Request that works in the
// jsdom environment (where globalThis.Response is not a constructor).
import nodeFetch from "node-fetch";
const NodeFetchResponse = nodeFetch.Response as unknown as typeof Response;
const NodeFetchRequest = nodeFetch.Request as unknown as typeof Request;

// ---------------------------------------------------------------------------
// Module-level mocks — must be declared before importing the modules they
// replace, because jest.mock() calls are hoisted to the top of the file.
// ---------------------------------------------------------------------------

jest.mock("@/lib/offline-store", () => ({
  getAllPendingLogs: jest.fn(),
  removePendingLog: jest.fn(),
  incrementRetry: jest.fn(),
  getPendingCount: jest.fn(),
  clearAllPendingLogs: jest.fn(),
  acquireSyncLock: jest.fn().mockReturnValue(true),
  releaseSyncLock: jest.fn(),
  isSyncLocked: jest.fn().mockReturnValue(false),
  resetSyncLock: jest.fn(),
}));

jest.mock("sonner", () => ({ toast: jest.fn() }));

jest.mock("@/components/OfflineBanner", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactInMock = require("react");
  return function MockOfflineBanner(props: {
    isOnline: boolean;
    isSyncing: boolean;
    pendingCount: number;
    onSyncNow?: () => void;
  }) {
    return ReactInMock.createElement("div", {
      "data-testid": "offline-banner",
      "data-is-online": String(props.isOnline),
      "data-is-syncing": String(props.isSyncing),
      "data-pending-count": String(props.pendingCount),
    });
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { OfflineStatusProvider } from "@/contexts/OfflineStatusContext";
import * as offlineStore from "@/lib/offline-store";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Helpers shared by both subtasks
// ---------------------------------------------------------------------------

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

// ---------------------------------------------------------------------------
// ── Subtask 6.1 — SW vm sandbox helpers ────────────────────────────────────
// (mirrors the pattern in __tests__/service-worker.test.ts)
// ---------------------------------------------------------------------------

const SW_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../public/service-worker.js"),
  "utf8"
);

/** Minimal Cache mock with jest.fn() methods. */
function makeCacheMock(opts: {
  matchResult?: Response | undefined;
  keysResult?: Request[];
} = {}) {
  return {
    match: jest.fn().mockResolvedValue(opts.matchResult ?? undefined),
    put: jest.fn().mockResolvedValue(undefined),
    addAll: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(true),
    keys: jest.fn().mockResolvedValue(opts.keysResult ?? []),
  };
}

type CacheMock = ReturnType<typeof makeCacheMock>;

/** Minimal CacheStorage mock. */
function makeCachesMock(opts: {
  openImpl?: (name: string) => CacheMock;
  keysResult?: string[];
} = {}) {
  const cacheStore: Record<string, CacheMock> = {};
  return {
    open: jest.fn().mockImplementation(async (name: string) => {
      if (opts.openImpl) return opts.openImpl(name);
      if (!cacheStore[name]) cacheStore[name] = makeCacheMock();
      return cacheStore[name];
    }),
    match: jest.fn().mockResolvedValue(undefined),
    keys: jest.fn().mockResolvedValue(opts.keysResult ?? []),
    delete: jest.fn().mockResolvedValue(true),
    _store: cacheStore,
  };
}

type CachesMock = ReturnType<typeof makeCachesMock>;

/** Create an isolated vm sandbox for the service worker. */
function createSWSandbox(opts: {
  caches: CachesMock;
  fetch: jest.Mock;
}) {
  const swListeners: Record<string, Array<(e: any) => void>> = {};

  const selfMock = {
    addEventListener: (type: string, handler: (e: any) => void) => {
      if (!swListeners[type]) swListeners[type] = [];
      swListeners[type].push(handler);
    },
    skipWaiting: jest.fn().mockResolvedValue(undefined),
    clients: { claim: jest.fn().mockResolvedValue(undefined) },
    registration: {
      sync: { register: jest.fn().mockResolvedValue(undefined) },
    },
    location: { origin: "https://example.com" },
  };

  // Node / jsdom Request rejects mode:"navigate" in the constructor.
  // Wrap it: strip mode from init, then patch the property manually.
  const SW_ORIGIN = "https://example.com";
  const NativeRequest = NodeFetchRequest;
  const NativeResponse = NodeFetchResponse;

  function SandboxRequest(input: any, init?: any) {
    const url =
      typeof input === "string" && !input.startsWith("http")
        ? SW_ORIGIN + input
        : input;

    const mode = init?.mode ?? "cors";
    const cleanInit = init ? { ...init } : {};
    delete cleanInit.mode;

    const req = new NativeRequest(url, cleanInit);
    try {
      Object.defineProperty(req, "mode", { value: mode, writable: false });
    } catch {
      // read-only in this env — accept default
    }
    return req;
  }
  SandboxRequest.prototype = NativeRequest.prototype;

  const sandbox: Record<string, any> = {
    self: selfMock,
    caches: opts.caches,
    fetch: opts.fetch,
    Request: SandboxRequest,
    Response: NativeResponse,
    URL,
    console,
    Promise,
    Set,
    Error,
  };

  vm.createContext(sandbox);

  function runSW() {
    vm.runInContext(SW_SOURCE, sandbox);
  }

  /** Fire install/activate; returns the waitUntil promise. */
  function fireExtendableEvent(type: "install" | "activate"): Promise<void> {
    let waitUntilPromise: Promise<void> = Promise.resolve();
    const event = {
      type,
      waitUntil(p: Promise<void>) {
        waitUntilPromise = p;
      },
    };
    for (const h of swListeners[type] ?? []) h(event);
    return waitUntilPromise;
  }

  /** Fire a fetch event; returns the promise captured by respondWith. */
  function fireFetchEvent(request: any): { respondWithPromise: Promise<Response> } {
    let respondWithPromise: Promise<Response> = Promise.resolve(
      new NativeResponse("", { status: 500 })
    );
    const event = {
      request,
      respondWith(p: Promise<Response>) {
        respondWithPromise = p;
      },
    };
    for (const h of swListeners["fetch"] ?? []) h(event);
    return { respondWithPromise };
  }

  return { sandbox, swListeners, runSW, fireExtendableEvent, fireFetchEvent, selfMock };
}

// ---------------------------------------------------------------------------
// Helper component for subtask 6.2 — exposes context values in the DOM
// ---------------------------------------------------------------------------

import { useOfflineStatus } from "@/contexts/OfflineStatusContext";

function StatusConsumer() {
  const { isOnline, isSyncing, pendingCount } = useOfflineStatus();
  return React.createElement("div", {
    "data-testid": "status",
    "data-is-online": String(isOnline),
    "data-is-syncing": String(isSyncing),
    "data-pending-count": String(pendingCount),
  });
}

// ===========================================================================
// Subtask 6.1 — SW install precaches STATIC_ASSETS + navigation offline
// ===========================================================================

describe("6.1 — SW install precaches STATIC_ASSETS; navigation request offline returns app shell", () => {
  const EXPECTED_ASSETS = [
    "/",
    "/Login",
    "/activity-planner",
    "/manifest.json",
    "/icon-192.png",
    "/icon-512.png",
    "/models/tiny_face_detector/tiny_face_detector_model.json",
    "/models/face_landmark68/face_landmark_68_model.json",
  ];

  it("install event calls cache.addAll with all 8 STATIC_ASSETS, then navigation fetch returns status 200 from cache while offline", async () => {
    // ── Build the app-shell cache mock ──────────────────────────────────
    // The navigation handler opens CACHE_NAME and calls cache.match("/").
    // We pre-load this mock with the cached app shell.
    const appShellResponse = new NodeFetchResponse("<html>app shell</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }) as unknown as Response;

    const cacheMock = makeCacheMock({ matchResult: appShellResponse });

    // All caches.open() calls return the same mock (CACHE_NAME is used by
    // both the install handler and the navigation fallback).
    const cachesMock = makeCachesMock({ openImpl: () => cacheMock });

    // Network is unavailable — any fetch() throws (simulates offline)
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));

    const { runSW, fireExtendableEvent, fireFetchEvent } = createSWSandbox({
      caches: cachesMock,
      fetch: fetchMock,
    });

    runSW();

    // ── Step 1: fire the install event and await its waitUntil ──────────
    await fireExtendableEvent("install");

    // Assert cache.addAll was called exactly once
    expect(cacheMock.addAll).toHaveBeenCalledTimes(1);

    const [addAllArg] = cacheMock.addAll.mock.calls[0];
    expect(Array.isArray(addAllArg)).toBe(true);

    // Extract URL pathnames from the Request objects passed to addAll
    const pathnames: string[] = addAllArg.map((r: any) => {
      try {
        return new URL(r.url).pathname;
      } catch {
        return String(r);
      }
    });

    // Must cover exactly all 8 assets
    expect(pathnames).toHaveLength(8);
    for (const asset of EXPECTED_ASSETS) {
      expect(pathnames).toContain(asset);
    }

    // ── Step 2: simulate a navigate fetch while offline ─────────────────
    // Create a request object with mode:"navigate" — the fetch routing
    // sends it to handleNavigationRequest, which catches the fetch throw
    // and returns cache.match("/").
    const navigateRequest = {
      url: "https://example.com/activity-planner",
      mode: "navigate" as const,
    };

    const { respondWithPromise } = fireFetchEvent(navigateRequest);
    const response = await respondWithPromise;

    // Must return a 200 response (the cached app shell)
    expect(response).toBeDefined();
    expect(response.status).toBe(200);

    // cache.match("/") was called to retrieve the app shell
    expect(cacheMock.match).toHaveBeenCalledWith("/");
  });
});

// ===========================================================================
// Subtask 6.2 — Full offline lifecycle
// ===========================================================================

describe("6.2 — Full offline lifecycle: offline toast → online toast → sync-complete toast → no OfflineBanner", () => {
  const toastMock = toast as unknown as jest.Mock;

  const getPendingCountMock = offlineStore.getPendingCount as jest.Mock;
  const getAllPendingLogsMock = offlineStore.getAllPendingLogs as jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    // Start online
    setOnlineStatus(true);

    // Provider initialises with pendingCount = 2 (so prevPendingCountRef gets set to 2)
    getPendingCountMock.mockResolvedValue(2);

    // By default syncNow finds no logs to upload
    getAllPendingLogsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    jest.runAllTimers();
    jest.useRealTimers();
    setOnlineStatus(true);
  });

  it("shows offline toast → online toast → sync-complete toast and never renders OfflineBanner", async () => {
    // ── Mount provider (isOnline=true, pendingCount→2 on mount) ─────────
    await act(async () => {
      render(
        React.createElement(
          OfflineStatusProvider,
          null,
          React.createElement(StatusConsumer, null)
        )
      );
      // Allow getPendingCount(2) to resolve and update prevPendingCountRef
      await Promise.resolve();
      await Promise.resolve();
    });

    // ── Assert no OfflineBanner on mount ────────────────────────────────
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();

    // Clear any toast calls that may have fired during mount
    toastMock.mockClear();

    // ── Step 1: go offline ───────────────────────────────────────────────
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

    // Offline toast must now be shown with the correct message and duration
    expect(toastMock).toHaveBeenCalledWith(
      "You're offline. Changes will be saved locally and synced automatically.",
      { duration: 4000 }
    );

    // OfflineBanner must still not be rendered
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();

    // ── Step 2: come back online ─────────────────────────────────────────
    toastMock.mockClear();

    // Arrange: when syncNow runs, getPendingCount returns 0 → triggers
    // sync-complete effect (prevPendingCountRef was 2, pendingCount→0)
    getPendingCountMock.mockResolvedValue(0);
    getAllPendingLogsMock.mockResolvedValue([]);

    act(() => {
      setOnlineStatus(true);
      window.dispatchEvent(new Event("online"));
    });

    // Toast must NOT have fired yet
    expect(toastMock).not.toHaveBeenCalled();

    // Advance past the 500 ms stability delay
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Online toast must now be shown
    expect(toastMock).toHaveBeenCalledWith(
      "You're back online. Syncing pending changes...",
      { duration: 3000 }
    );

    // OfflineBanner must still not be rendered
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();

    // ── Step 3: sync-complete toast (pendingCount 2 → 0 while online) ────
    // Allow the async syncNow chain (getAllPendingLogs + getPendingCount)
    // and the subsequent React state update + effect flush to settle.
    await act(async () => {
      await Promise.resolve(); // getAllPendingLogs resolves
      await Promise.resolve(); // getPendingCount resolves
      await Promise.resolve(); // setState flush
      await Promise.resolve(); // sync-complete effect
    });

    // sync-complete toast must have been called
    expect(toastMock).toHaveBeenCalledWith(
      "All offline changes have been synced.",
      { duration: 3000 }
    );

    // OfflineBanner must never have been rendered throughout the entire flow
    expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
  });
});
