# Offline-First Auth Bugfix Design

## Overview

The biolog PWA has partial offline infrastructure but six integration gaps prevent true offline-first operation. This document formalizes each bug condition, defines the expected correct behavior, hypothesizes root causes, and outlines the targeted implementation changes required to close each gap without altering any online flow.

The fix strategy is minimal and surgical: guard the two unprotected `fetch` calls, mount a global `OfflineStatusProvider` in `app/layout.tsx`, extend `lib/offline-logs-cache.ts` with an action-queue API, promote `lib/offline-store.ts` to a generic CRUD layer, and move the sync singleton to the provider so it fires on all pages.

---

## Glossary

- **Bug_Condition (C)**: `isBugCondition(X)` — returns `true` for any `AppState` that exhibits at least one of the six defects described in the requirements.
- **Property (P)**: The desired behavior when `isBugCondition(X)` is true — defined per-defect in the Correctness Properties section.
- **Preservation**: All online-path flows, biometric login, TTL expiry enforcement, Activity-page sync behavior, and explicit logout behavior that must remain byte-for-byte equivalent after the fix.
- **`OfflineStatusProvider`**: React context provider to be created at `contexts/OfflineStatusContext.tsx`, mounted in `app/layout.tsx`, exposing `{ isOnline, isSyncing, pendingCount, lastSyncedAt, syncNow }`.
- **`action-queue`**: New IndexedDB object store inside `lib/offline-logs-cache.ts` for queuing write operations not yet uploaded to the server.
- **`_version`**: Integer field on every `offline-store.ts` record, incremented on each `setItem` call for conflict detection.
- **`_expiresAt`**: Optional epoch-ms field on `offline-store.ts` records; entries where `_expiresAt ≤ Date.now()` are excluded from reads.
- **`dead-letter`**: Sync queue entry that has exhausted all retry attempts (≥ 5) against a 4xx error; preserved for audit, excluded from future syncs.
- **Credential TTL**: 30 days from last successful online login.
- **Session TTL**: 7 days from last `setOfflineSession` call.
- **`handleSettingsFetch`**: The `React.useEffect` in `components/login-form.tsx` (line ~470) that calls `fetch("/api/admin/settings")`.
- **`ProtectedPageWrapper`**: `components/protected-page-wrapper.tsx` — session guard for all authenticated pages.

---

## Bug Details

### Bug Condition

The bug condition is composite — any one of six structural defects in `AppState` triggers it.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT: X of type AppState
  OUTPUT: boolean

  // Defect D1 — settings fetch unguarded in login-form.tsx useEffect
  settingsEffectBlocking ←
    loginFormMounted(X)
    AND NOT navigator.onLine
    AND settingsFetchHasNoOnlineGuard(X)        // fetch() called with no guard
    AND settingsFetchHasNoCatchHandler(X)        // .catch() absent

  // Defect D2 — offline fast-path gap: submit guards onLine but effect does not
  fastPathGap ←
    loginFormMounted(X)
    AND NOT navigator.onLine
    AND settingsFetchFiresBeforeSubmitGuard(X)  // effect runs at mount, before any submit

  // Defect D3 — OfflineBanner never mounted globally
  bannerNeverRenders ←
    OfflineStatusProvider NOT IN appLayout(X)

  // Defect D4 — offline-logs-cache has no action-queue API
  logsCacheIncomplete ←
    NOT hasExport(offlineLogsCache, "enqueueAction")
    OR NOT hasExport(offlineLogsCache, "getUnsyncedActions")
    OR NOT hasExport(offlineLogsCache, "markSynced")
    OR NOT hasExport(offlineLogsCache, "markFailed")

  // Defect D5 — offline-store has no generic CRUD layer
  storeIncomplete ←
    NOT hasExport(offlineStore, "getItem")
    OR NOT hasExport(offlineStore, "setItem")
    OR NOT hasExport(offlineStore, "deleteItem")
    OR NOT hasExport(offlineStore, "getAllItems")
    OR NOT hasExport(offlineStore, "runExpiry")
    OR NOT hasExport(offlineStore, "withTransaction")

  // Defect D6 — sync only fires on Activity page
  syncNotGlobal ←
    NOT syncListenerInAppLayout(X)
    AND useOfflineSyncOnlyMountedOnActivityPage(X)

  RETURN settingsEffectBlocking
      OR fastPathGap
      OR logsCacheIncomplete
      OR storeIncomplete
      OR bannerNeverRenders
      OR syncNotGlobal
