/**
 * @jest-environment node
 *
 * Unit Tests for Service Worker (`public/service-worker.js`)
 * Tasks 4.1 – 4.7
 *
 * Strategy: for each test, create an isolated vm sandbox that has the
 * SW globals (caches, fetch, self, Request, Response, URL) wired to jest
 * mocks, then run the SW source inside that sandbox. This lets us test the
 * real function implementations while avoiding `const` re-declaration errors
 * across tests.
 *
 * Uses `@jest-environment node` so Node 18+'s native Request/Response/fetch
 * are available on globalThis without needing jsdom or additional polyfills.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 2.2, 2.3, 2.7, 2.8, 2.9,
 *            3.2, 4.1, 4.2, 10.1, 10.2, 10.7
 */

import fs from "fs";
import path from "path";
import vm from "vm";
import fc from "fast-check";

// Node 18+ provides Request/Response natively on globalThis.
// Cast to avoid TS "possibly undefined" when strictness is high.
const SWRequest = globalThis.Request;
const SWResponse = globalThis.Response;

// ---------------------------------------------------------------------------
// Read SW source once
// ---------------------------------------------------------------------------
const SW_SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../public/service-worker.js"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Helpers — minimal mock builders
// ---------------------------------------------------------------------------

/** Build a minimal Cache mock with jest.fn() methods. */
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

/**
 * Build a minimal CacheStorage mock.
 * @param openImpl  Called whenever code calls `caches.open(name)`.
 *                  If omitted, each cache name gets its own fresh CacheMock.
 */
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

// ---------------------------------------------------------------------------
// vm sandbox helpers
// ---------------------------------------------------------------------------

/**
 * Each test gets its own isolated vm sandbox.
 * The sandbox exposes the minimal set of SW globals, all wired to jest mocks.
 *
 * Returns:
 *   - sandbox: the vm context object (read functions off it after runSW)
 *   - swListeners: map from event type → array of registered handlers
 *   - runSW(): evaluates the SW source inside the sandbox
 *   - fireExtendableEvent(): fires install/activate and returns the waitUntil promise
 */
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

  // The sandbox provides every global the SW file references.
  //
  // We wrap the native Request constructor to:
  //  a) Resolve relative URLs against a fake origin (so `new Request("/", ...)` works)
  //  b) Accept `mode: "navigate"` by stripping it from the init object and setting
  //     the mode property manually (Node's Request rejects mode:"navigate").
  //
  const SW_ORIGIN = "https://example.com";
  function SandboxRequest(input: any, init?: any) {
    const url = typeof input === "string" && !input.startsWith("http")
      ? SW_ORIGIN + input
      : input;

    let mode = init?.mode ?? "cors";
    const cleanInit = init ? { ...init } : {};
    delete cleanInit.mode; // strip mode before passing to constructor

    const req = new SWRequest(url, cleanInit);
    // Patch the mode property (it's normally read-only but we define it)
    try {
      Object.defineProperty(req, "mode", { value: mode, writable: false });
    } catch {
      // If defineProperty fails, we accept the default mode
    }
    return req;
  }
  // Mirror static properties
  SandboxRequest.prototype = SWRequest.prototype;

  const sandbox: Record<string, any> = {
    self: selfMock,
    caches: opts.caches,
    fetch: opts.fetch,
    Request: SandboxRequest,
    Response: SWResponse,
    URL,        // Node's built-in URL is available globally
    console,
    Promise,
    Set,
    Error,
  };

  vm.createContext(sandbox);

  function runSW() {
    vm.runInContext(SW_SOURCE, sandbox);
  }

  /** Fire a fake ExtendableEvent for install/activate; returns the waitUntil promise. */
  function fireExtendableEvent(type: "install" | "activate"): Promise<void> {
    let waitUntilPromise: Promise<void> = Promise.resolve();
    const event = {
      type,
      waitUntil(p: Promise<void>) {
        waitUntilPromise = p;
      },
    };
    for (const h of (swListeners[type] ?? [])) h(event);
    return waitUntilPromise;
  }

  return { sandbox, swListeners, runSW, fireExtendableEvent, selfMock };
}

/** Create a minimal navigate-mode request object for testing SW navigation handlers. */
function makeNavigateRequest(url: string): Request {
  // Node's Request constructor rejects mode:'navigate'.
  // The SW only reads .url and .mode from navigation requests, so a plain
  // object that matches those properties is sufficient.
  return { url, mode: "navigate" } as unknown as Request;
}

