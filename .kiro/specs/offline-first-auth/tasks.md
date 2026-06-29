# Implementation Plan

## Overview

This plan implements the six offline-first defect fixes (D1–D6) using the exploratory bugfix workflow: write bug condition tests first (to confirm defects on unfixed code), write preservation tests (to lock in unchanged behavior), then fix the data layer, context/provider, and login form in dependency order, and finally validate with unit, property-based, and integration tests.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3"] },
    { "wave": 3, "tasks": ["4"] },
    { "wave": 4, "tasks": ["5"] },
    { "wave": 5, "tasks": ["6"] },
    { "wave": 6, "tasks": ["7"] },
    { "wave": 7, "tasks": ["8", "9"] },
    { "wave": 8, "tasks": ["10"] }
  ]
}
```

Tasks 1 and 2 are written on unfixed code and must complete before any implementation begins. Task 3 (data layer) must precede Task 4 (action-queue layer). Tasks 5 and 6 (provider + layout wiring) depend on Tasks 3 and 4. Task 7 (login form) depends on Task 6. Tasks 8 and 9 depend on all implementation tasks. Task 10 is the final gate.

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Offline Structural Defects (D1–D6)
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bugs exist
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate all six defects exist
  - **Scoped PBT Approach**: Scope each property to the concrete failing case to ensure reproducibility
  - D1 — Mock `navigator.onLine = false` and `fetch` to reject; mount `LoginForm`; assert no unhandled rejection propagates from the settings `useEffect`
  - D2 — Mock `navigator.onLine = false`; mount `LoginForm`; assert the login form is interactive (submit button enabled, no error boundary triggered)
  - D3 — Render the `RootLayout` tree without modification; assert `OfflineBanner` is present in the rendered output
  - D4 — Import `offline-logs-cache`; assert `typeof enqueueAction === "function"` and `typeof getUnsyncedActions === "function"` and `typeof markSynced === "function"` and `typeof markFailed === "function"`
  - D5 — Import `offline-store`; assert `typeof getItem === "function"` and `typeof setItem === "function"` and `typeof deleteItem === "function"` and `typeof getAllItems === "function"` and `typeof runExpiry === "function"` and `typeof withTransaction === "function"`
  - D6 — Render `RootLayout`; spy on `getPendingCount`; dispatch `window.dispatchEvent(new Event("online"))`; assert spy was called (sync engine fires globally)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL — confirms all six defects exist; document counterexamples (e.g., `TypeError: enqueueAction is not a function`, fetch rejection propagates, OfflineBanner not found in layout, no sync call on online event)
  - Mark task complete when tests are written, run, and all failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - All Online Flows Unchanged
  - **IMPORTANT**: Follow observation-first methodology — run unfixed code with non-buggy inputs and record observed outputs
  - Observe: online `handleSubmit` calls `/api/login`, caches credentials, sets `userId` + `acculog_session_start` in localStorage, redirects to activity planner
  - Observe: `handleSettingsFetch` with `navigator.onLine = true` calls `/api/admin/settings` and applies `themeColor` to `document.documentElement`
  - Observe: biometric login offline produces exact message `"Biometric login requires internet. Please use Email/Password to login offline."`
  - Observe: `verifyOfflineCredential` with `cachedAt = Date.now() - 31 * 24 * 60 * 60 * 1000` returns `null`
  - Observe: `ProtectedPageWrapper` with online network calls `/api/check-session` as primary auth check
  - Write property-based test: for any `{ email, password, userId }` triple where `navigator.onLine = true`, the side-effects of `handleSubmit` (fetch to `/api/login`, localStorage writes for `userId` and `acculog_session_start`, router.push to activity planner) are identical between original and fixed code
  - Write property-based test: for any `pendingCount` value and `isSyncing` boolean, `OfflineBanner` renders the same UI whether receiving props directly or through the provider
  - Write unit test: Activity page `useOfflineSync` — Cloudinary photo upload, 300 ms inter-log delay, toast notifications, 30 s periodic retry, and visibility-change sync all fire as before after app-level provider is added
  - Verify all tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 3. Fix D5 — Promote `lib/offline-store.ts` to generic CRUD layer (DB version 2)

  - [x] 3.1 Bump `DB_VERSION` from `1` to `2` and add `cached-api-responses` object store in `onupgradeneeded`
    - Add `db.createObjectStore("cached-api-responses", { keyPath: "_key" })` branch guarded by `!db.objectStoreNames.contains("cached-api-responses")`
    - Existing `pending-logs` store creation remains untouched — no migration needed for existing records
    - _Bug_Condition: isBugCondition(X) where storeIncomplete — offlineStore has no getItem/setItem/deleteItem/getAllItems/runExpiry/withTransaction exports_
    - _Expected_Behavior: offlineStore.getItem, setItem, deleteItem, getAllItems, runExpiry, withTransaction all exported and functional_
    - _Preservation: enqueuePendingLog, getAllPendingLogs, removePendingLog, incrementRetry, getPendingCount, clearAllPendingLogs behavior unchanged_
    - _Requirements: 2.5_

  - [x] 3.2 Define `StoreRecord<T>` interface and export `getItem<T>(store, key)` and `setItem<T>(store, key, value, ttlMs?)`
    - Add interface `StoreRecord<T> { _key: string; _value: T; _version: number; _createdAt: number; _expiresAt: number | null }`
    - `getItem`: opens readonly transaction on `store`, gets record by key, checks `_expiresAt` (returns `null` if `_expiresAt !== null && _expiresAt <= Date.now()`), returns `record._value` or `null`; falls back to `null` on any IDB error
    - `setItem`: reads existing record to obtain current `_version`; writes `{ _key: key, _value: value, _version: (existing?._version ?? 0) + 1, _createdAt: Date.now(), _expiresAt: ttlMs ? Date.now() + ttlMs : null }`; silent no-op when IndexedDB is unavailable
    - _Requirements: 2.5_

  - [x] 3.3 Export `deleteItem(store, key)`, `getAllItems<T>(store)`, `runExpiry(store)`, and `withTransaction(stores, mode, fn)`
    - `deleteItem`: opens readwrite transaction on `store`, calls `store.delete(key)`; silent no-op on error
    - `getAllItems`: returns all records where `_expiresAt` is `null` or `> Date.now()`, mapped to `record._value`; falls back to `[]` on error
    - `runExpiry`: opens a cursor on the given store; for each record where `_expiresAt !== null && _expiresAt <= Date.now()`, calls `cursor.delete()`
    - `withTransaction`: opens a single IDB transaction across all `stores` with the given `mode`; passes the transaction object to `fn`; resolves on `tx.oncomplete`; rejects on `tx.onerror`; falls back to no-op if IndexedDB is unavailable
    - _Requirements: 2.5_

- [x] 4. Fix D4 — Extend `lib/offline-logs-cache.ts` with action-queue IDB store (DB version 2)

  - [x] 4.1 Bump `DB_VERSION` from `1` to `2` and add `action-queue` object store in `onupgradeneeded`
    - Add `db.createObjectStore("action-queue", { keyPath: "id" })` with an index: `store.createIndex("syncStatus", "syncStatus", { unique: false })`
    - Existing `logs` and `meta` stores remain untouched
    - _Bug_Condition: isBugCondition(X) where logsCacheIncomplete — offlineLogsCache has no enqueueAction/getUnsyncedActions/markSynced/markFailed exports_
    - _Expected_Behavior: all four exports exist and persist/retrieve from action-queue IDB store with correct syncStatus field_
    - _Preservation: cacheLogs, getCachedLogs, getLastFetchedAge behavior unchanged_
    - _Requirements: 2.4_

  - [x] 4.2 Define `ActionQueueEntry` interface and export `enqueueAction(action, payload)`
    - Add interface `ActionQueueEntry { id: string; action: string; payload: Record<string, unknown>; createdAt: number; syncStatus: "pending" | "synced" | "failed" | "dead-letter"; lastAttemptAt: number | null; attempts: number; errorMessage: string | null }`
    - `enqueueAction`: generates `id = "aq_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9)`; writes entry with `syncStatus: "pending"`, `lastAttemptAt: null`, `attempts: 0`, `errorMessage: null`; returns the generated `id` within 1 second; does NOT require a network connection
    - _Requirements: 2.4_

  - [x] 4.3 Export `getUnsyncedActions()`, `markSynced(id)`, and `markFailed(id, errorMessage)`
    - `getUnsyncedActions`: opens readonly transaction on `action-queue`; returns all entries where `syncStatus === "pending" || syncStatus === "failed"`, sorted by `createdAt` ascending; falls back to `[]` on error
    - `markSynced`: opens readwrite transaction; gets record by `id`; sets `syncStatus = "synced"` and `lastAttemptAt = Date.now()`; puts record back
    - `markFailed`: increments `attempts`; sets `lastAttemptAt = Date.now()`; if `attempts >= 5` sets `syncStatus = "dead-letter"`, otherwise sets `syncStatus = "failed"`; sets `errorMessage` to provided string; puts record back
    - _Requirements: 2.4_

