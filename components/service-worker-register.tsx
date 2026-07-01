// components/ServiceWorkerRegister.tsx
// Registers the main PWA service worker and the Firebase messaging service worker.
// Firebase is intentionally scoped to /firebase-cloud-messaging-push-scope
// so it does NOT compete with the main SW for navigation and fetch control.
"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // ── Main PWA service worker ──────────────────────────────────────────────
    // Owns the full scope ("/") and handles all offline caching / navigation.
    navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .then((reg) => {
        // Request background sync permission (best-effort — Safari ignores it)
        if ("sync" in reg) {
          (reg as any).sync.register("sync-activity-logs").catch(() => {});
        }
      })
      .catch((err) => {
        console.warn("[SW] Main service worker registration failed:", err);
      });

    // ── Firebase Messaging service worker ────────────────────────────────────
    // Registered under a narrower scope so it never intercepts page navigations
    // or asset fetches.  This prevents it from overriding the main SW's control
    // and causing iOS Safari to lose the cached shell when offline.
    //
    // NOTE: The firebase-messaging-sw.js file itself only uses
    // importScripts + messaging.onBackgroundMessage, so it does not need "/"
    // scope — push messages are delivered regardless of SW scope.
    navigator.serviceWorker
      .register("/firebase-messaging-sw.js", {
        scope: "/firebase-cloud-messaging-push-scope",
      })
      .catch((err) => {
        // Non-fatal — push notifications are degraded but the PWA still works.
        console.warn("[SW] Firebase messaging SW registration failed:", err);
      });

    // ── Bridge SW messages → window custom events ────────────────────────────
    // The main SW posts SW_SYNC_TRIGGER when background sync fires.
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_SYNC_TRIGGER") {
        window.dispatchEvent(new CustomEvent("acculog:sync"));
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);

    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, []);

  return null;
}
