# Implementation Plan

## Overview

This implementation plan covers the three-file fix for the PWA offline launch failure and connectivity UX overhaul:
1. `public/service-worker.js` — add navigation fallback, SWR for static assets, OSM tile caching, and proper install/activate lifecycle
2. `contexts/OfflineStatusContext.tsx` — replace the direct event handlers with a stability-delay + debounce connectivity manager and sonner toast notifications; remove the embedded `<OfflineBanner>`
3. `components/OfflineBanner.tsx` — retain as an inert props-driven component for backward compatibility with existing tests

Tests are written after implementation (feature workflow), targeting all correctness properties from the design document.

## Tasks

Files to modify: `public/service-worker.js`, `contexts/OfflineStatusContext.tsx`, `components/OfflineBanner.tsx`

Frozen (do not modify): `lib/offline-store.ts`, `lib/offline-auth.ts`, `hooks/useOfflineSync.ts`, `public/manifest.json`, all existing passing tests in `__tests__/`

---

- [x] 1. Upgrade `public/service-worker.js` — Navigation Fallback + Cache Strategies

  - [x] 1.1 Increment cache version and add `STATIC_RUNTIME_CACHE` constant
    - Change `CACHE_NAME` from `"acculog-cache-v12"` to `"acculog-cache-v13"`
    - Add `const STATIC_RUNTIME_CACHE = "acculog-runtime-static-v1"` (already present — verify it exists after the fetch handler currently present)
    - Add `const OSM_MAX_ENTRIES = 200`
    - _Requirements: 2.7, 2.9_

  - [x] 1.2 Rewrite `install` event handler to use `cache.addAll` with `Request` objects
    - Replace per-asset `fetch(url, { cache: "reload" }).then(cache.put)` loop with `cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: "reload" })))`
    - This causes the install to fail atomically if any critical asset is unavailable (satisfies AC 4.5)
    - Register Background Sync tag `"sync-activity-logs"` inside `event.waitUntil` (guard with `"sync" in self.registration`)
    - Call `self.skipWaiting()` after precaching
    - _Requirements: 2.4, 2.5, 2.8, 4.5_

  - [x] 1.3 Rewrite `activate` event handler to delete stale caches
    - Collect valid cache set: `{ CACHE_NAME, OSM_CACHE_NAME, STATIC_RUNTIME_CACHE }`
    - Delete every cache key not in the valid set via `Promise.all`
    - Call `self.clients.claim()` after cleanup
    - _Requirements: 2.6, 2.7, 2.9_

  - [x] 1.4 Add `isDevOnlyRequest(url)` helper function
    - Returns `true` if pathname matches `/_next/webpack-hmr`, `/_next/static/development`, `/__nextjs`, `/_next/data`, or `url.search` includes `hot-update`
    - Returns `false` otherwise; no side effects
    - _Requirements: (internal — keeps SW from interfering with Next.js dev tooling)_

  - [x] 1.5 Add `handleNavigationRequest(request)` function — network-first with app shell fallback
    - Try `await fetch(request)`; if response is ok, return it
    - On any throw or non-OK response: open `CACHE_NAME`, return `cache.match("/")`
    - If cache also misses `/`: fall back to `fetch(request)` (allows browser default error for never-installed PWA)
    - Function must never throw — always returns a `Response`
    - _Bug_Condition: `request.mode === "navigate"` AND network unavailable or non-OK_
    - _Expected_Behavior: `response.status === 200`, body is cached app shell HTML_
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.4_

  - [x] 1.6 Add `handleStaleWhileRevalidate(request)` function for `/_next/static/*`
    - Return cached response immediately if available
    - Trigger background `fetch(request)` to update `STATIC_RUNTIME_CACHE`; suppress background errors with `.catch(() => cached)`
    - If no cache entry: return the network response
    - _Requirements: 2.2_

  - [x] 1.7 Add `handleOSMTile(request)` function — cache-first bounded to 200 entries
    - Open `OSM_CACHE_NAME`; return cached response if present
    - On cache miss: fetch from network; if ok, check `cache.keys()` length and evict `keys[0]` if at `OSM_MAX_ENTRIES`; store and return response
    - _Requirements: 2.3_

  - [x] 1.8 Rewrite `fetch` event handler with per-request routing
    - Call `isDevOnlyRequest(url)` first — return (no `event.respondWith`) if true
    - If `request.mode === "navigate"`: `event.respondWith(handleNavigationRequest(request))`
    - If pathname starts with `/_next/static/`: `event.respondWith(handleStaleWhileRevalidate(request))`
    - If hostname is `tile.openstreetmap.org`: `event.respondWith(handleOSMTile(request))`
    - Default: `event.respondWith(caches.match(request).then(cached => cached ?? fetch(request)))`
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4_

