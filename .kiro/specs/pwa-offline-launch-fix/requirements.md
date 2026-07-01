# Requirements Document

## Introduction

The Biolog PWA (Next.js 16) serves field workers who frequently operate in areas with intermittent connectivity. The offline-first data layer is complete and tested. This feature addresses two remaining gaps:

1. **Critical offline launch failure** — the installed PWA shows the browser's native offline error page instead of the cached app shell when the device is offline, because the service worker has no navigation-request fallback.
2. **Connectivity UX overhaul** — the persistent `OfflineBanner` top-bar occupies screen real estate at all times and must be replaced with auto-dismissing `sonner` toast notifications. Online/offline detection is also scattered across three independent hooks and must be consolidated into a single connectivity manager.

The scope of this spec covers: `public/service-worker.js`, `contexts/OfflineStatusContext.tsx`, and `components/OfflineBanner.tsx`. Files outside this scope (`lib/offline-store.ts`, `lib/offline-auth.ts`, `hooks/useOfflineSync.ts`, `public/manifest.json`, all existing passing tests) are frozen and must not be modified.

---

## Glossary

- **Service_Worker**: The vanilla JavaScript file at `public/service-worker.js` (currently v12, `CACHE_NAME = "acculog-cache-v12"`) that intercepts network requests for the PWA.
- **App_Shell**: The minimal HTML document cached at `"/"` that bootstraps the Next.js SPA. Serving this for any same-origin navigation request allows the app to start offline.
- **Navigation_Request**: An HTTP request whose `request.mode === "navigate"` or whose `Accept` header includes `"text/html"` and targets the same origin — i.e., a browser top-level page load or refresh.
- **STATIC_ASSETS**: The precache list defined in `service-worker.js`: `["/", "/Login", "/activity-planner", "/manifest.json", "/icon-192.png", "/icon-512.png", face-detection model JSON files]`.
- **Connectivity_Manager**: The logic inside `OfflineStatusContext` that serves as the single source of truth for `isOnline` state and issues debounced connectivity notifications.
- **OfflineStatusProvider**: The React context provider in `contexts/OfflineStatusContext.tsx` that exposes `{ isOnline, isSyncing, pendingCount, lastSyncedAt, syncNow }` to the component tree.
- **OfflineBanner**: The existing fixed-position top-bar component in `components/OfflineBanner.tsx` that is being replaced by toast notifications.
- **Toast_Notification**: A non-blocking, auto-dismissing notification rendered by the `sonner` library (already wired as `<Toaster />` in `app/layout.tsx`).
- **Debounce_Window**: A 5-second guard period during which a repeated connectivity event of the same type does not produce a second notification.
- **Stability_Delay**: A 500 ms settling period after a connectivity change before the state is committed, used to suppress flapping network transitions.
- **OSM_Tile**: An OpenStreetMap map tile image fetched from `tile.openstreetmap.org`.
- **SWR**: Stale-While-Revalidate caching strategy — serve from cache immediately and revalidate in the background.
- **Background_Sync**: The browser Background Sync API, registered under the tag `"sync-activity-logs"`, used to trigger the sync engine when connectivity is restored.
- **Dead_Letter**: A pending log record that has exceeded the maximum retry count (`retries >= 5`) and is excluded from further sync attempts.
- **Pending_Count**: The number of activity log records queued in IndexedDB awaiting a successful server sync.

---

## Requirements

### Requirement 1: Navigation Fallback (Critical Offline Launch Fix)

**User Story:** As a field worker, I want the PWA to open from my home screen when I am offline, so that I can use the app without seeing the browser's offline error page.

#### Acceptance Criteria

1. WHEN a Navigation_Request arrives at the Service_Worker and the network is unavailable, THE Service_Worker SHALL respond with the cached App_Shell document retrieved from CACHE_NAME instead of propagating the network error.
2. WHEN a Navigation_Request arrives at the Service_Worker and the network is available, THE Service_Worker SHALL attempt a network-first fetch and fall back to the cached App_Shell if the network fetch throws or returns a non-OK response.
3. THE Service_Worker SHALL identify a Navigation_Request as any fetch event where `request.mode === "navigate"`.
4. WHEN the Service_Worker handles a Navigation_Request and the App_Shell entry is not present in CACHE_NAME, THE Service_Worker SHALL let the request fall through to the network rather than returning an empty or error response, as specified in AC4.
5. WHEN the installed PWA is launched from the device home screen while offline, THE Service_Worker SHALL serve the App_Shell and all precached static assets required for the Next.js SPA to fully initialise and render a usable UI without a network connection.