- [x] 5. Fix D3 & D6 — Create `contexts/OfflineStatusContext.tsx` with `OfflineStatusProvider`

  - [x] 5.1 Create `contexts/OfflineStatusContext.tsx` with context, provider shell, and `useOfflineStatus` hook
    - Add `"use client"` directive
    - Define context shape: `{ isOnline: boolean; isSyncing: boolean; pendingCount: number; lastSyncedAt: number | null; syncNow: () => Promise<void> }`
    - Create `OfflineStatusContext` with `React.createContext` using safe defaults (`isOnline: true`, `isSyncing: false`, `pendingCount: 0`, `lastSyncedAt: null`, `syncNow: async () => {}`)
    - Export `useOfflineStatus` convenience hook: `() => useContext(OfflineStatusContext)`
    - _Bug_Condition: isBugCondition(X) where bannerNeverRenders — OfflineStatusProvider NOT IN appLayout(X)_
    - _Expected_Behavior: OfflineStatusProvider mounted in app/layout.tsx supplies live isOnline, isSyncing, pendingCount to OfflineBanner on all pages_
    - _Preservation: useOfflineSync on Activity page continues to function independently_
    - _Requirements: 2.3, 2.6_

  - [x] 5.2 Implement `OfflineStatusProvider` with online/offline listeners and sync singleton
    - Initialize `isOnline` from `navigator.onLine` (SSR-safe: default `true` on server)
    - Register `window` `online` / `offline` event listeners in `useEffect` to update `isOnline` state
    - Manage `isSyncing`, `pendingCount`, and `lastSyncedAt` state
    - Implement `syncNow`: re-entrant guard via `useRef(false)` (return early if already syncing or `!navigator.onLine`); call `getAllPendingLogs()` from `lib/offline-store`; process entries sequentially with exponential backoff (base 1 s, multiplier 2×, cap 32 s, max 5 attempts); call `removePendingLog` on success or `incrementRetry` on failure; move entries with `retries >= 5` and 4xx response to dead-letter equivalent; update `isSyncing` and `pendingCount` in real time
    - Register `window` `online` listener that calls `syncNow()` once per reconnect
    - Render `<OfflineBanner isOnline={isOnline} isSyncing={isSyncing} pendingCount={pendingCount} onSyncNow={syncNow} />` inside the provider so no consumer needs to wire it manually
    - _Requirements: 2.3, 2.6_

