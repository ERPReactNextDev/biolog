"use client";

/* ============================================================================
   Notification bell
   ----------------------------------------------------------------------------
   Dropdown list of the caller's notifications, in the Calm Mint language.

   Props adapt it to the two callers:
     bell="admin" → the reviewer's OB approvals, items link to /admin/ob-approvals
     bell="agent" → the agent's own decisions, items link to their OB Request page

   Rendered inline rather than portalled: the admin top bar and the agent header
   are both sticky, so an absolutely-positioned panel anchored to the button is
   correct and avoids the focus-trap/focus-loss problem a Radix popover brings
   to a page that also has its own sheet and drawer layers.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Bell, CheckCheck, CheckCircle2, Flag, Inbox, X } from "lucide-react";
import {
  notifTone,
  relativeTime,
  useNotifications,
  type NotificationType,
} from "./use-notifications";

const ICON: Record<NotificationType, typeof Bell> = {
  ob_approved: CheckCircle2,
  ob_declined: X,
  ob_submitted: Flag,
  gps_reviewed: CheckCircle2,
};

export default function NotificationBell({
  bell,
  agentUserId,
  tone = "surface",
  size = 20,
}: {
  bell: "admin" | "agent";
  /** Appended to /ob-request so the agent lands on their own list. */
  agentUserId?: string | null;
  tone?: "surface" | "plain";
  size?: number;
}) {
  const router = useRouter();
  const { items, unread, open, loading, toggle, close, markRead, markAllRead } =
    useNotifications(bell);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /* Click-away and Escape.
     The panel is portaled to <body>, so it is NOT inside wrapRef — containment
     has to be tested against both nodes or every press reads as "outside" and
     the dropdown closes the instant you click an item. */
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  /* ── Placement ─────────────────────────────────────────────────────────
     THE PANEL IS PORTALED TO <body> AND POSITIONED `fixed`, and both are
     load-bearing:

       overflow-hidden — the agent home header (app/activity-planner/mint/home.tsx)
       carries `overflow-hidden` for its decorative gradient circles. The bell
       lives inside that header, so an absolutely-positioned dropdown is a
       descendant of a clipping box and gets cut off. No width or flip logic can
       fix that; only leaving the ancestor does. (This is why an earlier
       "clamp the width to the viewport" attempt changed nothing.)

       fixed — the panel's coordinates are measured from the trigger's viewport
       rect, so it must be positioned against the viewport too. Anchoring it to
       a relative wrapper inside a transformed/filtered ancestor would compute
       offsets from the wrong box.

     On open we measure the trigger and clamp the panel inside the viewport,
     flipping to the trigger's left when the right edge has no room. */
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const margin = 8;
    const gap = 8;

    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Width first, then place it so it never crosses either edge.
    const width = Math.min(360, Math.max(240, vw - margin * 2));

    let left = rect.right - width; // right-aligned to the bell by default
    if (left < margin) left = rect.left; // flip to the bell's left edge
    if (left + width > vw - margin) left = Math.max(margin, vw - margin - width);

    // Flip ABOVE the trigger if there is no room below — the bell sits high in
    // the agent header, so this is the common case on a short viewport.
    const panelH = 420; // generous upper bound; the list itself scrolls
    let top = rect.bottom + gap;
    if (top + panelH > vh - margin) {
      const above = rect.top - gap;
      top = above > margin ? Math.max(margin, above - panelH) : Math.max(margin, rect.bottom + gap);
    }

    setPos({ left: Math.round(left), top: Math.round(top), width: Math.round(width) });
  }, []);

  // Measure when it opens, and keep it honest as the viewport changes.
  useEffect(() => {
    if (!open) return;
    updatePosition();

    const onScroll = () => updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("orientationchange", updatePosition);
    // The shells scroll their bodies independently, so a scroll anywhere can
    // move the bell out from under a fixed panel.
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("orientationchange", updatePosition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePosition]);

  const openItem = async (id: number | string, link: string | null) => {
    await markRead(id);
    close();
    if (link) router.push(link);
  };

  const openAll = async () => {
    await markAllRead();
    close();
    router.push(bell === "admin" ? "/admin/ob-approvals" : agentUserId ? `/ob-request?id=${encodeURIComponent(agentUserId)}` : "/ob-request");
  };

  return (
    // Wrapper only anchors the trigger; the panel is portaled out of it.
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={
          unread > 0
            ? `Notifications, ${unread} unread`
            : "Notifications, none unread"
        }
        aria-expanded={open}
        className={
          tone === "surface"
            ? "w-11 h-11 rounded-[14px] flex items-center justify-center transition-colors border bg-[var(--bg)]"
            : "w-10 h-10 rounded-[12px] flex items-center justify-center transition-colors"
        }
        style={
          tone === "surface"
            ? { borderColor: "var(--border)", color: "var(--text-muted)" }
            : { background: "var(--card)", border: "1px solid var(--border)", color: "var(--mint-strong)" }
        }
      >
        <Bell size={size} />

        {unread > 0 && (
          <span
            className="absolute top-1.5 right-1.5 min-w-[17px] h-[17px] px-1 rounded-full flex items-center justify-center text-[10px] font-black text-white pointer-events-none"
            style={{ background: "var(--alert)", boxShadow: "0 0 0 2px var(--card)" }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Portal + fixed: escapes the agent header's overflow-hidden, which was
          clipping the panel no matter how it was anchored. */}
      {mounted &&
        open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[80] overflow-hidden rounded-[var(--r-card-lg)] border shadow-[var(--sh-card-lg)]"
            style={{
              background: "var(--card)",
              borderColor: "var(--border-strong)",
              left: pos.left,
              top: pos.top,
              width: pos.width,
            }}
            role="dialog"
            aria-label="Notifications"
          >
          {/* Head */}
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <p className="text-[13px] font-extrabold text-[var(--text)]">Notifications</p>
            {unread > 0 && (
              <span
                className="text-[11px] font-extrabold px-2 py-0.5 rounded-full"
                style={{ background: "var(--alert-soft)", color: "var(--alert-ink)" }}
              >
                {unread} new
              </span>
            )}
          </div>

          {/* List */}
          {/* Capped so a long backlog can never push the whole page down, and
              overscroll-contained so scrolling the list doesn't chain to the
              page behind it on mobile. */}
          <div className="max-h-[min(60vh,360px)] overflow-y-auto overscroll-contain mint-scroll">
            {loading && items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[12px] font-semibold text-[var(--text-muted)]">Loading…</p>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center text-center px-5 py-8">
                <div
                  className="w-11 h-11 rounded-[14px] flex items-center justify-center mb-2.5"
                  style={{ background: "var(--mint-soft)", color: "var(--mint)" }}
                >
                  <Inbox size={20} />
                </div>
                <p className="text-[12.5px] font-extrabold text-[var(--text)]">All caught up</p>
                <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-1 leading-snug">
                  {bell === "admin"
                    ? "New OB requests will show up here for approval."
                    : "Your OB request decisions will show up here."}
                </p>
              </div>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                {items.map((n) => {
                  const t = notifTone(n.type);
                  const Icon = ICON[n.type] || Bell;
                  const href =
                    n.link_url === "/ob-request" && agentUserId
                      ? `/ob-request?id=${encodeURIComponent(agentUserId)}`
                      : n.link_url;

                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n.id, href)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--mint-soft)]"
                        style={{
                          background: n.is_read ? undefined : "var(--mint-soft)",
                        }}
                      >
                        {/* Thumbnail for OB submissions, icon otherwise */}
                        {n.thumb_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={n.thumb_url}
                            alt=""
                            className="w-9 h-9 rounded-[10px] object-cover shrink-0"
                            style={{ border: "1px solid var(--border)" }}
                          />
                        ) : (
                          <span
                            className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
                            style={{ background: t.bg, color: t.fg }}
                          >
                            <Icon size={16} strokeWidth={2.5} />
                          </span>
                        )}

                        <span className="flex-1 min-w-0">
                          <span className="flex items-center gap-2">
                            {/* Single line: a two-line title made every row a
                                different height and the list looked ragged. */}
                            <span
                              className="flex-1 min-w-0 text-[12.5px] font-extrabold leading-tight truncate"
                              style={{ color: n.is_read ? "var(--text-muted)" : "var(--text)" }}
                              title={n.title}
                            >
                              {n.title}
                            </span>
                            {!n.is_read && (
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ background: t.dot }}
                                aria-label="Unread"
                              />
                            )}
                          </span>

                          {n.message && (
                            <span className="block text-[11px] font-semibold text-[var(--text-muted)] mt-0.5 truncate leading-snug">
                              {n.message}
                            </span>
                          )}

                          <span className="flex items-center gap-1.5 mt-1.5">
                            <span
                              className="text-[9.5px] font-extrabold px-1.5 py-[3px] rounded-full leading-none"
                              style={{ background: t.bg, color: t.fg }}
                            >
                              {n.type === "ob_submitted"
                                ? "For approval"
                                : n.type === "ob_approved"
                                  ? "Approved"
                                  : "Declined"}
                            </span>
                            <span className="text-[10px] font-bold text-[var(--text-faint)] truncate">
                              {relativeTime(n.created_at)}
                            </span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Foot */}
          {items.length > 0 && (
            <div
              className="flex items-center justify-between gap-2 px-3 py-2.5"
              style={{ borderTop: "1px solid var(--border)", background: "var(--bg)" }}
            >
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-[11.5px] font-extrabold px-2 py-1.5 rounded-[10px] flex items-center gap-1.5"
                  style={{ color: "var(--mint-strong)" }}
                >
                  <CheckCheck size={13} />
                  Mark all as read
                </button>
              ) : (
                <span />
              )}

              <button
                type="button"
                onClick={openAll}
                className="text-[11.5px] font-extrabold px-2 py-1.5 rounded-[10px]"
                style={{ color: "var(--mint-strong)" }}
              >
                View all
              </button>
            </div>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}