---

### Requirement 2: Service Worker — App Shell Architecture and Cache Strategies

**User Story:** As a field worker, I want the PWA to load instantly from cache and work reliably offline, so that I can log attendance and activities without waiting for network round-trips.

#### Acceptance Criteria

1. THE Service_Worker SHALL apply a cache-first strategy for all URLs that exactly match an entry in STATIC_ASSETS: serve from cache immediately; if not found in cache, fetch from the network and store the response before returning it.
2. WHEN a fetch event targets a URL whose pathname begins with `/_next/static/`, THE Service_Worker SHALL apply the SWR strategy: return the cached response immediately while revalidating the cached entry from the network in the background.
3. WHEN a fetch event targets a URL whose hostname is `tile.openstreetmap.org`, THE Service_Worker SHALL apply a cache-first strategy bounded to a maximum of 200 cached tile entries, evicting the least-recently-used entry when the limit is exceeded.
4. THE Service_Worker SHALL register Background_Sync under the tag `"sync-activity-logs"` during the install event so that pending logs are retried when connectivity is restored on browsers that support the Background Sync API.
5. THE Service_Worker SHALL call `self.skipWaiting()` at the end of the install event handler so that a newly installed version activates without waiting for existing clients to close.
6. WHEN the Service_Worker activates, THE Service_Worker SHALL call `self.clients.claim()` so that all open clients are immediately controlled by the new version.
7. WHEN the Service_Worker activates, THE Service_Worker SHALL delete every cache whose key does not match the current CACHE_NAME, OSM_CACHE_NAME, or STATIC_RUNTIME_CACHE name, so that stale caches from previous versions are removed.
8. WHEN the install event fires, THE Service_Worker SHALL open CACHE_NAME and precache all STATIC_ASSETS entries, including `"/"`, `"/Login"`, `"/activity-planner"`, `"/manifest.json"`, `"/icon-192.png"`, `"/icon-512.png"`, and every face-detection model JSON file, using `{ cache: "reload" }` to bypass the HTTP cache.
9. WHEN a cache version string changes (i.e., CACHE_NAME is incremented), THE Service_Worker activate handler SHALL delete all caches that do not match the new version names, ensuring no stale-version assets persist on the device.

---

### Requirement 3: SPA Routing — Deep-Link and Refresh Offline Support

**User Story:** As a field worker, I want every app route (including `/dashboard`, `/profile`, `/activity-planner`) to load correctly when I refresh the page or tap a deep link while offline, so that navigation never breaks after the initial install.

#### Acceptance Criteria

1. WHEN a Navigation_Request targets any same-origin pathname that is not a static file or API route, THE Service_Worker SHALL respond with the cached App_Shell document, enabling the client-side router to handle the route.
2. WHEN a Navigation_Request targets a same-origin pathname that is an API route (pathname begins with `"/api/"`), THE Service_Worker SHALL NOT intercept it with the navigation fallback and SHALL let it pass through to the network.
3. WHEN a Navigation_Request targets a same-origin pathname that is a `/_next/` asset, THE Service_Worker SHALL NOT intercept it with the navigation fallback.
4. WHEN the user refreshes the browser while offline on any non-API same-origin route, THE Service_Worker SHALL serve the App_Shell so that the page renders without a native browser error.
5. WHEN the App_Shell is served for a deep-link navigation while offline, THE App_Shell SHALL contain sufficient precached static assets for the Next.js SPA to initialise and render the requested route's UI using only cached data.

---

### Requirement 4: App Shell and Model Precaching

**User Story:** As a field worker, I want the login page and the biometric face-detection flow to work entirely from cache, so that I can authenticate and log attendance without a network connection.

#### Acceptance Criteria