- [x] 6. Fix D3 & D6 — Wrap `app/layout.tsx` children with `OfflineStatusProvider`

  - [x] 6.1 Import and apply `OfflineStatusProvider` in `app/layout.tsx`
    - Add `import { OfflineStatusProvider } from "@/contexts/OfflineStatusContext"` to `app/layout.tsx`
    - Inside the `<UserProvider>` body, wrap `{children}` and `<Toaster />` with `<OfflineStatusProvider>…</OfflineStatusProvider>`
    - Resulting structure: `<UserProvider><OfflineStatusProvider>{children}<Toaster /></OfflineStatusProvider></UserProvider>`
    - _Bug_Condition: isBugCondition(X) where bannerNeverRenders AND syncNotGlobal — OfflineStatusProvider not in app layout, sync only on Activity page_
    - _Expected_Behavior: OfflineBanner renders on every page; sync fires on online event from any route_
    - _Preservation: UserProvider, Toaster, metadata exports, viewport export all remain unchanged_
    - _Requirements: 2.3, 2.6_

- [x] 7. Fix D1 & D2 — Guard `handleSettingsFetch` useEffect in `components/login-form.tsx`

  - [x] 7.1 Add `navigator.onLine` guard and `localStorage` branding cache to the settings `useEffect`
    - Locate `React.useEffect(() => { fetch("/api/admin/settings")… }, [])` (approximately line 470)
    - Add offline branch at top of effect: `if (typeof navigator !== "undefined" && !navigator.onLine) { /* load from cache */ return; }`
    - In the offline branch: read `localStorage.getItem("acculog_settings_cache")`; if found, parse and call `setSettings(cached)` then apply `document.documentElement.setAttribute("data-theme", cached.themeColor)` if `cached.themeColor` exists; if not found, return without error — default logo and styles render via built-in fallbacks
    - _Bug_Condition: isBugCondition(X) where settingsEffectBlocking AND fastPathGap — fetch("/api/admin/settings") called with no navigator.onLine guard and no .catch() handler_
    - _Expected_Behavior: login page fully rendered within 3 seconds offline; no unhandled rejection; login form interactive; cached branding loaded from localStorage_
    - _Preservation: online fetch still calls /api/admin/settings and applies themeColor to data-theme attribute; localStorage cache written on successful online fetch_
    - _Requirements: 2.1, 2.2_

  - [x] 7.2 Add `.catch(() => {})` handler and `localStorage` cache write to the online fetch chain
    - In the `.then(data => { setSettings(data); … })` handler, add `localStorage.setItem("acculog_settings_cache", JSON.stringify(data))` after `setSettings(data)` to persist branding for the next offline visit
    - Append `.catch(() => {})` to the end of the `fetch(…).then(…)` chain so any network error is silently absorbed (no unhandled promise rejection)
    - _Requirements: 2.1, 2.2_