---

- [x] 2. Upgrade `contexts/OfflineStatusContext.tsx` — Connectivity Manager + Toast Notifications

  - [x] 2.1 Add sonner `toast` import and define stability/debounce constants
    - Add `import { toast } from "sonner"`
    - Define `const STABILITY_DELAY_MS = 500` and `const DEBOUNCE_WINDOW_MS = 5000` inside the provider (or as module-level constants)
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.2, 7.1, 7.2_

  - [x] 2.2 Add `useRef` instances for stability timer and debounce timestamps
    - `stabilityTimerRef`: `useRef<ReturnType<typeof setTimeout> | null>(null)`
    - `lastOfflineToastRef`: `useRef<number | null>(null)`
    - `lastOnlineToastRef`: `useRef<number | null>(null)`
    - `lastSyncCompleteToastRef`: `useRef<number | null>(null)`
    - _Requirements: 5.2, 5.3, 5.4, 6.3, 7.5_

  - [x] 2.3 Implement `handleConnectivityChange(goingOnline: boolean)` inside the provider
    - Cancel any outstanding `stabilityTimerRef.current` via `clearTimeout`
    - Schedule new `setTimeout` for `STABILITY_DELAY_MS` ms
    - Inside timer callback: call `setIsOnline(goingOnline)`
    - If going online: check `lastOnlineToastRef` vs `DEBOUNCE_WINDOW_MS`; if clear, call `toast("You're back online. Syncing pending changes...", { duration: 3000 })` and update timestamp; then call `syncNow()`
    - If going offline: check `lastOfflineToastRef` vs `DEBOUNCE_WINDOW_MS`; if clear, call `toast("You're offline. Changes will be saved locally and synced automatically.", { duration: 4000 })` and update timestamp
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2_

  - [x] 2.4 Replace direct `handleOnline`/`handleOffline` listeners with `handleConnectivityChange`
    - In `useEffect`, replace `handleOnline` and `handleOffline` with calls to `handleConnectivityChange(true)` and `handleConnectivityChange(false)` respectively
    - Ensure cleanup returns `clearTimeout(stabilityTimerRef.current)` in addition to removing event listeners
    - Exactly one `online` listener and one `offline` listener attached to `window`
    - _Requirements: 5.1, 5.7_

  - [x] 2.5 Add sync-complete toast via `useEffect` watching `pendingCount` and `isOnline`
    - Add `prevPendingCountRef`: `useRef<number>(0)` to track the previous value
    - In effect: if `prevPendingCountRef.current > 0 && pendingCount === 0 && isOnline`, check `lastSyncCompleteToastRef` debounce; if clear, call `toast("All offline changes have been synced.", { duration: 3000 })` and update timestamp
    - Update `prevPendingCountRef.current = pendingCount` on every run
    - _Requirements: 7.3, 7.4, 7.5_

  - [x] 2.6 Remove `<OfflineBanner>` from the provider's JSX render
    - Delete the `<OfflineBanner .../>` element from the provider's return statement
    - Remove the `import OfflineBanner from "@/components/OfflineBanner"` line
    - Provider renders only `<OfflineStatusContext.Provider value={...}>{children}</OfflineStatusContext.Provider>`
    - _Requirements: 8.1, 8.2, 8.3, 6.5_

  - [x] 2.7 Verify context API surface is unchanged
    - Confirm `{ isOnline, isSyncing, pendingCount, lastSyncedAt, syncNow }` are still the context value fields
    - Confirm `useOfflineStatus()` hook is still exported
    - Confirm `OfflineStatusProvider` signature `({ children }: { children: React.ReactNode })` is unchanged
    - _Requirements: 5.6, 8.3, 8.4_

---

- [x] 3. Update `components/OfflineBanner.tsx` — Inert Utility Component

  - [x] 3.1 Retain component file and keep the props interface unchanged
    - Props `{ isOnline: boolean; isSyncing: boolean; pendingCount: number; onSyncNow?: () => void }` must remain identical
    - Component behavior (what it renders given explicit props) must be unchanged so existing direct-import tests continue to pass
    - No auto-mounting logic; component is props-driven and renders nothing when called with `isOnline=true, isSyncing=false, pendingCount=0`
    - _Requirements: 8.2, 8.4_