1. THE Service_Worker SHALL precache the `"/Login"` document so that the login page renders with no network dependency after the initial install.
2. THE Service_Worker SHALL precache the face-detection model JSON files (`"/models/tiny_face_detector/tiny_face_detector_model.json"` and `"/models/face_landmark68/face_landmark_68_model.json"`) so that biometric recognition is available offline.
3. WHEN a cache-first fetch for a STATIC_ASSETS URL finds a cached response, THE Service_Worker SHALL return the cached response without making a network request; IF the cached response cannot be properly returned due to corruption or a read error, THEN THE Service_Worker SHALL fall back to a network fetch for that asset.
4. WHEN a cache-first fetch for a STATIC_ASSETS URL finds no cached response, THE Service_Worker SHALL fetch the asset from the network, store the successful response in CACHE_NAME, and return it to the client.
5. IF a network fetch for a critical STATIC_ASSETS URL (specifically `"/"`, `"/Login"`, `"/activity-planner"`, or any face-detection model JSON file) fails during precaching, THEN THE Service_Worker SHALL abort the install event so that a broken offline experience is never activated on the device.

---

### Requirement 5: Connectivity Manager — Single Source of Truth

**User Story:** As a developer, I want all online/offline state to come from one provider, so that components always see a consistent connectivity status and duplicate event handlers are eliminated.

#### Acceptance Criteria

1. THE Connectivity_Manager SHALL be the sole component that attaches `window.addEventListener("online", ...)` and `window.addEventListener("offline", ...)` listeners for the purpose of updating `isOnline` state in the OfflineStatusProvider.
2. WHEN a connectivity change event fires, THE Connectivity_Manager SHALL wait for the Stability_Delay (500 ms) before committing the new `isOnline` state, so that rapid online/offline oscillations within 500 ms do not cause intermediate state updates.
3. WHEN the network transitions from online to offline and an offline notification was actually shown within the last Debounce_Window (5 seconds), THE Connectivity_Manager SHALL NOT fire a second offline toast notification; if no offline notification was shown in that window, the debounce guard SHALL NOT apply.
4. WHEN the network transitions from offline to online and an online notification was actually shown within the last Debounce_Window (5 seconds), THE Connectivity_Manager SHALL NOT fire a second online toast notification; if no online notification was shown in that window, the debounce guard SHALL NOT apply.
5. THE OfflineStatusProvider SHALL ensure that at most one connectivity notification type (offline or online) is active and visible at any given time; WHEN a new connectivity notification is triggered, THE OfflineStatusProvider SHALL dismiss any currently visible connectivity notification of the opposite type before showing the new one.
6. THE OfflineStatusProvider SHALL expose `{ isOnline, isSyncing, pendingCount, lastSyncedAt, syncNow }` as the context value, preserving the same API surface as the current implementation so that no consumer component requires changes.
7. WHILE the app is running, THE Connectivity_Manager SHALL broadcast every committed connectivity change to all context consumers via the OfflineStatusProvider context, without requiring consumers to register their own event listeners.

---

### Requirement 6: Toast Notifications — Going Offline

**User Story:** As a field worker, I want to see a brief notification when my device goes offline, so that I know my changes will be saved locally and synced later.

#### Acceptance Criteria

1. WHEN the device transitions from online to offline and the Stability_Delay has elapsed, THE Connectivity_Manager SHALL display a sonner toast with the message "You're offline. Changes will be saved locally and synced automatically."
2. THE offline toast SHALL auto-dismiss after 4 seconds without requiring any user interaction.
3. WHEN the device transitions from online to offline and the Debounce_Window has not elapsed since the last offline toast was actually shown, THE Connectivity_Manager SHALL NOT show a second offline toast.
4. THE offline toast SHALL NOT render as a persistent UI element and SHALL NOT require a manual dismiss action from the user.
5. WHEN the OfflineBanner was previously visible and the toast system is active, THE Connectivity_Manager SHALL NOT render the OfflineBanner component as part of the provider, so that no fixed-position top-bar occupies screen space.

---

### Requirement 7: Toast Notifications — Reconnection and Sync Status

**User Story:** As a field worker, I want to see a brief notification when my device reconnects and when pending changes have been synced, so that I have confidence my data is safe without any persistent UI clutter.

#### Acceptance Criteria

1. WHEN the device transitions from offline to online and the Stability_Delay has elapsed, THE Connectivity_Manager SHALL display a sonner toast with the message "You're back online. Syncing pending changes..."
2. THE reconnection toast SHALL auto-dismiss after 3 seconds without requiring any user interaction.
3. WHEN the Pending_Count transitions from a value greater than zero to zero while `isOnline` is true, THE OfflineStatusProvider SHALL display a sonner toast with the message "All offline changes have been synced."
4. THE sync-complete toast SHALL auto-dismiss after 3 seconds without requiring any user interaction.
5. WHEN the Pending_Count transitions to zero and a sync-complete toast was actually shown within the Debounce_Window, THE OfflineStatusProvider SHALL NOT show a second sync-complete toast.
6. WHEN `isSyncing` becomes true, THE OfflineStatusProvider SHALL NOT display an additional toast for the syncing-in-progress state, because the reconnection toast already communicates that syncing has begun.