- [x] 8. Write fix-checking unit and property-based tests

  - [x] 8.1 Unit tests for D1/D2 — `handleSettingsFetch` guard
    - Test: `navigator.onLine = false`, no cached settings → no fetch called, no unhandled rejection, `settings` state stays `null`, login form renders
    - Test: `navigator.onLine = false`, `acculog_settings_cache` in localStorage → `setSettings` called with cached data, theme applied, no fetch called
    - Test: `navigator.onLine = true` → fetch called, result applied to theme, result persisted to `localStorage` under `acculog_settings_cache`
    - Test: `navigator.onLine = true`, fetch rejects → `.catch(() => {})` absorbs error, no unhandled rejection

  - [x] 8.2 Unit tests for D4 — `offline-logs-cache` action-queue API
    - Test `enqueueAction`: IDB record written with all required fields (`id`, `action`, `payload`, `createdAt`, `syncStatus: "pending"`, `lastAttemptAt: null`, `attempts: 0`, `errorMessage: null`); generated `id` returned
    - Test `getUnsyncedActions`: returns only `pending` and `failed` entries, sorted by `createdAt` ascending; `synced` and `dead-letter` entries excluded
    - Test `markSynced`: sets `syncStatus = "synced"` and updates `lastAttemptAt` on correct record
    - Test `markFailed` at attempts 1–4: sets `syncStatus = "failed"`, increments `attempts`, sets `errorMessage`
    - Test `markFailed` at attempt 5: sets `syncStatus = "dead-letter"` — record preserved but not retried

  - [x] 8.3 Unit tests for D5 — `offline-store` generic CRUD layer
    - Test `setItem` + `getItem`: `_version` starts at 1, increments to 2 on second write for same key
    - Test `getItem` with expired TTL (`ttlMs = 1`): after waiting 2 ms, returns `null`
    - Test `getItem` with non-expired TTL: returns stored value
    - Test `deleteItem`: subsequent `getItem` returns `null`
    - Test `getAllItems`: excludes expired records, includes non-expired records
    - Test `runExpiry`: deletes only records where `_expiresAt <= Date.now()`, leaves non-expired ones intact
    - Test `withTransaction`: callback receives a valid IDB transaction; resolves on `oncomplete`

  - [x] 8.4 Unit tests for D3/D6 — `OfflineStatusProvider`
    - Test: `isOnline` state changes to `false` when `window.dispatchEvent(new Event("offline"))` fires
    - Test: `isOnline` state changes to `true` when `window.dispatchEvent(new Event("online"))` fires
    - Test sync re-entrant guard: dispatching `online` twice in quick succession calls `syncNow` logic only once (second call returns early while `isSyncing === true`)
    - Test: `OfflineBanner` is rendered inside the provider with correct props wired from provider state
    - _Requirements: 2.3, 2.6_

  - [x] 8.5 Property-based tests (fix checking — Property 1 and Property 2)
    - **Property 1: Expected Behavior** - Offline Login Form Never Throws
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - For any `email` + `password` pair when `navigator.onLine = false`, mounting `LoginForm` never produces an unhandled rejection from the settings `useEffect`; the login form submit button is enabled and interactive
    - **Property 2: Preservation** - Online Flows Identical Before and After Fix
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - For any `{ email, password, userId }` triple where `navigator.onLine = true`, the observable side-effects of `handleSubmit` (fetch to `/api/login`, localStorage writes, router.push) are identical between original and fixed code
    - For any `{ action: string, payload: Record<string, unknown> }`, `enqueueAction(action, payload)` returns a non-empty string id and the record appears in `getUnsyncedActions()` output
    - **EXPECTED OUTCOME**: Property 1 PASSES (bug fixed); Property 2 PASSES (no regressions)
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 9. Integration tests

  - [x] 9.1 Full offline login flow integration test
    - Mock service worker cache and IndexedDB credentials; disable network (`navigator.onLine = false`)
    - Launch login page; assert page renders completely (no error boundary, no unhandled rejection)
    - Submit cached credentials; assert offline session is set via `setOfflineSession`; assert redirect to activity planner occurs within 2 seconds
    - _Requirements: 2.1, 2.2_

  - [x] 9.2 Full reconnect sync flow integration test
    - Enqueue 3 actions via `enqueueAction` (or `enqueuePendingLog`) while offline
    - Simulate `window.dispatchEvent(new Event("online"))`
    - Assert all 3 are processed by the sync engine; assert `pendingCount` reaches 0; assert `OfflineBanner` flashes "All records synced successfully" then disappears after 2.5 s
    - _Requirements: 2.6_

  - [x] 9.3 Banner visible on `/dashboard` while offline
    - Navigate to `/dashboard`; simulate `window.dispatchEvent(new Event("offline"))`
    - Assert `OfflineBanner` with "You are offline" text is present in the DOM (mounted via `OfflineStatusProvider` in layout)
    - _Requirements: 2.3_

  - [x] 9.4 Activity page sync compatibility
    - After adding app-level `OfflineStatusProvider`, mount the Activity page with `useOfflineSync` active
    - Enqueue a pending log; assert it is synced once (not twice — no duplicate submissions from both the provider sync and `useOfflineSync`)
    - Assert Cloudinary photo upload, 300 ms inter-log delay, and toast notifications still fire via `useOfflineSync`
    - _Requirements: 3.9_

  - [x] 9.5 Settings fetch online — persistence test
    - Mock `/api/admin/settings` to return `{ themeColor: "blue", logoUrl: "https://example.com/logo.png" }`
    - Mount `LoginForm` with `navigator.onLine = true`
    - Assert `document.documentElement.getAttribute("data-theme")` equals `"blue"`
    - Assert `localStorage.getItem("acculog_settings_cache")` contains the response data
    - _Requirements: 2.1, 3.1_

