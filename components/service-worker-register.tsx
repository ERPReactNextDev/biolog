// components/ServiceWorkerRegister.tsx
// Registers the main service worker and the Firebase messaging service worker.
"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // ── Main PWA service worker ──────────────────────────────────────────
    navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .then((reg) => {
        if ("sync" in reg) {
          (reg as any).sync
            .register("sync-activity-logs")
            .catch(() => {});
        }
      })
      .catch(() => {});

    // ── Firebase Messaging service worker ────────────────────────────────
    navigator.serviceWorker
      .register("/firebase-messaging-sw.js", { scope: "/" })
      .catch(() => {});

    // ── Bridge SW messages → window custom events ────────────────────────
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
