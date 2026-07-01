// public/service-worker.js
// Acculog PWA — Service Worker v13

const CACHE_NAME     = "acculog-cache-v13";
const OSM_CACHE_NAME = "acculog-osm-tiles-v1";
const SYNC_TAG       = "sync-activity-logs";
const OSM_MAX_ENTRIES = 200;

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

const STATIC_RUNTIME_CACHE = "acculog-runtime-static-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(
        STATIC_ASSETS.map((url) => new Request(url, { cache: "reload" }))
      );
      if ("sync" in self.registration) {
        await self.registration.sync.register(SYNC_TAG);
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const validCaches = new Set([CACHE_NAME, OSM_CACHE_NAME, STATIC_RUNTIME_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !validCaches.has(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isDevOnlyRequest(url) {
  return (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.startsWith("/_next/static/development") ||
    url.pathname.startsWith("/__nextjs") ||
    url.pathname.startsWith("/_next/data") ||
    url.search.includes("hot-update")
  );
}

async function handleNavigationRequest(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) return networkResponse;
    throw new Error(`Non-OK: ${networkResponse.status}`);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match("/");
    if (cached) return cached;
    return fetch(request);
  }
}

async function handleStaleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const networkUpdate = fetch(request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(STATIC_RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  return cached ?? await networkUpdate;
}

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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (isDevOnlyRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStaleWhileRevalidate(request));
    return;
  }

  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(handleOSMTile(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request))
  );
});