- [x] 10. Checkpoint — Ensure all tests pass
  - Re-run the full test suite (unit, property-based, and integration tests)
  - Verify **Property 1: Bug Condition** tests now PASS (confirms all six defects are fixed)
  - Verify **Property 2: Preservation** tests still PASS (confirms no regressions in online flows)
  - Ensure no unhandled promise rejections appear in the test output
  - Confirm `navigator.onLine = false` at login page mount produces no console errors and a fully interactive form
  - Confirm `OfflineBanner` renders on all routes (dashboard, profile, admin pages) when offline
  - Confirm `enqueueAction` and `getUnsyncedActions` exist and round-trip correctly
  - Confirm `getItem` / `setItem` / `_version` increment / TTL expiry all work
  - Ask the user if any questions arise before marking this checkpoint complete

## Notes

- All exploration tests (Task 1) run against the **unfixed** codebase and are expected to fail — failure confirms the bugs exist.
- All preservation tests (Task 2) run against the **unfixed** codebase and are expected to pass — passing confirms the baseline behavior to protect.
- The data layer (Tasks 3–4) must be completed before the context provider (Task 5) because `OfflineStatusProvider` imports `getAllPendingLogs`, `removePendingLog`, and `incrementRetry` from `lib/offline-store`.
- Task 6 (layout.tsx wrapping) must follow Task 5 (provider creation) — the import will not resolve until the file exists.
- Task 7 (login-form guard) is independent of Tasks 3–6 but is placed last among implementation tasks to avoid interference with exploration test results.
- The `useOfflineSync` hook on the Activity page must NOT be removed or modified. The new `OfflineStatusProvider` sync loop complements it; both can be active simultaneously. Deduplication is handled by the re-entrant guard (`syncingRef`).
- IndexedDB is unavailable in SSR (Next.js server components). All IDB calls are guarded with `typeof indexedDB === "undefined"` checks and fall back to no-op / `null` / `[]` as specified in Requirements 2.5.
- Property-based tests should use a library already present in the project (check `package.json`). If none is installed, `fast-check` is the recommended choice for TypeScript projects.
