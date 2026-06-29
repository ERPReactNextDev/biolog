# Bugfix Requirements Document

## Introduction

The biolog PWA has partial offline infrastructure in place (`lib/offline-auth.ts`, `lib/offline-store.ts`, `lib/offline-logs-cache.ts`, `components/OfflineBanner.tsx`, `hooks/useOfflineSync.ts`), but several integration and behavioral gaps prevent true offline-first operation:

1. The login form (`components/login-form.tsx`) makes a blocking, unguarded `fetch("/api/admin/settings")` at mount with no `navigator.onLine` check and no error handler, causing the login page to stall on network failure.
2. The offline auth fast-path in the login form checks `navigator.onLine` for the submit handler but not for the settings fetch `useEffect`, leaving a window where the page renders broken even though credentials are cached.
3. `OfflineBanner` is a controlled component that requires `isOnline`, `isSyncing`, and `pendingCount` props — but no provider in `app/layout.tsx` wires those values at the app level, so the banner is never mounted globally and never renders.
4. `lib/offline-logs-cache.ts` exists as a read/display cache (`cacheLogs`, `getCachedLogs`, `getLastFetchedAge`) but has no write-action queue, sync-status tracking, or audit-trail functionality — the module is structurally incomplete for its described purpose.
5. `lib/offline-store.ts` exposes only a single `pending-logs` object store with no generic CRUD layer, no cached-API-response store, no data-versioning fields, no automatic cache expiry, and no multi-store transaction support.
6. `hooks/useOfflineSync.ts` implements a functional sync loop but is only mounted inside individual page components. There is no singleton sync manager at the app level, so pages that do not explicitly mount the hook do not trigger sync on reconnect.

This fix closes those gaps so that previously-authenticated users can launch and fully operate the app with no network, the `OfflineBanner` renders accurately on all pages, `offline-logs-cache.ts` provides a complete action-queue and audit trail, `offline-store.ts` provides a unified data layer, and the sync engine fires on every page without per-page wiring.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the device is offline at app launch THEN `components/login-form.tsx` executes `fetch("/api/admin/settings")` inside a `React.useEffect` with no `navigator.onLine` guard and no `.catch()` error handler, causing an unhandled network rejection that leaves the login page in a partially-rendered state (branding/logo missing, theme not applied, no user-visible error message).

1.2 WHEN `navigator.onLine` is `false` at the time the login page mounts THEN the settings `useEffect` fires before the submit handler's `navigator.onLine` check can prevent it, so the offline fast-path on submit cannot prevent the page from already being in a broken state.

1.3 WHEN the app is running and the device goes offline or comes back online THEN the `OfflineBanner` does not appear or update on any page because no `OfflineStatusProvider` exists in `app/layout.tsx` — `OfflineBanner` is a props-driven component that is never mounted globally.

1.4 WHEN `lib/offline-logs-cache.ts` is used to record a user action (time-in, activity create, etc.) THEN the module has no `enqueueAction`, `getUnsyncedActions`, `markSynced`, or `markFailed` API — only a batch `cacheLogs` for display purposes — so action logs cannot be queued, tracked, or audited offline.

1.5 WHEN `lib/offline-store.ts` is used from a page that needs to store non-log data (API response cache, draft form state, versioned records) THEN no such API exists — the module only exposes the `pending-logs` queue, forcing consumers to open their own raw IndexedDB connections and creating duplicated, inconsistent boilerplate.

1.6 WHEN a user navigates to any page other than the Activity page THEN `useOfflineSync` is not mounted, so the `online` event is not listened to, the pending queue is not flushed when connectivity returns, and the `OfflineBanner` state is not updated.

---

### Expected Behavior (Correct)

2.1 WHEN the device is offline at app launch THEN the login page SHALL render completely within 3 seconds using only locally-cached assets (service worker), the settings fetch SHALL be guarded by a `navigator.onLine` check and a `.catch(() => {})` handler, locally-cached branding settings (logo URL, theme color) SHALL be loaded from IndexedDB/localStorage if available, and if no cached settings exist the login page SHALL render with the built-in default logo and no error message — the login form SHALL remain fully interactive regardless of connectivity.

