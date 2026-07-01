// public/service-worker.js
// Acculog PWA — Service Worker v15
// Fixes: resilient install, correct offline navigation fallback,
//        RSC request caching, improved _next/static caching.

const CACHE_NAME            = "acculog-cache-v15";
const OSM_CACHE_NAME        = "acculog-osm-tiles-v1";
const STATIC_RUNTIME_CACHE  = "acculog-runtime-static-v3";
const RSC_CACHE_NAME        = "acculog-rsc-v1";
const SYNC_TAG              = "sync-activity-logs";
const OSM_MAX_ENTRIES       = 200;
const SAME_ORIGIN_RUNTIME_DESTINATIONS = new Set([
  "script",
  "style",
  "font",
  "image",
  "manifest",
  "worker",
]);

// ─── Assets to pre-cache on install ───────────────────────────────────────────
// These are cached individually so a single 404 does NOT abort the whole install.
const STATIC_ASSETS = [
  "/",
  "/Login",
  "/activity-planner",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/models/tiny_face_detector/tiny_face_detector_model.json",
  "/models/face_landmark68/face_landmark_68_model.json",
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Cache each asset individually — a 404 on one asset will NOT fail the
      // entire install.  This is the critical fix for the iOS offline-launch bug.
      await Promise.allSettled(
        STATIC_ASSETS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch (err) {
            console.warn(`[SW] Failed to pre-cache ${url}:`, err);
          }
        })
      );

      // Register background sync (best-effort)
      if ("sync" in self.registration) {
        try {
          await self.registration.sync.register(SYNC_TAG);
        } catch (err) {
          console.warn("[SW] Background sync registration failed:", err);
        }
      }

      await self.skipWaiting();
    })()
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const validCaches = new Set([
        CACHE_NAME,
        OSM_CACHE_NAME,
        STATIC_RUNTIME_CACHE,
        RSC_CACHE_NAME,
      ]);
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !validCaches.has(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isDevOnlyRequest(url) {
  return (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.startsWith("/_next/static/development") ||
    url.pathname.startsWith("/__nextjs") ||
    url.pathname.startsWith("/_next/data") ||
    url.search.includes("hot-update")
  );
}

function isAppShellAssetRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  if (request.mode === "navigate") return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.search.includes("_rsc=")) return false;

  if (url.pathname.startsWith("/_next/")) return true;
  if (url.pathname === "/manifest.json") return true;
  if (url.pathname.startsWith("/models/")) return true;

  return SAME_ORIGIN_RUNTIME_DESTINATIONS.has(request.destination);
}

// ─── Navigation handler ───────────────────────────────────────────────────────
// Priority when offline:
//   1. Exact URL match in cache
//   2. /activity-planner  (the PWA start_url / shell)
//   3. /                  (root fallback)
async function handleNavigationRequest(request) {
  // Always try the network first.
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Opportunistically cache the navigation response so it's available offline.
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
    throw new Error(`Non-OK: ${networkResponse.status}`);
  } catch {
    // Network unavailable — serve from cache in priority order.
    const cache = await caches.open(CACHE_NAME);

    const exactMatch = await cache.match(request);
    if (exactMatch) return exactMatch;

    const shellMatch = await cache.match("/activity-planner");
    if (shellMatch) return shellMatch;

    const rootMatch = await cache.match("/");
    if (rootMatch) return rootMatch;

    // Absolute last resort: let the browser handle it (will show native error).
    return fetch(request);
  }
}

// ─── Stale-while-revalidate ───────────────────────────────────────────────────
async function handleStaleWhileRevalidate(request, cacheName = STATIC_RUNTIME_CACHE) {
  const cached = await caches.match(request);

  const networkUpdate = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  // Return cached immediately if available; otherwise wait for network.
  return cached ?? (await networkUpdate);
}

// ─── RSC (React Server Component) handler ─────────────────────────────────────
// Next.js App Router appends ?_rsc=<id> to in-flight server component requests.
// Without caching these, navigating while offline shows a blank page / error.
async function handleRSCRequest(request) {
  const cached = await caches.match(request);

  const networkUpdate = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(RSC_CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached ?? (await networkUpdate);
}

// ─── OpenStreetMap tile handler ───────────────────────────────────────────────
async function handleOSMTile(request) {
  const cache = await caches.open(OSM_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const keys = await cache.keys();
    if (keys.length >= OSM_MAX_ENTRIES) {
      await cache.delete(keys[0]);
    }
    await cache.put(request, response.clone());
  }
  return response;
}

// ─── Fetch handler ────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept mutations or other non-GET requests.
  if (request.method !== "GET") return;

  // Skip dev-only noise
  if (isDevOnlyRequest(url)) return;

  // ── Navigation requests (HTML page loads) ──
  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // ── Next.js RSC requests (?_rsc=…) ──
  // Must be checked before the _next/static rule.
  if (url.search.includes("_rsc=")) {
    event.respondWith(handleRSCRequest(request));
    return;
  }

  // ── Next.js static assets (JS, CSS, fonts, images) ──
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStaleWhileRevalidate(request, STATIC_RUNTIME_CACHE));
    return;
  }

  // ── Same-origin app-shell assets (Next manifests, icons, models, media) ──
  // These requests are required to boot the cached shell offline even when
  // App Router pulls them after the initial navigation response is served.
  if (isAppShellAssetRequest(request, url)) {
    event.respondWith(handleStaleWhileRevalidate(request, STATIC_RUNTIME_CACHE));
    return;
  }

  // ── OpenStreetMap tiles ──
  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(handleOSMTile(request));
    return;
  }

  // ── Everything else: cache-first, then network ──
  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request))
  );
});

// ─── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(
      self.clients
        .matchAll({ includeUncontrolled: true, type: "window" })
        .then((clients) => {
          clients.forEach((client) =>
            client.postMessage({ type: "SW_SYNC_TRIGGER" })
          );
        })
    );
  }
});