---

### Requirement 8: OfflineBanner Component Deprecation

**User Story:** As a developer, I want the OfflineBanner component to be removed from the provider's render tree, so that the fixed-position top-bar no longer displaces page content while the toast system handles all notifications.

#### Acceptance Criteria

1. THE OfflineStatusProvider SHALL NOT render the `<OfflineBanner>` component inside its JSX after this feature is implemented.
2. THE OfflineBanner component file (`components/OfflineBanner.tsx`) MAY be retained as an inert utility component but SHALL NOT be automatically mounted by any provider or layout.
3. WHEN the OfflineBanner is removed from the provider, THE removal SHALL NOT affect the `isOnline`, `isSyncing`, `pendingCount`, `lastSyncedAt`, or `syncNow` values exposed by the context.
4. IF any existing passing test directly imports or renders `<OfflineBanner>`, THEN THE component interface (props: `isOnline`, `isSyncing`, `pendingCount`, `onSyncNow?`) SHALL remain unchanged so that those tests continue to pass.

---

### Requirement 9: Manifest Integrity

**User Story:** As a developer, I want to confirm the PWA manifest is correctly configured, so that installation and offline launch behave according to spec without requiring manifest changes.

#### Acceptance Criteria

1. THE manifest.json SHALL contain `"start_url": "/activity-planner"` so that the installed PWA launches the activity planner page.
2. THE manifest.json SHALL contain `"scope": "/"` so that all app routes fall within the PWA scope.
3. THE manifest.json SHALL contain `"id": "/activity-planner"` as the application identity.
4. THE manifest.json SHALL contain `"display": "standalone"` or `"display": "fullscreen"` so that the app launches without browser chrome; `"standalone"` is the currently configured value and satisfies this requirement.
5. THE manifest.json SHALL contain `"background_color"` and `"theme_color"` fields with non-empty string values.
6. THE manifest.json SHALL require no modifications as part of this feature implementation, because all required fields are already correctly set.

---

### Requirement 10: Validation and Testing

**User Story:** As a developer, I want automated tests and a validation checklist that confirm the offline launch fix and toast UX are working correctly, so that regressions are caught before deployment.

#### Acceptance Criteria

1. THE test suite SHALL include a unit test that verifies the Service_Worker navigation fallback: given a Navigation_Request while the cache contains the App_Shell, the fetch handler SHALL return a response with status 200 and the App_Shell body.
2. THE test suite SHALL include a unit test that verifies the Service_Worker navigation fallback does NOT intercept API routes: given a Navigation_Request to `"/api/anything"`, the fetch handler SHALL not return a cached App_Shell response.
3. THE test suite SHALL include a unit test for the OfflineStatusProvider that verifies an offline toast is shown with the correct message when the `"offline"` window event fires.
4. THE test suite SHALL include a unit test for the OfflineStatusProvider that verifies a reconnect toast is shown with the correct message when the `"online"` window event fires.
5. THE test suite SHALL include a unit test for the OfflineStatusProvider that verifies the debounce logic: a second `"offline"` event fired within the Debounce_Window SHALL NOT produce a second toast.
6. THE test suite SHALL include a unit test for the Connectivity_Manager stability delay: a rapid offline→online transition within 500 ms SHALL NOT commit the offline state.
7. THE test suite SHALL include an integration test that verifies the offline launch sequence: the Service_Worker install precaches STATIC_ASSETS, a subsequent Navigation_Request while offline returns the App_Shell, and the App_Shell document renders without error.
8. WHEN all unit and integration tests pass, THE development team SHALL manually verify on a physical device or browser DevTools offline mode that installing the PWA and toggling the device to airplane mode before opening the app shows the app shell instead of the browser offline error page.
9. THE test suite SHALL preserve all currently passing tests in `__tests__/` without modification.
10. THE test suite SHALL include a property-based test that verifies: FOR ALL sequences of online/offline events rapid enough to stay within the Stability_Delay, THE committed `isOnline` state after the sequence ends SHALL equal the state of the final event in the sequence.