---

- [x] 4. Write unit tests for the service worker (`__tests__/service-worker.test.ts`)

  - [x] 4.1 Test: navigation request offline returns cached app shell (status 200)
    - Mock `caches.open(CACHE_NAME).match("/")` to return a fake `Response` with status 200
    - Mock `fetch` to reject with `TypeError: Failed to fetch`
    - Call `handleNavigationRequest(new Request("/activity-planner", { mode: "navigate" }))`
    - Assert `response.status === 200`
    - _Requirements: 1.1, 1.5, 10.1_

  - [x] 4.2 Test: navigation request to `/api/anything` is NOT intercepted by navigation fallback
    - Verify the fetch handler calls `event.respondWith(handleNavigationRequest(...))` only when `request.mode === "navigate"` AND the pathname is not `/api/`
    - Or directly verify `handleNavigationRequest` is not called for API routes
    - _Requirements: 3.2, 10.2_

  - [x] 4.3 Test: install event precaches all STATIC_ASSETS
    - Mock `caches.open` and `cache.addAll`
    - Fire `install` event; await `event.waitUntil` promise
    - Assert `cache.addAll` called with requests matching all 8 `STATIC_ASSETS` entries
    - _Requirements: 2.8, 4.1, 4.2, 10.7_

  - [x] 4.4 Test: activate event deletes stale caches
    - Mock `caches.keys()` returning `["acculog-cache-v12", "acculog-cache-v13", "acculog-osm-tiles-v1", "acculog-runtime-static-v1"]`
    - Fire `activate` event; await `event.waitUntil` promise
    - Assert `caches.delete` called once with `"acculog-cache-v12"` and not called for the three valid caches
    - _Requirements: 2.7, 2.9_

  - [x] 4.5 **Property 1: Navigation Fallback** — all navigation requests return a Response
    - Use `fast-check` to generate arbitrary same-origin pathnames
    - For each, call `handleNavigationRequest` with `fetch` mocked to reject
    - Assert every result is a `Response` object (never throws, never returns undefined)
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 10.1_

  - [x] 4.6 Test: `_next/static/` requests use SWR
    - Mock cache with a stale cached response; mock `fetch` to return a fresh response
    - Call `handleStaleWhileRevalidate(request)`
    - Assert stale cached response returned immediately; background `fetch` called
    - _Requirements: 2.2_

  - [x] 4.7 Test: OSM tile cache evicts oldest entry when at `OSM_MAX_ENTRIES`
    - Mock `cache.keys()` returning 200 entries; mock `cache.match` returning undefined (miss)
    - Call `handleOSMTile(request)`
    - Assert `cache.delete(keys[0])` called before `cache.put`
    - _Requirements: 2.3_

---