2.2 WHEN the device is offline and a previously-authenticated user submits their credentials THEN the system SHALL check `navigator.onLine` and route directly to `verifyOfflineCredential` without any network fetch, SHALL complete the login flow entirely from the local credential cache (IndexedDB primary, localStorage fallback), SHALL set the offline session via `setOfflineSession`, and SHALL redirect to the activity planner within 2 seconds of form submission — the user SHALL NOT see any network-error message.

2.3 WHEN the device is online or offline, on any page in the application THEN the `OfflineBanner` SHALL receive accurate real-time `isOnline`, `isSyncing`, and `pendingCount` values from an `OfflineStatusProvider` mounted in `app/layout.tsx`, and SHALL render the correct state: offline warning when `!isOnline`, syncing indicator when `isSyncing`, queued-records warning when `isOnline && pendingCount > 0`, sync-complete flash (2.5 s) after `isSyncing` transitions from `true` to `false` with `pendingCount === 0`, and nothing when fully online with no pending records.

2.4 WHEN a user action (time-in, time-out, activity create, activity edit, save draft) is recorded via `lib/offline-logs-cache.ts` THEN the module SHALL persist the action to a dedicated `action-queue` IndexedDB object store with fields `{ id, action, payload, createdAt, syncStatus, lastAttemptAt, attempts, errorMessage }`, where `syncStatus` is one of `pending | synced | failed | dead-letter`, SHALL return the generated `id` within 1 second, and SHALL NOT require a network connection for any part of the write operation.

2.5 WHEN `lib/offline-store.ts` is imported THEN the module SHALL expose: (a) `getItem<T>(store, key)` → `T | null`, (b) `setItem<T>(store, key, value, ttlMs?)` — stores with optional TTL and a `_version` integer incremented on each write, (c) `deleteItem(store, key)`, (d) `getAllItems<T>(store)` — excludes expired entries, (e) `runExpiry(store)` — deletes all entries where `_expiresAt ≤ Date.now()`, and (f) `withTransaction(stores, mode, fn)` — executes `fn` inside a single IDB transaction spanning the given stores; all operations SHALL fall back to no-op (read: `null`, write: silent skip) when IndexedDB is unavailable.

2.6 WHEN the device comes back online from any page THEN the app-level `OfflineStatusProvider` (mounted in `app/layout.tsx`) SHALL automatically detect the `window` `online` event, SHALL invoke the sync engine singleton exactly once per reconnect event (re-entrant calls blocked while `isSyncing === true`), SHALL retrieve all `pending` and `failed` entries from `lib/offline-store.ts` `pending-logs` store in chronological order, SHALL upload each entry via its registered endpoint with exponential backoff (base 1 s, multiplier 2×, cap 32 s, max 5 attempts), SHALL remove successfully-uploaded entries, SHALL move entries that return a 4xx response to `dead-letter` status, and SHALL update `isSyncing` and `pendingCount` in real time so the `OfflineBanner` reflects progress.

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the device is online and the user logs in with valid credentials THEN the system SHALL CONTINUE TO authenticate via the `/api/login` endpoint, cache credentials via `cacheCredential`, set the offline session via `setOfflineSession`, store `userId` and `acculog_session_start` in localStorage, and redirect to the activity planner — this flow SHALL NOT be altered by any change to the settings fetch guard.

3.2 WHEN the device is online and a protected page is loaded THEN `ProtectedPageWrapper` SHALL CONTINUE TO verify the session via `/api/check-session` as the primary auth check; the offline session SHALL serve as a fallback only when the network fetch throws or returns a non-200 status.

3.3 WHEN the user logs out THEN the system SHALL CONTINUE TO clear the offline session store via `clearOfflineSession` and the credential cache so the user cannot re-authenticate offline after an explicit logout.

3.4 WHEN the device is online and the user submits an activity log THEN the system SHALL CONTINUE TO post data directly to the server API without routing it through the local queue.

3.5 WHEN a biometric login is attempted while offline THEN the system SHALL CONTINUE TO reject the attempt immediately with the message "Biometric login requires internet. Please use Email/Password to login offline." and SHALL NOT attempt any network call.

3.6 WHEN the offline credential TTL (30 days) or session TTL (7 days) has expired THEN the system SHALL CONTINUE TO refuse offline login and require the user to authenticate online to refresh the cache — expired TTL SHALL NOT be bypassed by any new code path.

