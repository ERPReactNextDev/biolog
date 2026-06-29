"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import {
  getAllPendingLogs,
  removePendingLog,
  incrementRetry,
  getPendingCount,
  acquireSyncLock,
  releaseSyncLock,
} from "@/lib/offline-store";
import OfflineBanner from "@/components/OfflineBanner";

// ── Context shape ─────────────────────────────────────────────────────────────

export interface OfflineStatusContextValue {
  /** Whether the device currently has network connectivity. */
  isOnline: boolean;
  /** Whether the sync engine is actively uploading pending records. */
  isSyncing: boolean;
  /** Number of records waiting to be synced. */
  pendingCount: number;
  /** Epoch-ms timestamp of the last successful sync, or null if never synced. */
  lastSyncedAt: number | null;
  /** Manually trigger a sync attempt. Re-entrant calls are no-ops while syncing. */
  syncNow: () => Promise<void>;
}

// ── Context with safe defaults ────────────────────────────────────────────────

export const OfflineStatusContext = createContext<OfflineStatusContextValue>({
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  lastSyncedAt: null,
  syncNow: async () => {},
});

// ── Convenience hook ──────────────────────────────────────────────────────────

/**
 * Access the current offline status and sync controls from any client component.
 *
 * @example
 * const { isOnline, pendingCount, syncNow } = useOfflineStatus();
 */
export function useOfflineStatus(): OfflineStatusContextValue {
  return useContext(OfflineStatusContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface OfflineStatusProviderProps {
  children: React.ReactNode;
}

/**
 * Provides offline status and sync controls to the entire component tree.
 * Mount this once in `app/layout.tsx` wrapping `{children}`.
 *
 * Registers window online/offline listeners, manages the sync singleton with
 * exponential backoff, and renders <OfflineBanner> internally so no consumer
 * needs to wire the banner manually.
 */
export function OfflineStatusProvider({ children }: OfflineStatusProviderProps) {
  // SSR-safe: default to `true` on the server where navigator is unavailable
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Re-entrant guard — true while syncNow is executing
  const syncingRef = useRef(false);

  // ── Sync engine ─────────────────────────────────────────────────────────

  const syncNow = useCallback(async (): Promise<void> => {
    // Guard: skip if already syncing or no network
    if (syncingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    // Guard: skip if the global lock is held by useOfflineSync on this page.
    // This prevents both sync loops from processing pending-logs simultaneously
    // and submitting the same log twice (Req 3.9 preservation).
    if (!acquireSyncLock()) return;

    syncingRef.current = true;
    setIsSyncing(true);

    try {
      const logs = await getAllPendingLogs();

      // Update the badge count before starting
      setPendingCount(logs.length);

      for (const log of logs) {
        // Dead-letter: skip entries that already exhausted retries
        if (log.retries >= 5) {
          // Already at dead-letter threshold — do not retry
          setPendingCount((c) => Math.max(0, c - 1));
          continue;
        }

        // Exponential backoff: base 1 s, multiplier 2×, cap 32 s
        const backoffMs = Math.min(1000 * Math.pow(2, log.retries), 32_000);
        if (log.retries > 0) {
          await new Promise<void>((res) => setTimeout(res, backoffMs));
        }

        try {
          const response = await fetch("/api/activity-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(log.payload),
          });

          if (response.ok) {
            await removePendingLog(log.id);
            setPendingCount((c) => Math.max(0, c - 1));
          } else if (response.status >= 400 && response.status < 500) {
            // 4xx — move to dead-letter after incrementing to >= 5
            await incrementRetry(log.id);
            if (log.retries + 1 >= 5) {
              // Entry is now dead-letter; remove from active count
              setPendingCount((c) => Math.max(0, c - 1));
            }
          } else {
            // 5xx or network error — increment retry counter, try again later
            await incrementRetry(log.id);
          }
        } catch {
          // Network failure during individual log upload — increment and continue
          await incrementRetry(log.id);
        }
      }

      setLastSyncedAt(Date.now());

      // Refresh pending count from store after processing
      const remaining = await getPendingCount();
      setPendingCount(remaining);
    } finally {
      setIsSyncing(false);
      syncingRef.current = false;
      releaseSyncLock();
    }
  }, []);

  // ── Online / offline listeners ───────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOnline = () => {
      setIsOnline(true);
      // Trigger sync once per reconnect
      syncNow();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initialise pending count on mount
    getPendingCount().then(setPendingCount).catch(() => {});

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncNow]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <OfflineStatusContext.Provider
      value={{ isOnline, isSyncing, pendingCount, lastSyncedAt, syncNow }}
    >
      <OfflineBanner
        isOnline={isOnline}
        isSyncing={isSyncing}
        pendingCount={pendingCount}
        onSyncNow={syncNow}
      />
      {children}
    </OfflineStatusContext.Provider>
  );
}