END FUNCTION
```

### Concrete Examples of Bug Manifestation

**D1 — Unguarded settings fetch:**
- Device goes offline; user opens `/Login`. `useEffect` fires `fetch("/api/admin/settings")` immediately. The fetch rejects with `TypeError: Failed to fetch`. No `.catch()` exists, so the rejection is unhandled. `settings` state stays `null` — logo URL and theme color never applied. Console shows an unhandled promise rejection.

**D2 — Fast-path gap:**
- Same scenario as D1. Even though the submit handler has `if (!navigator.onLine) { /* offline path */ }`, the settings effect already ran and threw before the user ever pressed "Sign In". The page is visually broken before the user acts.

**D3 — Banner never shown:**
- Device goes offline mid-session on `/dashboard`. No `OfflineStatusProvider` exists in `app/layout.tsx`. `OfflineBanner` is never rendered anywhere outside Activity page. User has no visual indication they are offline.

**D4 — No action-queue API:**
- User tries to record a time-in while offline. Calling code expects `enqueueAction(...)` on `offline-logs-cache`. The function does not exist → `TypeError: enqueueAction is not a function`. Action is lost.

**D5 — No generic store CRUD:**
- A page tries to cache an API response for offline display via `setItem("api-cache", key, value)`. The function does not exist on `offline-store`. Developer must open raw IDB, creating duplicated boilerplate and a second independent database.

**D6 — Sync only on Activity page:**
- User is on `/dashboard` when connectivity returns. `useOfflineSync` is not mounted here. No `online` event listener fires. Pending queue is not flushed. `OfflineBanner` pending count stays stale.

---

## Expected Behavior

### Preservation Requirements

The following behaviors exist correctly today and must remain completely unchanged after the fix.

**Unchanged Behaviors:**
- WHEN the device is online THEN the login form SHALL continue authenticating via `/api/login`, caching credentials via `cacheCredential`, setting the offline session via `setOfflineSession`, and redirecting to the activity planner.
- WHEN the device is online and a protected page loads THEN `ProtectedPageWrapper` SHALL continue using `/api/check-session` as the primary auth check; offline session is fallback only.
- WHEN the user logs out THEN `clearOfflineSession` and credential cache clearing SHALL continue to fire unchanged.
- WHEN the device is online and the user submits an activity log THEN the log SHALL continue to post directly to the server without routing through the local queue.
- WHEN biometric login is attempted while offline THEN the attempt SHALL continue to be rejected immediately with "Biometric login requires internet."
- WHEN the offline credential TTL (30 days) or session TTL (7 days) has expired THEN offline login SHALL continue to be refused.
- WHEN a queued action accumulates ≥ 5 failed attempts against a 4xx response THEN it SHALL continue to move to `dead-letter` and never be retried.
- WHEN the device is online with no pending actions THEN `OfflineBanner` SHALL continue to render nothing.
- WHEN `useOfflineSync` is mounted on the Activity page THEN its sequential sync, Cloudinary photo upload, 300 ms inter-log delay, toast notifications, 30 s periodic retry, and visibility-change sync SHALL all continue to function without modification.

**Scope of Non-Affected Inputs:**
All inputs that do NOT involve the six defect conditions above (i.e., any fully-online state with `OfflineStatusProvider` mounted, no action-queue calls, no generic CRUD calls) are completely unaffected by this fix. This includes:
- All admin pages, reporting pages, and recruitment pages
- Google OAuth sign-in and sign-up flows
- All API routes (`/api/login`, `/api/check-session`, `/api/admin/settings`, etc.)
- Service worker registration and PWA install prompt behavior

---

## Hypothesized Root Cause

### D1 — Unguarded Settings Fetch in `login-form.tsx`

**Root cause**: The `React.useEffect` that calls `fetch("/api/admin/settings")` (approximately line 470 in `components/login-form.tsx`) was written for the online-only case and never hardened for offline:
- No `if (!navigator.onLine) return;` guard before the `fetch`.
- No `.catch(() => {})` handler on the promise chain.
- No cached fallback (localStorage or IndexedDB) for branding settings.

The submit handler has an `if (!navigator.onLine)` check, demonstrating the developer was aware of offline mode, but the guard was not propagated to the side-effect.

### D2 — Fast-Path Gap (Effect Fires Before Submit Guard)

**Root cause**: React's `useEffect` runs synchronously after the first render, before the user can submit the form. The offline fast-path in `handleSubmit` can only protect the network call triggered by the user; it cannot retroactively stop the already-fired settings effect. These are two independent code paths with independent `navigator.onLine` checks, so guarding only one leaves a window.

### D3 — `OfflineBanner` Never Mounted Globally

**Root cause**: `OfflineBanner` is a **controlled, props-driven component** — it requires `isOnline`, `isSyncing`, and `pendingCount` to be passed to it. No context provider or wrapper exists in `app/layout.tsx` that manages and supplies those values to the whole tree. The component was built as a display layer but the state-management layer (the provider) was never implemented.

### D4 — `offline-logs-cache.ts` Read-Only Architecture

**Root cause**: The module was implemented as a read/display cache (`cacheLogs`, `getCachedLogs`, `getLastFetchedAge`) for the calendar/home tab, not as a write-action queue. The `action-queue` object store, `syncStatus` enum tracking, and `enqueueAction`/`getUnsyncedActions`/`markSynced`/`markFailed` API were planned in the requirements but never built. The IndexedDB database (`acculog-logs`, version 1) only contains `logs` and `meta` stores.

### D5 — `offline-store.ts` Single-Purpose Implementation

**Root cause**: The module (`acculog-offline`, version 1) was created specifically for the `pending-logs` queue required by `useOfflineSync`. Generic CRUD (`getItem`, `setItem`, `deleteItem`, `getAllItems`) and multi-store transaction support (`withTransaction`) were never added. There is no `cached-api-responses` store, no `_version`/`_expiresAt` metadata, and no TTL expiry runner. Any code needing a different store is forced to open its own raw IDB connection.

### D6 — `useOfflineSync` Scoped to Activity Page Only

**Root cause**: `useOfflineSync` is a React hook — it can only be mounted inside a component. It is only imported on `app/time-attendance/activity/page.tsx`. There is no app-level provider in `app/layout.tsx` that mounts the sync loop and online/offline event listeners globally. Every other page in the app has no `online` listener, no periodic retry, and no `OfflineBanner` state source.

---

## Correctness Properties

Property 1: Bug Condition — Settings Fetch Must Not Block Offline Login

_For any_ `AppState` where `loginFormMounted(X)` is true and `navigator.onLine` is `false`, the fixed `handleSettingsFetch` useEffect SHALL either skip the network fetch entirely (when no cached settings exist) or load branding from the local cache (IndexedDB/localStorage), SHALL NOT throw an unhandled rejection, and SHALL leave the login form fully interactive — the user SHALL be able to submit credentials and reach the offline fast-path within 3 seconds of page mount.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition — `OfflineBanner` Must Render Accurate State on All Pages

_For any_ `AppState` where the app is mounted at any route, the fixed `app/layout.tsx` SHALL mount `OfflineStatusProvider`, which SHALL supply live `isOnline`, `isSyncing`, and `pendingCount` values to `OfflineBanner`, causing the banner to render: offline warning when `!isOnline`, syncing indicator when `isSyncing`, queued-records warning when `isOnline && pendingCount > 0`, and nothing when fully online with zero pending records.

**Validates: Requirements 2.3**

Property 3: Bug Condition — `enqueueAction` Must Persist Actions Offline

_For any_ call to `offlineLogsCache.enqueueAction({ action, payload })` regardless of network state, the fixed module SHALL persist the action to the `action-queue` IndexedDB store with fields `{ id, action, payload, createdAt, syncStatus: "pending", lastAttemptAt: null, attempts: 0, errorMessage: null }`, SHALL return the generated `id` within 1 second, and SHALL NOT require a network connection.

**Validates: Requirements 2.4**

Property 4: Bug Condition — Generic CRUD Layer Must Be Available on `offline-store`

_For any_ call to `offlineStore.getItem(store, key)`, `offlineStore.setItem(store, key, value, ttlMs?)`, `offlineStore.deleteItem(store, key)`, `offlineStore.getAllItems(store)`, `offlineStore.runExpiry(store)`, or `offlineStore.withTransaction(stores, mode, fn)`, the fixed module SHALL execute the operation on the specified IDB object store and SHALL fall back to a no-op (reads return `null`, writes silently skip) when IndexedDB is unavailable.

**Validates: Requirements 2.5**

Property 5: Bug Condition — Sync Engine Fires on All Pages on Reconnect

_For any_ `AppState` where `window.online` fires from any route, the fixed `OfflineStatusProvider` in `app/layout.tsx` SHALL invoke the sync engine singleton exactly once per reconnect (re-entrant calls blocked while `isSyncing === true`), SHALL flush `pending` and `failed` entries from the `pending-logs` store in chronological order with exponential backoff (base 1 s, multiplier 2×, cap 32 s, max 5 attempts), and SHALL update `isSyncing` and `pendingCount` in real time.

**Validates: Requirements 2.6**

Property 6: Preservation — All Online Flows Unchanged

_For any_ `AppState` where `navigator.onLine` is `true` and `isBugCondition(X)` is `false` in the original code, the fixed code SHALL produce exactly the same observable behavior as the original — including the settings fetch, the login API call, credential caching, session storage, redirect timing, `ProtectedPageWrapper` session check, logout clearing, direct log posting, and biometric login rejection message.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**

---

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, the following targeted changes close each defect.

---

**File**: `components/login-form.tsx`  
**Function**: Settings `useEffect` (anonymous, ~line 470)

**Specific Changes — D1 & D2:**
1. **Add `navigator.onLine` guard**: Wrap the entire effect body: `if (typeof navigator !== "undefined" && !navigator.onLine) { /* load from cache, return */ }`.
2. **Add cached settings fallback**: Before returning from the offline branch, attempt to read branding from `localStorage` key `acculog_settings_cache`. If found, call `setSettings(cached)` and apply theme. If not found, return without error — the built-in default logo renders.
3. **Add `.catch(() => {})` handler**: Append `.catch(() => {})` to the online fetch chain so any network error is silently absorbed instead of propagating as an unhandled rejection.
4. **Cache settings on successful fetch**: In the `.then()` handler (after `setSettings(data)`), persist `data` to `localStorage` key `acculog_settings_cache` so the next offline visit can load it.

---

**New File**: `contexts/OfflineStatusContext.tsx`

**Specific Changes — D3 & D6:**
1. **Create `OfflineStatusContext`**: Define `React.createContext` with shape `{ isOnline, isSyncing, pendingCount, lastSyncedAt, syncNow }`.
2. **Create `OfflineStatusProvider`**: Client component (`"use client"`) that:
   - Initializes `isOnline` from `navigator.onLine`.
   - Registers `window` `online`/`offline` listeners to update `isOnline`.
   - Owns `isSyncing`, `pendingCount`, and `lastSyncedAt` state.
   - Implements the `syncNow` function (re-entrant guard via `useRef`, calls `getAllPendingLogs`, exponential backoff loop, updates `isSyncing`/`pendingCount` in real time, moves 4xx entries to `dead-letter` after 5 attempts).
   - Registers `window` `online` listener that calls `syncNow()` once per reconnect.
   - Renders `<OfflineBanner isOnline={isOnline} isSyncing={isSyncing} pendingCount={pendingCount} onSyncNow={syncNow} />` internally, so no consumer needs to wire the banner manually.
3. **Export `useOfflineStatus`**: Convenience hook `() => useContext(OfflineStatusContext)`.

---

**File**: `app/layout.tsx`

**Specific Changes — D3 & D6:**
1. **Import `OfflineStatusProvider`**: Add `import { OfflineStatusProvider } from "@/contexts/OfflineStatusContext"`.
2. **Wrap children**: Inside `<UserProvider>`, wrap `{children}` with `<OfflineStatusProvider>{children}</OfflineStatusProvider>`.

---

**File**: `lib/offline-logs-cache.ts`  
**Database**: `acculog-logs`, bump `DB_VERSION` from `1` to `2`

**Specific Changes — D4:**
1. **Add `action-queue` object store in `onupgradeneeded`**: `db.createObjectStore("action-queue", { keyPath: "id" })` with index on `syncStatus`.
2. **Define `ActionQueueEntry` interface**: `{ id: string; action: string; payload: Record<string, unknown>; createdAt: number; syncStatus: "pending" | "synced" | "failed" | "dead-letter"; lastAttemptAt: number | null; attempts: number; errorMessage: string | null }`.
3. **Export `enqueueAction(action, payload)`**: Generates `id = "aq_" + Date.now() + "_" + random`, writes entry with `syncStatus: "pending"`, returns `id`.
4. **Export `getUnsyncedActions()`**: Returns all entries where `syncStatus === "pending" || syncStatus === "failed"`, sorted by `createdAt` ascending.
5. **Export `markSynced(id)`**: Sets `syncStatus = "synced"` and `lastAttemptAt = Date.now()`.
6. **Export `markFailed(id, errorMessage)`**: Increments `attempts`, sets `lastAttemptAt`, sets `syncStatus = "failed"` unless `attempts >= 5` in which case sets `syncStatus = "dead-letter"`.

---

**File**: `lib/offline-store.ts`  
**Database**: `acculog-offline`, bump `DB_VERSION` from `1` to `2`

**Specific Changes — D5:**
1. **Add `cached-api-responses` object store in `onupgradeneeded`**: `db.createObjectStore("cached-api-responses", { keyPath: "_key" })`.
2. **Define `StoreRecord<T>` interface**: `{ _key: string; _value: T; _version: number; _createdAt: number; _expiresAt: number | null }`.
3. **Export `getItem<T>(store, key)`**: Opens readonly transaction, gets record, checks `_expiresAt`, returns `_value` or `null`. Falls back to `null` on IDB error.
4. **Export `setItem<T>(store, key, value, ttlMs?)`**: Gets existing record to read `_version`, writes `{ _key: key, _value: value, _version: prev._version + 1 || 1, _createdAt: Date.now(), _expiresAt: ttlMs ? Date.now() + ttlMs : null }`. Silent no-op on IDB unavailability.
5. **Export `deleteItem(store, key)`**: Opens readwrite transaction, deletes by key. Silent no-op on error.
6. **Export `getAllItems<T>(store)`**: Returns all records where `_expiresAt` is null or `> Date.now()`, mapped to `_value`. Falls back to `[]` on error.
7. **Export `runExpiry(store)`**: Opens cursor on store, deletes records where `_expiresAt !== null && _expiresAt <= Date.now()`.
8. **Export `withTransaction(stores, mode, fn)`**: Opens a single IDB transaction across `stores`, passes the transaction to `fn`, resolves on `tx.oncomplete`. Falls back to no-op on IDB unavailability.

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate each bug on the **unfixed** code to confirm or refute the root cause analysis; then verify the fix works correctly and preserves all existing behavior.

---

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each defect before implementing the fix. If counterexamples do not match the hypothesis, re-hypothesize before coding.

**Test Plan**: Write tests that mock `navigator.onLine = false`, mount components without a provider, and call functions that are expected to exist on the modules. Run against the **current, unfixed** codebase to observe failures.

**Test Cases:**

1. **D1 — Unguarded settings fetch**: Mock `navigator.onLine = false` and `fetch` to reject. Mount `LoginForm`. Assert no unhandled rejection, `settings` state not null. _Will fail on unfixed code — fetch throws, no catch._
2. **D2 — Fast-path gap**: Mock `navigator.onLine = false`. Mount `LoginForm`. Assert login form is interactive (submit button enabled, no error boundary). _Will fail on unfixed code — effect throws before user interaction._
3. **D3 — Banner never mounted**: Render the `RootLayout` tree without any modification. Assert `OfflineBanner` is present in the rendered output. _Will fail on unfixed code — no provider, no banner._
4. **D4 — No enqueueAction**: Import `offline-logs-cache`. Assert `typeof enqueueAction === "function"`. _Will fail on unfixed code — export does not exist._
5. **D5 — No getItem/setItem**: Import `offline-store`. Assert `typeof getItem === "function"` and `typeof setItem === "function"`. _Will fail on unfixed code — exports do not exist._
6. **D6 — Sync not global**: Render `RootLayout` tree. Simulate `window.dispatchEvent(new Event("online"))`. Assert `getPendingCount` was called (spy). _Will fail on unfixed code — no global listener._

**Expected Counterexamples:**
- `fetch` rejection propagates as unhandled promise rejection in tests.
- `enqueueAction is not a function` TypeError from offline-logs-cache import.
- `getItem is not a function` TypeError from offline-store import.
- `OfflineBanner` not found in rendered layout tree.
- No sync call observed on `online` event from layout level.

---

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result := fixedSystem(X)

  // D1/D2
  IF loginFormMounted(X) AND NOT navigator.onLine THEN
    ASSERT loginPageFullyRendered(result)
    AND noUnhandledRejections(result)
    AND loginFormInteractive(result)

  // D3/D6
  IF OfflineStatusProvider IN appLayout(result) THEN
    ASSERT OfflineBanner receivesLiveProps
    AND syncFiresOnOnlineEvent

  // D4
  ASSERT offlineLogsCache.enqueueAction IS function
    AND enqueueAction returns id within 1000ms
    AND action persisted in IDB with syncStatus="pending"

  // D5
  ASSERT offlineStore.getItem IS function
    AND offlineStore.setItem IS function
    AND setItem increments _version on each write
    AND getItem returns null for expired TTL entries

END FOR
```