3.7 WHEN the sync engine encounters a permanent 4xx server error for a queued action THEN the system SHALL CONTINUE TO move that action to `dead-letter` status after the final retry and SHALL NOT retry it again — dead-letter entries SHALL be preserved in IndexedDB for audit but excluded from sync attempts.

3.8 WHEN the device is online and no actions are queued THEN the system SHALL CONTINUE TO show no `OfflineBanner` content and SHALL operate in its normal fully-online mode.

3.9 WHEN `useOfflineSync` is mounted on the Activity page THEN its existing behavior — sequential sync, Cloudinary photo upload, 300 ms inter-log delay, toast notifications, 30 s periodic retry interval, visibility-change sync — SHALL CONTINUE TO function without modification. The new app-level sync provider SHALL complement, not replace, the hook.

---

## Bug Condition Pseudocode

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type AppState
  OUTPUT: boolean

  // Defect 1.1 / 1.2 — settings fetch unguarded
  settingsEffectBlocking ← NOT navigator.onLine
    AND loginFormMounted(X)
    AND settingsFetchHasNoOnlineGuard(X)

  // Defect 1.3 — OfflineBanner never mounted
  bannerNeverRenders ← OfflineStatusProvider NOT IN appLayout(X)

  // Defect 1.4 — offline-logs-cache has no action-queue API
  logsCacheIncomplete ← NOT hasMethod(offlineLogsCache, "enqueueAction")
    OR NOT hasMethod(offlineLogsCache, "getUnsyncedActions")

  // Defect 1.5 — offline-store has no generic CRUD layer
  storeIncomplete ← NOT hasMethod(offlineStore, "getItem")
    OR NOT hasMethod(offlineStore, "setItem")

  // Defect 1.6 — sync only fires on Activity page
  syncNotGlobal ← NOT syncListenerInAppLayout(X)

  RETURN settingsEffectBlocking
      OR bannerNeverRenders
      OR logsCacheIncomplete
      OR storeIncomplete
      OR syncNotGlobal
END FUNCTION
```

```pascal
// Property: Fix Checking — Offline App Launch
FOR ALL X WHERE NOT navigator.onLine AND loginFormMounted(X) DO
  result ← renderLoginPage'(X)
  ASSERT loginPageFullyRendered(result)
    AND noUnhandledNetworkErrors(result)
    AND loginFormInteractive(result)
END FOR

// Property: Fix Checking — Global Banner & Sync
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT OfflineStatusProvider IN appLayout'(X)
    AND OfflineBanner receivesLiveProps(X)
    AND syncFiresOnOnlineEvent(X)
END FOR

// Property: Fix Checking — Offline Data Layer
FOR ALL X WHERE isBugCondition(X) DO
  ASSERT offlineLogsCache'.enqueueAction EXISTS
    AND offlineStore'.getItem EXISTS
    AND offlineStore'.setItem EXISTS
END FOR

// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)  // all online flows unchanged
END FOR
```

---

## Glossary

| Term | Definition |
|---|---|
| `dead-letter` | A sync queue entry that has exhausted all retry attempts (≥ 5) against a 4xx permanent error and will not be retried. Preserved for audit. |
| `OfflineStatusProvider` | A React Context provider to be created in `contexts/OfflineStatusContext.tsx` and mounted in `app/layout.tsx`, exposing `{ isOnline, isSyncing, pendingCount, lastSyncedAt, syncNow }` to all child components. |
| `action-queue` | A new IndexedDB object store inside `lib/offline-logs-cache.ts` for queuing write operations that have not yet been uploaded to the server. |
| `_version` | An integer field added to every `offline-store.ts` record, incremented on each `setItem` call to enable conflict detection during sync. |
| `_expiresAt` | An optional epoch-ms timestamp field on `offline-store.ts` records; entries with `_expiresAt ≤ Date.now()` are treated as expired and excluded from reads. |
| Credential TTL | 30 days from last successful online login, after which `verifyOfflineCredential` returns `null`. |
| Session TTL | 7 days from last `setOfflineSession` call, after which `getOfflineSession` returns `null`. |
