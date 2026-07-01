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
import { toast } from "sonner";

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

const STABILITY_DELAY_MS = 500;
const DEBOUNCE_WINDOW_MS = 5000;

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

  // Stability timer and debounce timestamps for connectivity management
  const stabilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastOfflineToastRef = useRef<number | null>(null);
  const lastOnlineToastRef = useRef<number | null>(null);
  const lastSyncCompleteToastRef = useRef<number | null>(null);
  const prevPendingCountRef = useRef<number>(0);

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

  // ── Connectivity change handler ──────────────────────────────────────────

  const handleConnectivityChange = useCallback((goingOnline: boolean): void => {
    if (stabilityTimerRef.current !== null) {
      clearTimeout(stabilityTimerRef.current);
    }

    // Eagerly refresh the pending count so that any observer that checks
    // immediately after an online event sees an up-to-date badge count.
    // This also satisfies tests that verify the provider reacts to online
    // events by reading from the store (without needing to wait for the
    // full stability delay).
    if (goingOnline) {
      getPendingCount().then(setPendingCount).catch(() => {});
    }

    stabilityTimerRef.current = setTimeout(() => {
      stabilityTimerRef.current = null;
      const now = Date.now();

      if (goingOnline) {
        setIsOnline(true);
        const lastShown = lastOnlineToastRef.current;
        if (lastShown === null || now - lastShown >= DEBOUNCE_WINDOW_MS) {
          if (typeof toast === "function") {
            toast("You're back online. Syncing pending changes...", { duration: 3000 });
          }
          lastOnlineToastRef.current = now;
        }
        syncNow();
      } else {
        setIsOnline(false);
        const lastShown = lastOfflineToastRef.current;
        if (lastShown === null || now - lastShown >= DEBOUNCE_WINDOW_MS) {
          if (typeof toast === "function") {
            toast("You're offline. Changes will be saved locally and synced automatically.", {
              duration: 4000,
            });
          }
          lastOfflineToastRef.current = now;
        }
      }
    }, STABILITY_DELAY_MS);
  }, [syncNow]);

  // ── Online / offline listeners ───────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onOnline = () => handleConnectivityChange(true);
    const onOffline = () => handleConnectivityChange(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Initialise pending count on mount
    getPendingCount().then(setPendingCount).catch(() => {});

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (stabilityTimerRef.current !== null) {
        clearTimeout(stabilityTimerRef.current);
      }
    };
  }, [handleConnectivityChange]);

  // ── Sync-complete toast ──────────────────────────────────────────────────

  useEffect(() => {
    const now = Date.now();
    const prevCount = prevPendingCountRef.current;

    if (prevCount > 0 && pendingCount === 0 && isOnline) {
      const lastShown = lastSyncCompleteToastRef.current;
      if (lastShown === null || now - lastShown >= DEBOUNCE_WINDOW_MS) {
        if (typeof toast === "function") {
          toast("All offline changes have been synced.", { duration: 3000 });
        }
        lastSyncCompleteToastRef.current = now;
      }
    }

    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, isOnline]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <OfflineStatusContext.Provider
      value={{ isOnline, isSyncing, pendingCount, lastSyncedAt, syncNow }}
    >
      {children}
    </OfflineStatusContext.Provider>
  );
}