---

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed system produces the same result as the original.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT originalSystem(X) = fixedSystem(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because it generates many test cases automatically across the input domain, catching edge cases that manual unit tests miss, and providing strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Cases:**
1. **Online login flow preservation**: Property test generates random `{ email, password, userId }` tuples; verifies `handleSubmit` still calls `/api/login`, caches credentials, and redirects.
2. **Settings fetch preservation (online)**: Mock `navigator.onLine = true`; assert settings are still fetched from `/api/admin/settings` and applied to the theme, unchanged from current behavior.
3. **ProtectedPageWrapper preservation**: Property test with random session states; verifies `/api/check-session` is still the primary check when online; offline session is still fallback only.
4. **Biometric login rejection offline**: Assert error message still exactly `"Biometric login requires internet. Please use Email/Password to login offline."` — no change.
5. **Activity page sync preservation**: Mount Activity page with `useOfflineSync`; assert Cloudinary upload, 300 ms delay, toast notifications, 30 s periodic retry all fire as before.
6. **TTL expiry preservation**: Set `cachedAt` to `Date.now() - 31 * 24 * 60 * 60 * 1000`; assert `verifyOfflineCredential` returns `null` — unchanged.

---

### Unit Tests

- Test `handleSettingsFetch` effect with `navigator.onLine = false`: no fetch called, no unhandled rejection, cached settings loaded from `localStorage`.
- Test `handleSettingsFetch` effect with `navigator.onLine = true`: fetch called, result applied to theme, result persisted to `localStorage`.
- Test `enqueueAction`: IDB record written with all required fields and correct initial `syncStatus`.
- Test `getUnsyncedActions`: returns only `pending` and `failed` entries, sorted by `createdAt`.
- Test `markSynced`: sets `syncStatus = "synced"` on correct record.
- Test `markFailed` at attempts 1–4: sets `syncStatus = "failed"`, increments `attempts`.
- Test `markFailed` at attempt 5: sets `syncStatus = "dead-letter"`.
- Test `offlineStore.setItem`: `_version` starts at 1 and increments on each call for the same key.
- Test `offlineStore.getItem` with expired TTL: returns `null`.
- Test `offlineStore.runExpiry`: deletes only expired records, leaves non-expired ones.
- Test `withTransaction`: fn receives a valid IDB transaction, resolves on complete.
- Test `OfflineStatusProvider`: `isOnline` state changes on `window` `online`/`offline` events.
- Test `OfflineStatusProvider` sync on reconnect: `syncNow` called once per `online` event, not twice if already syncing.

---

### Property-Based Tests

- **Property 1 (Fix)**: For any `email` + `password` pair when `navigator.onLine = false`, mounting `LoginForm` never throws an unhandled rejection from the settings effect.
- **Property 2 (Fix)**: For any action name + payload object, `enqueueAction(action, payload)` always returns a non-empty string id and the record can be retrieved by `getUnsyncedActions`.
- **Property 3 (Fix)**: For any `(store: string, key: string, value: T, ttlMs: number)`, `setItem` followed immediately by `getItem` returns `value`; after waiting `ttlMs + 1` ms, `getItem` returns `null`.
- **Property 4 (Preservation)**: For any online login attempt `(email, password, userId)`, the observable side-effects of `handleSubmit` (fetch calls, localStorage writes, router push) are identical between original and fixed code.
- **Property 5 (Preservation)**: For any `pendingCount` value and `isSyncing` boolean, `OfflineBanner` renders the same UI between original props-driven usage and provider-driven usage.

---

### Integration Tests

- Full offline login flow: mock service worker cache + IndexedDB credentials; launch login page with network disabled; assert page renders, user can submit credentials, offline session is set, redirect occurs.
- Full reconnect sync flow: enqueue 3 actions; simulate `window.online`; assert all 3 are uploaded, `pendingCount` reaches 0, `OfflineBanner` flashes "Synced!" then disappears.
- Banner visible on `/dashboard` while offline: navigate to dashboard; disable network; assert `OfflineBanner` shows "You are offline".
- Activity page sync compatibility: after adding app-level provider, assert Activity page `useOfflineSync` still syncs independently without duplicate submissions.
- Settings fetch on online login: assert theme color from `/api/admin/settings` is applied to `:root` `data-theme` attribute and persisted to localStorage on successful fetch.
