// hooks/useOfflineSync.ts
"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { toast } from "sonner";
import {
  getAllPendingLogs,
  removePendingLog,
  incrementRetry,
  getPendingCount,
} from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";

const MAX_RETRIES = 5;

export function useOfflineSync(onSyncComplete?: () => void) {
  const syncingRef = useRef(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Keep callback in a ref to avoid triggering re-syncs if it's unstable
  const onSyncCompleteRef = useRef(onSyncComplete);
  useEffect(() => {
    onSyncCompleteRef.current = onSyncComplete;
  }, [onSyncComplete]);

  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // ── Refresh badge count ───────────────────────────────────────────────────

  const refreshCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch {
      // IndexedDB unavailable (SSR, private mode) — fail silently
    }
  }, []);

  // ── Core sync loop ────────────────────────────────────────────────────────

  const syncNow = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return;

    syncingRef.current = true;
    setIsSyncing(true);

    let logs;
    try {
      logs = await getAllPendingLogs();
    } catch {
      syncingRef.current = false;
      setIsSyncing(false);
      return;
    }

    if (logs.length === 0) {
      syncingRef.current = false;
      setIsSyncing(false);
      return;
    }

    let successCount = 0;
    let failCount    = 0;

    for (const log of logs) {
      // Permanently discard logs that have failed too many times
      if (log.retries >= MAX_RETRIES) {
        await removePendingLog(log.id);
        continue;
      }

      try {
        // ① If the PhotoURL is still a base64 string, upload it to Cloudinary first
        const payload = { ...log.payload } as any;
        if (payload.PhotoURL && payload.PhotoURL.startsWith("data:image/")) {
          try {
            const uploadedUrl = await uploadToCloudinary(payload.PhotoURL);
            payload.PhotoURL = uploadedUrl;
          } catch {
            await incrementRetry(log.id);
            failCount++;
            continue; // Skip this log for now; try again next sync
          }
        }

        // ② Send the updated payload to our local API
        const res = await fetch("/api/ModuleSales/Activity/AddLog", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        });

        if (res.ok || res.status === 409) {
          // 409 = duplicate already saved on server — safe to remove
          await removePendingLog(log.id);
          successCount++;
        } else {
          await incrementRetry(log.id);
          failCount++;
        }
      } catch {
        await incrementRetry(log.id);
        failCount++;
      }
    }

    syncingRef.current = false;
    setIsSyncing(false);
    await refreshCount();

    if (successCount > 0) {
      toast.success(
        `${successCount} offline log${successCount > 1 ? "s" : ""} synced!`
      );
      onSyncCompleteRef.current?.();
    }

    if (failCount > 0) {
      toast.error(
        `${failCount} log${failCount > 1 ? "s" : ""} failed to sync. Will retry later.`
      );
    }
  }, [refreshCount]); // No longer depends on onSyncComplete

  // ── Event listeners ───────────────────────────────────────────────────────

  useEffect(() => {
    // Populate count immediately on mount
    refreshCount();

    const handleOnline  = () => { setIsOnline(true);  syncNow(); };
    const handleOffline = () => setIsOnline(false);

    // Fired by ServiceWorkerRegister when SW posts SW_SYNC_TRIGGER
    const handleSWSync  = () => syncNow();

    window.addEventListener("online",          handleOnline);
    window.addEventListener("offline",         handleOffline);
    window.addEventListener("acculog:sync",    handleSWSync);

    // Attempt sync on first render if already online
    if (navigator.onLine) syncNow();

    return () => {
      window.removeEventListener("online",       handleOnline);
      window.removeEventListener("offline",      handleOffline);
      window.removeEventListener("acculog:sync", handleSWSync);
    };
  }, [syncNow, refreshCount]);

  return { pendingCount, isOnline, isSyncing, syncNow };
}