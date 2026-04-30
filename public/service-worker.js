// public/service-worker.js
// Acculog PWA — Service Worker v10 - Fixed offline support

const CACHE_NAME     = "acculog-cache-v10";   // bump version → forces re-install
const OSM_CACHE_NAME = "acculog-osm-tiles-v1";
const SYNC_TAG       = "sync-activity-logs";

// ── Static shell ──────────────────────────────────────────────────────────────

const STATIC_ASSETS = [
  "/",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  // face-api model manifests (weights are large — cached on first use)
  "/models/tiny_face_detector/tiny_face_detector_model.json",
  "/models/face_landmark68/face_landmark_68_model.json",
];

// ── Runtime cache for Next.js static assets ─────────────────────────────────
const STATIC_RUNTIME_CACHE = "acculog-runtime-static-v1";

// ── Cacheable API patterns (GET only) ────────────────────────────────────────

const CACHEABLE_API_PATTERNS = [
  /\/api\/ModuleSales\/Activity\/FetchLog/,
  /\/api\/ModuleSales\/Activity\/LastStatus/,
  /\/api\/ModuleSales\/Activity\/LoginSummary/,
  /\/api\/ModuleSales\/Activity\/SiteVisitCountToday/,
  /\/api\/ModuleSales\/Activity\/Meeting/,
  /\/api\/users/,
  /\/api\/user/,
  /\/api\/fetch-account/,
  /\/api\/fetch-tsm/,
  /\/api\/fetch-manager/,
  /\/api\/admin\/settings/,
];

// OSM tile hosts
const OSM_HOSTS = [
  "tile.openstreetmap.org",
  "a.tile.openstreetmap.org",
  "b.tile.openstreetmap.org",
  "c.tile.openstreetmap.org",
];

// ── Install ───────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        // Use individual put() calls so a single 404 doesn't fail the whole install.
        Promise.all(
          STATIC_ASSETS.map((url) =>
            fetch(url, { cache: "reload" })
              .then((res) => (res.ok ? cache.put(url, res) : null))
              .catch(() => null)
          )
        )
      )
      .then(() => self.skipWaiting())   // activate immediately
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME && k !== OSM_CACHE_NAME && k !== STATIC_RUNTIME_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())  // take control without reload
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ⓪ Skip Next.js dev internals (HMR, webpack chunks, dev-time assets).
  // These change on every reload and should never be cached.
  if (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.startsWith("/_next/static/development") ||
    url.pathname.startsWith("/__nextjs") ||
    url.pathname.startsWith("/_next/data") ||
    url.search.includes("hot-update")
  ) {
    return; // let the browser handle it normally
  }

  // ① OSM map tiles — Cache-First, max 500 tiles
  if (OSM_HOSTS.includes(url.hostname)) {
    event.respondWith(osmTileStrategy(request));
    return;
  }

  // Cross-origin requests (other than OSM) — pass through, no caching.
  if (url.origin !== self.location.origin) {
    return;
  }

  // ② Non-GET (POST/PUT/DELETE) — pass through; return friendly error offline
  if (request.method !== "GET") {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({
            error: "You are offline. This action will sync when connection is restored.",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // ③ Next.js static assets (JS/CSS bundles) — Runtime Cache-First
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(runtimeCacheFirst(request, STATIC_RUNTIME_CACHE));
    return;
  }

  // ④ Cacheable API GETs — Network-First with cache fallback
  if (CACHEABLE_API_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(networkFirstWithCache(request, CACHE_NAME));
    return;
  }

  // ⑤ face-api / model weights — Cache-First (large binary, rarely changes)
  if (url.pathname.startsWith("/models/")) {
    event.respondWith(cacheFirstWithNetwork(request, CACHE_NAME));
    return;
  }

  // ⑥ Navigation requests (pages) — Serve cached shell, let SPA handle routing
  if (request.mode === "navigate") {
    event.respondWith(navigateWithFallback(request));
    return;
  }

  // ⑦ Everything else (images, fonts, etc) — Cache-First
  event.respondWith(cacheFirstWithNetwork(request, CACHE_NAME));
});

// ── Background Sync ───────────────────────────────────────────────────────────
// Fires when the browser reconnects after being offline.
// We can't call IndexedDB directly from the SW (it's on the page side),
// so we simply tell all open windows to trigger their sync logic.

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(notifyClientsToSync());
  }
});

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (clients.length === 0) return;
  clients.forEach((client) =>
    client.postMessage({ type: "SW_SYNC_TRIGGER" })
  );
}

// ── Message Handler ───────────────────────────────────────────────────────────
// Listen for messages from the client (e.g., skip waiting for updates)

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Caching strategies ────────────────────────────────────────────────────────

/**
 * OSM tiles: serve from cache instantly; fetch & cache in background.
 * Evict oldest tiles when the cache hits 500 entries.
 */
async function osmTileStrategy(request) {
  const cache  = await caches.open(OSM_CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const keys = await cache.keys();
      if (keys.length >= 500) {
        // Drop oldest 50 tiles to stay within budget
        for (let i = 0; i < 50 && i < keys.length; i++) {
          await cache.delete(keys[i]);
        }
      }
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return a 1×1 transparent PNG placeholder tile when offline
    return new Response(
      new Uint8Array([
        0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,
        0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,
        0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,0x89,0x00,0x00,0x00,
        0x0a,0x49,0x44,0x41,0x54,0x78,0x9c,0x62,0x00,0x01,0x00,0x00,
        0x05,0x00,0x01,0x0d,0x0a,0x2d,0xb4,0x00,0x00,0x00,0x00,0x49,
        0x45,0x4e,0x44,0xae,0x42,0x60,0x82,
      ]).buffer,
      { headers: { "Content-Type": "image/png" } }
    );
  }
}

/**
 * Network-First: try network, fall back to cache.
 * Good for API data that should be fresh but must work offline.
 */
async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: "Offline — cached data unavailable." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Cache-First: serve from cache; fetch from network only on a miss.
 * Good for static assets that change infrequently.
 */
async function cacheFirstWithNetwork(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

/**
 * Runtime Cache-First: For Next.js static assets that are generated at build time.
 * These are immutable (hashed filenames), so we cache them aggressively.
 */
async function runtimeCacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone before putting to cache since we need to return the response too
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Return cached version or 503 if not available
    if (cached) return cached;
    return new Response("Offline - static asset unavailable", { status: 503 });
  }
}

/**
 * Navigation Fallback: For page navigation requests.
 * Try network first, fall back to cached shell, or return offline page.
 */
async function navigateWithFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    // Try network first for fresh content
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      // Cache successful navigation responses for offline use
      // Clone the response before caching
      const responseClone = networkResponse.clone();
      
      // Only cache same-origin successful HTML responses
      if (request.url.startsWith(self.location.origin)) {
        cache.put(request, responseClone);
      }
      return networkResponse;
    }
  } catch (err) {
    // Network failed - try to serve from cache
  }
  
  // Try to serve the cached version of this specific page
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;
  
  // Fall back to the main app shell (home page)
  const shell = await cache.match("/");
  if (shell) return shell;
  
  // Last resort - try the start URL from manifest
  const startUrl = await cache.match("/activity-planner");
  if (startUrl) return startUrl;
  
  // If nothing is cached, return offline error
  return new Response(
    `<!DOCTYPE html>
    <html>
    <head><title>Offline</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:50px;">
      <h1>You're Offline</h1>
      <p>Please check your internet connection and try again.</p>
      <button onclick="location.reload()">Retry</button>
    </body>
    </html>`,
    { status: 503, headers: { "Content-Type": "text/html" } }
  );
}