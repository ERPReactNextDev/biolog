// components/ServiceWorkerRegister.tsx
// Registers the service worker and bridges SW → window custom events.
// Drop this into your root layout once: <ServiceWorkerRegister />
"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator))  return;

    // ── Register ────────────────────────────────────────────────────────────
    navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .then((reg) => {

        // Request a Background Sync tag so the SW can wake the page
        // when the network returns (Chrome / Edge).
        if ("sync" in reg) {
          (reg as any).sync
            .register("sync-activity-logs")
            .catch(() => {/* Background Sync not permitted — fall back to online event */});
        }
      })
      .catch(() => { /* silent */ });

    // ── Bridge SW messages → window custom events ────────────────────────
    // The service worker posts { type: "SW_SYNC_TRIGGER" } via Background Sync.
    // useOfflineSync listens for the "acculog:sync" window event.
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

  return null; // renders nothing
}