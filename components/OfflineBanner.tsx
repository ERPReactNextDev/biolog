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

/* Mint tones: green = synced, blue = syncing, orange = queued, clay = offline */

interface Props {
  isOnline:     boolean;
  isSyncing:    boolean;
  pendingCount: number;
  onSyncNow?:   () => void; // Optional manual sync trigger
}

export default function OfflineBanner({ isOnline, isSyncing, pendingCount, onSyncNow }: Props) {
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

  const bar =
    "fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 py-2.5 px-4 text-[12px] font-extrabold";

  // ── Sync done flash ──────────────────────────────────────────────────────
  if (showSyncDone) {
    return (
      <div className={bar} style={{ background: "var(--mint-btn)", color: "white" }} role="status">
        <CheckCircle2 size={14} />
        All records synced successfully
      </div>
    );
  }

  // ── Syncing ──────────────────────────────────────────────────────────────
  if (isSyncing) {
    return (
      <div
        className={bar}
        style={{ background: "var(--info)", color: "white" }}
        role="status"
        aria-live="polite"
      >
        <RefreshCw size={14} className="animate-spin" />
        Syncing {pendingCount} record{pendingCount !== 1 ? "s" : ""}…
      </div>
    );
  }

  // ── Online + pending logs (queued but not yet syncing) ───────────────────
  if (isOnline && pendingCount > 0) {
    return (
      <div
        className={bar}
        style={{ background: "var(--clay-ink)", color: "white" }}
        role="status"
        aria-live="polite"
      >
        <RefreshCw size={14} />
        <span>
          {pendingCount} record{pendingCount !== 1 ? "s" : ""} ready to upload
        </span>
        {onSyncNow && (
          <button
            onClick={onSyncNow}
            className="ml-1 min-h-[32px] px-3 rounded-full text-[11px] font-extrabold transition-opacity hover:opacity-90"
            style={{ background: "rgba(255,255,255,.22)" }}
          >
            Sync now
          </button>
        )}
      </div>
    );
  }

  // ── Offline ──────────────────────────────────────────────────────────────
  return (
    <div
      className={bar}
      style={{ background: "var(--clay-soft)", color: "var(--clay-ink)" }}
      role="status"
      aria-live="polite"
    >
      <WifiOff size={14} />
      You&apos;re offline — entries save to this phone
      {pendingCount > 0 && (
        <span
          className="ml-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold"
          style={{ background: "var(--card)" }}
        >
          {pendingCount} pending
        </span>
      )}
    </div>
  );
}