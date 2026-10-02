"use client";

/* ============================================================================
   Notification bell — shared by the admin console and the agent app
   ----------------------------------------------------------------------------
   Same hook, same dropdown, two feeds:
     bell="admin" → ob_submitted only   (reviewer's OB approvals)
     bell="agent" → ob_approved/ob_declined (the agent's own decisions)

   POLLING, NOT REALTIME
   A 30s poll with a visibility check, rather than a Supabase Realtime
   subscription. Realtime would need the table added to the `supabase_realtime`
   publication (STEP 4 of the migration) and a channel per signed-in user; on a
   phone-sized PWA the poll is a few hundred bytes every 30s and needs no schema
   or RLS work. The poll stops while the tab is hidden, so a backgrounded app
   costs nothing, and it refetches immediately when the tab comes back.

   When the table IS published, swap `poll()` for a channel subscription — the
   `applyItems`/`setUnread` shape below is already what that would call.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";

export type NotificationType = "ob_approved" | "ob_declined" | "ob_submitted" | "gps_reviewed";

export type AppNotification = {
  id: number | string;
  ReferenceID: string;
  type: NotificationType;
  title: string;
  message: string | null;
  link_url: string | null;
  thumb_url: string | null;
  meta: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
};

const POLL_MS = 30_000;

export function useNotifications(bell: "admin" | "agent") {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Badge-only fetch. Cheap enough to run on every tick. */
  const pollCount = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?bell=${bell}&count=1`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok || !mounted.current) return;
      const json = await res.json();
      setUnread(Number(json?.unread) || 0);
    } catch {
      /* the badge is cosmetic — never surface a poll failure */
    }
  }, [bell]);

  /** Full fetch, used when the dropdown opens. */
  const pollAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/notifications?bell=${bell}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok || !mounted.current) return;
      const json = await res.json();
      const next: AppNotification[] = Array.isArray(json?.items) ? json.items : [];
      setItems(next);
      setUnread(Number(json?.unread) || 0);
    } catch {
      /* leave the last known list on screen */
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [bell]);

  /* ── Schedule ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    pollCount();

    const tick = () => {
      // Skip while hidden; the visibility handler catches up on return.
      if (typeof document !== "undefined" && document.hidden) return;
      if (open) return; // an open dropdown refreshes itself
      pollCount();
    };

    const timer = setInterval(tick, POLL_MS);

    const onVisible = () => {
      if (!document.hidden) {
        pollCount();
        if (open) pollAll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollCount, pollAll, open]);

  /* ── Open / close ─────────────────────────────────────────────────────── */

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) pollAll();
      return !o;
    });
  }, [pollAll]);

  const close = useCallback(() => setOpen(false), []);

  /* ── Mark read ────────────────────────────────────────────────────────── */

  const markRead = useCallback(async (id: number | string) => {
    // Optimistic: the row greys out immediately rather than waiting on a
    // round trip, and the server call is fire-and-forget.
    setItems((prev) => prev.map((n) => (String(n.id) === String(id) ? { ...n, is_read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));

    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id }),
      });
    } catch {
      // Roll the optimistic update back so the badge doesn't lie on failure.
      pollCount();
    }
  }, [pollCount]);

  const markAllRead = useCallback(async () => {
    const snapshot = items;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);

    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
    } catch {
      setItems(snapshot);
      pollCount();
    }
  }, [items, pollCount]);

  return { items, unread, open, loading, toggle, close, markRead, markAllRead, refresh: pollAll };
}

/** "2m ago" / "Yesterday" — enough resolution for a notification list. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/** Which visual treatment a notification gets. */
export function notifTone(type: NotificationType) {
  switch (type) {
    case "ob_approved":
    case "gps_reviewed":
      return { fg: "var(--mint-strong)", bg: "var(--mint-soft)", dot: "var(--mint)" };
    case "ob_declined":
      return { fg: "var(--alert-ink)", bg: "var(--alert-soft)", dot: "var(--alert)" };
    case "ob_submitted":
      return { fg: "var(--hint-text)", bg: "var(--hint-bg)", dot: "#f59e0b" };
    default:
      return { fg: "var(--text-muted)", bg: "var(--bg)", dot: "var(--text-faint)" };
  }
}