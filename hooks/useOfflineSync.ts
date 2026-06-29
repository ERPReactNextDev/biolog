// hooks/useOfflineSync.ts
"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { toast } from "sonner";
import {
  getAllPendingLogs,
  removePendingLog,
  incrementRetry,
  getPendingCount,
  clearAllPendingLogs,
  acquireSyncLock,
  releaseSyncLock,
  isSyncLocked,
} from "@/lib/offline-store";
import { uploadToCloudinary } from "@/lib/cloudinary";

const MAX_RETRIES = 5;

export function useOfflineSync(onSyncComplete?: () => void) {
  const syncingRef = useRef(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const onSyncCompleteRef = useRef(onSyncComplete);
  useEffect(() => {
    onSyncCompleteRef.current = onSyncComplete;
  }, [onSyncComplete]);

  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  const refreshCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch { /* IndexedDB unavailable */ }
  }, []);

  const syncNow = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) {
      console.log("[sync] Skipped - already syncing or offline");
      return;
    }

    // Acquire the global lock shared with OfflineStatusProvider to prevent
    // both sync loops from processing the same pending-logs simultaneously.
    if (!acquireSyncLock()) {
      console.log("[sync] Skipped - global sync lock held by another sync loop");
      // Schedule a deferred refresh so our pendingCount reflects whatever the
      // other sync loop processed, once it releases the lock.
      // Use a microtask-safe approach: wait for the current tick to pass, then
      // refresh. Production: 500 ms is imperceptible. Tests: advanceTimersByTime handles it.
      setTimeout(async () => {
        await refreshCount();
      }, 500);
      return;
    }

    syncingRef.current = true;
    setIsSyncing(true);
    console.log("[sync] Starting sync...");

    let logs;
    try {
      logs = await getAllPendingLogs();
      console.log(`[sync] Found ${logs.length} pending logs`);
    } catch (err) {
      console.error("[sync] Failed to read pending logs:", err);
      syncingRef.current = false;
      setIsSyncing(false);
      releaseSyncLock();
      return;
    }

    if (logs.length === 0) {
      console.log("[sync] No pending logs to sync");
      syncingRef.current = false;
      setIsSyncing(false);
      releaseSyncLock();
      return;
    }

    let successCount = 0;
    let failCount    = 0;
    const syncedIds: string[] = [];

    // Process logs sequentially to avoid race conditions
    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      console.log(`[sync] Processing log ${i + 1}/${logs.length}: ${log.id}`);
      
      if (log.retries >= MAX_RETRIES) {
        console.warn(`[sync] Discarding log ${log.id} after ${log.retries} retries`);
        await removePendingLog(log.id).catch(() => {});
        continue;
      }

      try {
        const payload = { ...log.payload } as Record<string, any>;

        // ── Preserve the original offline timestamp ──────────────────────
        if (!payload.date_created) {
          payload.date_created = new Date(log.createdAt).toISOString();
        }

        // ── Upload base64 photo to Cloudinary ────────────────────────────
        if (
          payload.PhotoURL &&
          typeof payload.PhotoURL === "string" &&
          payload.PhotoURL.startsWith("data:image/")
        ) {
          try {
            console.log(`[sync] Uploading photo for log ${log.id}...`);
            const uploadedUrl = await uploadToCloudinary(payload.PhotoURL);
            payload.PhotoURL = uploadedUrl;
            console.log(`[sync] Photo uploaded: ${uploadedUrl.slice(0, 60)}...`);
          } catch (uploadErr) {
            console.error(`[sync] Cloudinary upload failed for log ${log.id}:`, uploadErr);
            await incrementRetry(log.id).catch(() => {});
            failCount++;
            continue;
          }
        }

        // ── Submit to API ────────────────────────────────────────────────
        console.log(`[sync] Submitting log ${log.id}:`, {
          ReferenceID: payload.ReferenceID,
          Type: payload.Type,
          Status: payload.Status,
          date_created: payload.date_created,
        });

        const res = await fetch("/api/ModuleSales/Activity/AddLog", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
        });

        if (res.ok) {
          console.log(`[sync] Log ${log.id} synced successfully`);
          syncedIds.push(log.id);
          successCount++;
        } else if (res.status === 409) {
          // Duplicate — already on server, safe to remove
          const body = await res.json().catch(() => ({}));
          console.log(`[sync] Log ${log.id} is a duplicate (409), removing:`, body);
          syncedIds.push(log.id);
          successCount++;
        } else {
          const body = await res.json().catch(() => ({}));
          console.error(`[sync] Log ${log.id} failed with ${res.status}:`, body);
          await incrementRetry(log.id).catch(() => {});
          failCount++;
        }
      } catch (err) {
        console.error(`[sync] Network error for log ${log.id}:`, err);
        await incrementRetry(log.id).catch(() => {});
        failCount++;
      }
      
      // Small delay between logs to prevent overwhelming the server
      if (i < logs.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // ── Remove all synced logs from IndexedDB ───────────────────────────
    console.log(`[sync] Removing ${syncedIds.length} synced logs from local storage`);
    for (const id of syncedIds) {
      await removePendingLog(id).catch((err) => {
        console.error(`[sync] Failed to remove log ${id}:`, err);
      });
    }

    syncingRef.current = false;
    setIsSyncing(false);
    releaseSyncLock();
    await refreshCount();

    if (successCount > 0) {
      toast.success(
        `${successCount} offline record${successCount > 1 ? "s" : ""} synced and cleared from local storage!`
      );
      onSyncCompleteRef.current?.();
    }

    if (failCount > 0) {
      toast.error(
        `${failCount} record${failCount > 1 ? "s" : ""} failed to sync — will retry automatically.`
      );
    }
  }, [refreshCount]);

  // ── Notify about pending activities ─────────────────────────────────────────
  useEffect(() => {
    // Notify when coming back online with pending activities
    const notifyPendingOnOnline = () => {
      if (navigator.onLine && pendingCount > 0) {
        toast.info(
          `You have ${pendingCount} offline activity${pendingCount > 1 ? 'ies' : 'y'} pending to sync`,
          {
            duration: 5000,
            action: {
              label: "Sync Now",
              onClick: () => syncNow()
            }
          }
        );
      }
    };

    // Notify when app becomes visible with pending activities
    const notifyPendingOnVisible = () => {
      if (document.visibilityState === 'visible' && pendingCount > 0) {
        // Small delay to not interrupt the user immediately
        setTimeout(() => {
          if (navigator.onLine) {
            toast.info(
              `${pendingCount} offline activity${pendingCount > 1 ? 'ies' : 'y'} waiting to sync`,
              {
                duration: 4000,
                action: {
                  label: "Sync Now",
                  onClick: () => syncNow()
                }
              }
            );
          } else {
            toast.warning(
              `You have ${pendingCount} offline activit${pendingCount > 1 ? 'ies' : 'y'} saved. Connect to internet to sync.`,
              { duration: 5000 }
            );
          }
        }, 2000);
      }
    };

    window.addEventListener("online", notifyPendingOnOnline);
    document.addEventListener("visibilitychange", notifyPendingOnVisible);

    return () => {
      window.removeEventListener("online", notifyPendingOnOnline);
      document.removeEventListener("visibilitychange", notifyPendingOnVisible);
    };
  }, [pendingCount, syncNow]);

  useEffect(() => {
    refreshCount();

    const handleOnline  = () => { setIsOnline(true);  syncNow(); };
    const handleOffline = () => setIsOnline(false);
    const handleSWSync  = () => syncNow();
    
    // ── Sync when app becomes visible (user returns to app) ─────────────────
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        // Small delay to let network stabilize
        setTimeout(() => syncNow(), 1000);
      }
    };
    
    // ── Periodic sync retry every 30 seconds when online ───────────────────
    const periodicSyncInterval = setInterval(() => {
      if (navigator.onLine && pendingCount > 0 && !syncingRef.current) {
        syncNow();
      }
    }, 30000);

    window.addEventListener("online",       handleOnline);
    window.addEventListener("offline",      handleOffline);
    window.addEventListener("acculog:sync", handleSWSync);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Initial sync on mount
    if (navigator.onLine) syncNow();

    return () => {
      window.removeEventListener("online",       handleOnline);
      window.removeEventListener("offline",      handleOffline);
      window.removeEventListener("acculog:sync", handleSWSync);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(periodicSyncInterval);
    };
  }, [syncNow, refreshCount, pendingCount]);

  const clearAllPending = useCallback(async () => {
    if (pendingCount === 0) return;
    
    try {
      await clearAllPendingLogs();
      await refreshCount();
      toast.success("All pending records cleared from local storage");
    } catch (err) {
      console.error("[sync] Failed to clear pending logs:", err);
      toast.error("Failed to clear pending records");
    }
  }, [pendingCount, refreshCount]);

  return { pendingCount, isOnline, isSyncing, syncNow, clearAllPending };
}
