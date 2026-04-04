"use client";

/**
 * OfflineBanner.tsx
 *
 * Shows a small banner at the top of the screen when:
 *  - User is offline (with pending count)
 *  - Sync is in progress
 *  - Sync just completed
 *
 * Drop this inside your main layout or ActivityPage.
 *
 * Usage:
 *   <OfflineBanner isOnline={isOnline} isSyncing={isSyncing} pendingCount={pendingCount} />
 */

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CheckCircle2 } from "lucide-react";

interface Props {
  isOnline:     boolean;
  isSyncing:    boolean;
  pendingCount: number;
}

export default function OfflineBanner({ isOnline, isSyncing, pendingCount }: Props) {
  const [showSyncDone, setShowSyncDone] = useState(false);
  const prevSyncingRef = typeof window !== "undefined"
    ? (window as any).__prevSyncing as boolean | undefined
    : undefined;

  // Show "Synced!" flash for 2s when sync completes
  useEffect(() => {
    if (typeof window !== "undefined") {
      const prev = (window as any).__prevSyncing as boolean | undefined;
      if (prev === true && isSyncing === false && isOnline && pendingCount === 0) {
        setShowSyncDone(true);
        const t = setTimeout(() => setShowSyncDone(false), 2500);
        return () => clearTimeout(t);
      }
      (window as any).__prevSyncing = isSyncing;
    }
  }, [isSyncing, isOnline, pendingCount]);

  // Nothing to show — all good and online
  if (isOnline && !isSyncing && !showSyncDone && pendingCount === 0) return null;

  // ── Sync done flash ──────────────────────────────────────────────────────
  if (showSyncDone) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-[#1A7A4A] text-white py-2 px-4 text-[12px] font-semibold animate-pulse">
        <CheckCircle2 size={13} />
        All records synced successfully
      </div>
    );
  }

  // ── Syncing ──────────────────────────────────────────────────────────────
  if (isSyncing) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-[#185FA5] text-white py-2 px-4 text-[12px] font-semibold">
        <RefreshCw size={13} className="animate-spin" />
        Syncing {pendingCount} record{pendingCount !== 1 ? "s" : ""}…
      </div>
    );
  }

  // ── Online + pending logs (queued but not yet syncing) ───────────────────
  if (isOnline && pendingCount > 0) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-[#A0611A] text-white py-2 px-4 text-[12px] font-semibold">
        <RefreshCw size={13} />
        Uploading {pendingCount} queued record{pendingCount !== 1 ? "s" : ""}…
      </div>
    );
  }

  // ── Offline ──────────────────────────────────────────────────────────────
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-brand-primary text-white py-2 px-4 text-[12px] font-semibold">
      <WifiOff size={13} />
      You are offline
      {pendingCount > 0 && (
        <span className="ml-1 bg-white/20 rounded-full px-2 py-0.5 text-[11px]">
          {pendingCount} pending
        </span>
      )}
    </div>
  );
}