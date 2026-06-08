// public/service-worker.js
// Acculog PWA — Service Worker v12

const CACHE_NAME     = "acculog-cache-v12";
const OSM_CACHE_NAME = "acculog-osm-tiles-v1";
const SYNC_TAG       = "sync-activity-logs";

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
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          STATIC_ASSETS.map((url) =>
            fetch(url, { cache: "reload" })
              .then((res) => (res.ok ? cache.put(url, res) : null))
              .catch(() => null)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

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
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.startsWith("/_next/static/development") ||
    url.pathname.startsWith("/__nextjs") ||
    url.pathname.startsWith("/_next/data") ||
    url.search.includes("hot-update")
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((response) => {
      return response || fetch(request);
    })
  );
});