describe("Service Worker", () => {
  // -------------------------------------------------------------------------
  // 4.1  Navigation offline → returns cached app shell (status 200)
  // -------------------------------------------------------------------------
  describe("4.1 navigation request offline returns cached app shell (status 200)", () => {
    it("returns status 200 from cache when fetch rejects with TypeError", async () => {
      const cachedAppShell = new SWResponse("<html>app shell</html>", { status: 200 });
      const appShellCacheMock = makeCacheMock({ matchResult: cachedAppShell });
      const cachesMock = makeCachesMock({ openImpl: () => appShellCacheMock });
      const fetchMock = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));

      const { sandbox, runSW } = createSWSandbox({
        caches: cachesMock,
        fetch: fetchMock,
      });
      runSW();

      const request = makeNavigateRequest("https://example.com/activity-planner");
      const response = await sandbox.handleNavigationRequest(request);

      expect(response).toBeInstanceOf(SWResponse);
      expect(response.status).toBe(200);
      // cache.match("/") must have been called to retrieve the app shell
      expect(appShellCacheMock.match).toHaveBeenCalledWith("/");
    });
  });

  // -------------------------------------------------------------------------
  // 4.2  API routes are NOT intercepted by navigation fallback
  // -------------------------------------------------------------------------
  describe("4.2 navigation request to /api/anything is NOT intercepted by navigation fallback", () => {
    it("returns the network response for an API route when fetch succeeds", async () => {
      // handleNavigationRequest: tries fetch first; if response.ok, returns it directly.
      // For API routes with mode=navigate, network wins if available.
      const networkResponse = new SWResponse('{"data":true}', { status: 200 });
      const appShellCacheMock = makeCacheMock({
        matchResult: new SWResponse("<html/>", { status: 200 }),
      });
      const cachesMock = makeCachesMock({ openImpl: () => appShellCacheMock });
      const fetchMock = jest.fn().mockResolvedValue(networkResponse);

      const { sandbox, runSW } = createSWSandbox({ caches: cachesMock, fetch: fetchMock });
      runSW();

      const request = makeNavigateRequest("https://example.com/api/anything");
      const response = await sandbox.handleNavigationRequest(request);

      // Network succeeded → network response returned; cache never consulted
      expect(response).toBe(networkResponse);
      expect(appShellCacheMock.match).not.toHaveBeenCalled();
    });

    it("does not invoke handleNavigationRequest for requests with mode != navigate", async () => {
      // The fetch handler uses request.mode === "navigate" as the routing gate.
      // A cors-mode request must skip the navigation handler entirely.
      const cachesMock = makeCachesMock();
      cachesMock.match = jest
        .fn()
        .mockResolvedValue(new SWResponse("cached", { status: 200 }));
      const fetchMock = jest.fn();

      const { sandbox, swListeners, runSW } = createSWSandbox({
        caches: cachesMock,
        fetch: fetchMock,
      });
      runSW();

      // Track whether handleNavigationRequest is called via sandbox override
      const originalNav = sandbox.handleNavigationRequest;
      let navCalled = false;
      sandbox.handleNavigationRequest = (...args: any[]) => {
        navCalled = true;
        return originalNav(...args);
      };

      const request = new SWRequest("https://example.com/api/anything", {
        mode: "cors",
      });
      const fetchEvent = {
        request,
        respondWith: jest.fn(),
      };

      for (const h of (swListeners["fetch"] ?? [])) h(fetchEvent);

      expect(navCalled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4.3  Install event precaches all STATIC_ASSETS
  // -------------------------------------------------------------------------
  describe("4.3 install event precaches all STATIC_ASSETS", () => {
    it("calls cache.addAll with requests matching all 8 STATIC_ASSETS entries", async () => {
      const cacheMock = makeCacheMock();
      const cachesMock = makeCachesMock({ openImpl: () => cacheMock });
      const fetchMock = jest.fn();

      const { runSW, fireExtendableEvent } = createSWSandbox({
        caches: cachesMock,
        fetch: fetchMock,
      });
      runSW();

      await fireExtendableEvent("install");

      expect(cacheMock.addAll).toHaveBeenCalledTimes(1);

      const [addAllArg] = cacheMock.addAll.mock.calls[0];
      expect(Array.isArray(addAllArg)).toBe(true);

      // Extract pathnames from Request objects passed to addAll
      const urls: string[] = addAllArg.map((r: Request) => {
        try {
          return new URL(r.url).pathname;
        } catch {
          return String(r);
        }
      });

      const expectedAssets = [
        "/",
        "/Login",
        "/activity-planner",
        "/manifest.json",
        "/icon-192.png",
        "/icon-512.png",
        "/models/tiny_face_detector/tiny_face_detector_model.json",
        "/models/face_landmark68/face_landmark_68_model.json",
      ];

      expect(urls).toHaveLength(8);
      for (const asset of expectedAssets) {
        expect(urls).toContain(asset);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4.4  Activate event deletes stale caches
  // -------------------------------------------------------------------------
  describe("4.4 activate event deletes stale caches", () => {
    it("deletes only acculog-cache-v12 and keeps the three valid caches", async () => {
      const allKeys = [
        "acculog-cache-v12",          // stale — must be deleted
        "acculog-cache-v13",          // valid CACHE_NAME
        "acculog-osm-tiles-v1",       // valid OSM_CACHE_NAME
        "acculog-runtime-static-v1",  // valid STATIC_RUNTIME_CACHE
      ];
      const cachesMock = makeCachesMock({ keysResult: allKeys });
      const fetchMock = jest.fn();

      const { runSW, fireExtendableEvent } = createSWSandbox({
        caches: cachesMock,
        fetch: fetchMock,
      });
      runSW();

      await fireExtendableEvent("activate");

      // Exactly one deletion — the stale cache
      expect(cachesMock.delete).toHaveBeenCalledTimes(1);
      expect(cachesMock.delete).toHaveBeenCalledWith("acculog-cache-v12");

      // The three valid caches must NOT be deleted
      expect(cachesMock.delete).not.toHaveBeenCalledWith("acculog-cache-v13");
      expect(cachesMock.delete).not.toHaveBeenCalledWith("acculog-osm-tiles-v1");
      expect(cachesMock.delete).not.toHaveBeenCalledWith("acculog-runtime-static-v1");
    });
  });

  // -------------------------------------------------------------------------
  // 4.5  Property 1: Navigation Fallback — all navigation requests return a Response
  // -------------------------------------------------------------------------
  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.5, 10.1**
   */
  describe("4.5 Property 1: Navigation Fallback — all navigation requests return a Response", () => {
    it("handleNavigationRequest always returns a Response for any same-origin pathname", async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arbitrary safe URL pathnames
          fc
            .string({ minLength: 1, maxLength: 60 })
            .map((s) => "/" + s.replace(/[^a-zA-Z0-9/_-]/g, "x")),
          async (pathname) => {
            const cachedAppShell = new SWResponse("<html>app</html>", { status: 200 });
            const appShellCacheMock = makeCacheMock({ matchResult: cachedAppShell });
            const cachesMock = makeCachesMock({ openImpl: () => appShellCacheMock });
            const fetchMock = jest
              .fn()
              .mockRejectedValue(new TypeError("Failed to fetch"));

            const { sandbox, runSW } = createSWSandbox({
              caches: cachesMock,
              fetch: fetchMock,
            });
            runSW();

            const request = makeNavigateRequest(`https://example.com${pathname}`);

            const response = await sandbox.handleNavigationRequest(request);

            // Must return a Response, never undefined, never throw
            expect(response).toBeInstanceOf(SWResponse);
            expect(response.status).toBeGreaterThanOrEqual(100);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4.6  _next/static/ requests use SWR
  // -------------------------------------------------------------------------
  describe("4.6 _next/static/ requests use stale-while-revalidate", () => {
    it("returns stale cached response immediately and triggers background fetch", async () => {
      const staleResponse = new SWResponse("stale-content", { status: 200 });
      const freshResponse = new SWResponse("fresh-content", { status: 200 });

      // caches.match (global) returns stale
      const runtimeCacheMock = makeCacheMock();
      const cachesMock = makeCachesMock({ openImpl: () => runtimeCacheMock });
      cachesMock.match = jest.fn().mockResolvedValue(staleResponse);

      // fetch is delayed so we can confirm stale response returned first
      let fetchResolve!: (r: Response) => void;
      const fetchPromise = new Promise<Response>((res) => {
        fetchResolve = res;
      });
      const fetchMock = jest.fn().mockReturnValue(fetchPromise);

      const { sandbox, runSW } = createSWSandbox({ caches: cachesMock, fetch: fetchMock });
      runSW();

      const request = new SWRequest("https://example.com/_next/static/chunks/main.js");

      // Start the SWR handler
      const responsePromise = sandbox.handleStaleWhileRevalidate(request);

      // Resolve background fetch with fresh response
      fetchResolve(freshResponse);

      const response = await responsePromise;

      // Stale response returned immediately (not the fresh one)
      expect(response).toBe(staleResponse);
      // Background fetch was triggered once
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4.7  OSM tile cache evicts oldest entry when at OSM_MAX_ENTRIES
  // -------------------------------------------------------------------------
  describe("4.7 OSM tile cache evicts oldest entry when at OSM_MAX_ENTRIES", () => {
    it("calls cache.delete(keys[0]) before cache.put when cache holds 200 entries and there is a cache miss", async () => {
      // Build 200 fake Request keys to represent a full OSM tile cache
      const keys = Array.from(
        { length: 200 },
        (_, i) => new SWRequest(`https://tile.openstreetmap.org/z/x/${i}.png`)
      );

      const freshTile = new SWResponse("tile-data", { status: 200 });

      const osmCacheMock = makeCacheMock({
        matchResult: undefined,
        keysResult: keys as any,
      });
      const cachesMock = makeCachesMock({ openImpl: () => osmCacheMock });
      const fetchMock = jest.fn().mockResolvedValue(freshTile);

      const { sandbox, runSW } = createSWSandbox({ caches: cachesMock, fetch: fetchMock });
      runSW();

      const request = new SWRequest("https://tile.openstreetmap.org/12/3456/1234.png");
      await sandbox.handleOSMTile(request);

      // Eviction: cache.delete(keys[0]) called exactly once
      expect(osmCacheMock.delete).toHaveBeenCalledTimes(1);
      expect(osmCacheMock.delete).toHaveBeenCalledWith(keys[0]);

      // New tile stored
      expect(osmCacheMock.put).toHaveBeenCalledTimes(1);

      // delete must have been called before put
      const deleteOrder = osmCacheMock.delete.mock.invocationCallOrder[0];
      const putOrder = osmCacheMock.put.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(putOrder);
    });
  });
});