- [x] 5. Write unit tests for `OfflineStatusProvider` (add to `__tests__/OfflineStatusContext.test.tsx`)

  - [x] 5.1 Test: offline toast shown with correct message after stability delay
    - Mock `sonner` `toast`; mount `OfflineStatusProvider`
    - Dispatch `window` `"offline"` event; advance timers by 500 ms
    - Assert `toast` called with `"You're offline. Changes will be saved locally and synced automatically."` and `{ duration: 4000 }`
    - _Requirements: 6.1, 6.2, 10.3_

  - [x] 5.2 Test: online toast shown with correct message after stability delay
    - Mock `sonner` `toast`; mount `OfflineStatusProvider` starting offline
    - Dispatch `window` `"online"` event; advance timers by 500 ms
    - Assert `toast` called with `"You're back online. Syncing pending changes..."` and `{ duration: 3000 }`
    - _Requirements: 7.1, 7.2, 10.4_

  - [x] 5.3 Test: sync-complete toast shown when `pendingCount` transitions from >0 to 0 while online
    - Mount provider; simulate `pendingCount` going from 2 to 0 while `isOnline = true`
    - Assert `toast` called with `"All offline changes have been synced."` and `{ duration: 3000 }`
    - _Requirements: 7.3, 7.4, 10.5_ (was previously 10.x — maps to Req 7.3)

  - [x] 5.4 Test: debounce suppresses second offline toast within `DEBOUNCE_WINDOW_MS`
    - Dispatch first `"offline"` event + advance 500 ms → toast shown; record toast call count
    - Dispatch second `"offline"` event within 5 s + advance 500 ms
    - Assert `toast` not called a second time for offline
    - _Requirements: 5.3, 6.3, 10.5_

  - [x] 5.5 Test: stability delay suppresses flapping — rapid offline→online within 500 ms does not commit offline state
    - Start with `isOnline = true`
    - Dispatch `"offline"`, then dispatch `"online"` 200 ms later (before stability delay fires)
    - Advance timers by 500 ms
    - Assert `isOnline` remains `true`; no offline toast shown
    - _Requirements: 5.2, 10.6_

  - [x] 5.6 Test: `OfflineBanner` is NOT rendered inside `OfflineStatusProvider`
    - Mount `OfflineStatusProvider`; query for `data-testid="offline-banner"` (or OfflineBanner's DOM structure)
    - Assert it is not present in the render tree
    - _Requirements: 8.1, 8.2_

  - [x] 5.7 **Property 2: Stability Delay** — for all rapid event sequences, committed state equals final event
    - Use `fast-check` to generate arrays of booleans (true=online, false=offline) of length 1–20
    - Simulate each sequence with inter-event gaps < `STABILITY_DELAY_MS` via fake timers
    - Assert `isOnline` after sequence ends equals `events[events.length - 1]`
    - _Requirements: 5.2, 10.10_

---

- [x] 6. Write integration tests (`__tests__/offline-launch.integration.test.ts`)

  - [x] 6.1 Test: SW install precaches STATIC_ASSETS; navigation request offline returns app shell
    - Simulate `install` event in a mock SW environment; assert all 8 assets in cache
    - Simulate `fetch` event with `request.mode === "navigate"` and network unavailable
    - Assert returned response has status 200 and body matching the cached app shell
    - _Requirements: 1.5, 2.8, 10.7_

  - [x] 6.2 Test: full offline lifecycle — offline toast → online toast → sync-complete toast → no OfflineBanner
    - Mount `OfflineStatusProvider` with `pendingCount = 2`, `isOnline = true`
    - Fire `"offline"` event; advance 500 ms → assert offline toast shown
    - Fire `"online"` event; advance 500 ms → assert online toast shown; assert `syncNow` called
    - Simulate `pendingCount → 0` → assert sync-complete toast shown
    - Assert no `<OfflineBanner>` element in the provider's render tree at any step
    - _Requirements: 6.1, 7.1, 7.3, 8.1, 10.7_

---

- [x] 7. Checkpoint — All tests pass, no regressions

  - Run the full test suite: `npx jest --runInBand` (or equivalent)
  - All new tests in `__tests__/service-worker.test.ts`, `__tests__/OfflineStatusContext.test.tsx`, and `__tests__/offline-launch.integration.test.ts` must pass
  - All pre-existing tests in `__tests__/` must continue to pass without modification
  - Manually verify on browser DevTools: toggle offline in Application → Service Workers → check "Offline", then close and reopen the PWA tab — app shell must load instead of browser offline error page
  - _Requirements: 10.8, 10.9_


## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3"] },
    { "wave": 2, "tasks": ["4", "5"] },
    { "wave": 3, "tasks": ["6"] },
    { "wave": 4, "tasks": ["7"] }
  ]
}
```

## Notes

- `public/service-worker.js` is a plain JavaScript file (no TypeScript, no module bundler). All helper functions are defined in the same file scope.
- The existing `OfflineStatusContext.test.tsx` mocks `@/components/OfflineBanner` and asserts that it IS rendered by the provider (Test 4). After task 2.6 removes `<OfflineBanner>` from the provider, **Test 4 in the existing file will need to be updated** to assert the banner is NOT present. This is the only permitted modification to existing test files — all other tests must continue to pass unmodified.
- `fast-check` is already available in the project's dev dependencies. Import as `import fc from "fast-check"` or `import * as fc from "fast-check"`.
- Property-based tests (tasks 4.5 and 5.7) use the `**Property N:** format` in their task descriptions to enable hover status in the Kiro UI.
- The `sonner` `<Toaster />` is already mounted in `app/layout.tsx` — no layout changes are needed.
- Cache version bump from `v12` → `v13` in the service worker will cause the activate handler to evict `acculog-cache-v12` automatically on first run after deployment.
