"use client";

/* ============================================================================
   Admin shell — dark-green sidebar, top bar, mobile bottom nav
   ----------------------------------------------------------------------------
   Sidebar is #0F3D2E per the spec. The rest of the console reuses the Calm Mint
   tokens (--mint-btn, --card, --border…) so the admin area matches the app.

   The nav only shows Users / Approvals to a session that can actually use
   them; /api/admin/* re-checks regardless, so hiding a link here is
   convenience, not the boundary.
   ========================================================================== */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Book,
  CalendarRange,
  DatabaseBackup,
  FlaskConical,
  KeyRound,
  Building2,
  LayoutDashboard,
  LogOut,
  Mail,
  MapPinned,
  MessageSquare,
  PlaneTakeoff,
  Search,
  Settings,
  ShieldCheck,
  Users as UsersIcon,
  ClipboardCheck,
} from "lucide-react";
import NotificationBell from "@/components/notifications/notification-bell";

/* ── Tokens ─────────────────────────────────────────────────────────────── */

const SIDEBAR_BG = "#0F3D2E";

type NavIcon = React.ComponentType<{
  size?: number | string;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}>;

type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  badge?: number;
  badgeTone?: "mint" | "amber";
  /** Requires a permission; omitted means everyone signed in. */
  requires?: "users" | "approvals";
  /**
   * Super Admin only, and NOT overridable by a permission flag.
   *
   * Separate from `requires` on purpose: that one means "hide unless the flag
   * says yes", which is right for a feature an admin may delegate. This one
   * means "third-party PII — nobody below Super Admin gets this door", which a
   * flag must never be able to open. See requireSuperAdmin() in lib/rbac.ts.
   */
  superAdminOnly?: boolean;
};

type NavGroup = { heading: string; items: NavItem[] };

type AdminState = {
  email: string;
  name: string;
  role: string;
  canManageUsers: boolean;
  canReviewGps: boolean;
  /** Team-wide visibility — gates Site Visits, Reports and Timesheet. */
  canViewAll: boolean;
  /**
   * Taken from /api/admin/session's own `isSuperAdmin`, NOT recomputed from the
   * role string here. The column is hand-edited and carries both "Super Admin"
   * and "SuperAdmin", so duplicating the normalisation in the client is how the
   * two drift apart. One authority, read once.
   */
  isSuperAdmin: boolean;
};

/* ── Sidebar ────────────────────────────────────────────────────────────── */

function Sidebar({
  groups,
  onNavigate,
  onSignOut,
}: {
  groups: NavGroup[];
  onNavigate?: () => void;
  /** Opens the confirm step in the parent, which owns the actual sign-out. */
  onSignOut: () => void;
}) {
  const pathname = usePathname() || "";

  return (
    <aside
      className="hidden md:flex flex-col w-[248px] shrink-0 rounded-l-[22px] overflow-hidden"
      style={{ background: SIDEBAR_BG }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div
          className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
          style={{ background: "var(--mint)" }}
        >
          <svg width="19" height="19" viewBox="0 0 18 18" fill="none" aria-hidden>
            <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
            <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
            <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
          </svg>
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-black tracking-[0.12em] text-white leading-tight">BIOLOG</p>
          <p className="text-[10.5px] font-bold text-white/55 leading-tight">Admin Console</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
        {groups.map((group, gi) => (
          <div key={group.heading} className={gi === 0 ? "" : "mt-5"}>
            <p className="px-3 pb-1.5 pt-2 text-[9.5px] font-black uppercase tracking-[0.16em] text-white/35">
              {group.heading}
            </p>
            {group.items.map((item) => {
              const active =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className="flex items-center gap-3 min-h-[46px] px-3 rounded-[13px] text-[13.5px] font-bold transition-colors"
                  style={{
                    background: active ? "var(--mint)" : "transparent",
                    color: active ? "#fff" : "rgba(255,255,255,0.72)",
                  }}
                >
                  <Icon size={18} strokeWidth={active ? 2.4 : 2} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {typeof item.badge === "number" && item.badge > 0 && (
                    <span
                      className="shrink-0 min-w-[22px] h-[20px] px-1.5 rounded-full flex items-center justify-center text-[11px] font-black"
                      style={{
                        background: item.badgeTone === "amber" ? "#F59E0B" : "rgba(255,255,255,0.22)",
                        color: item.badgeTone === "amber" ? "#3B2600" : "#fff",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Tables touched — useful for an IT admin */}
      <div
        className="m-3 p-3 rounded-[14px]"
        style={{ background: "rgba(255,255,255,0.07)" }}
      >
        <p className="flex items-center gap-1.5 text-[11px] font-extrabold text-white/60 mb-1.5">
          <ShieldCheck size={12} /> Tables
        </p>
        {["public.users", "public.gps_reports"].map((t) => (
          <p key={t} className="text-[11px] font-semibold text-white/80 leading-relaxed">
            {t}
          </p>
        ))}
      </div>

      {/* Sign out — desktop. See signOut() above for why this lives here at
          all. Deliberately not a dropdown: the agent app uses a confirm step
          because an agent can have unsynced records, and a console admin has
          none. One click is the whole interaction. */}
      <div className="px-3 pb-4 shrink-0">
        <button
          type="button"
          onClick={onSignOut}
          className="w-full flex items-center gap-3 min-h-[44px] px-3 rounded-[13px] text-[13.5px] font-bold transition-colors"
          style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.82)" }}
        >
          <LogOut size={17} strokeWidth={2.2} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}

/* ── Shell ──────────────────────────────────────────────────────────────── */

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AdminState | null>(null);
  const [counts, setCounts] = useState({ users: 0, pending: 0, obPending: 0 });
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  /* ── Sign out ────────────────────────────────────────────────────────────
     THE ADMIN CONSOLE HAD NO WAY TO SIGN OUT AT ALL. Not a Super Admin
     quirk and not a role gate: no page under /admin ever rendered a logout
     control, and git shows this file has never had one. An admin who signed
     in to fix something had to clear cookies by hand or log out on the agent
     app first. The agent app's equivalent lives in the Profile tab
     (mint/profile.tsx) and calls the same three steps, so the two are kept
     identical on purpose.

     The offline session must go too, and BEFORE the API call: it holds the
     cached user details that /Login would otherwise read back, which is how
     an admin could appear still signed in after "signing out". */
  const signOut = useCallback(async () => {
    setConfirmSignOut(false);
    try {
      const { clearOfflineSession } = await import("@/lib/offline-auth");
      await clearOfflineSession();
    } catch {
      /* silent — the server call below is the real one */
    }
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } catch {
      /* offline — local session is already cleared */
    }
    localStorage.removeItem("userId");
    router.replace("/Login");
  }, [router]);

  // Who am I, and what may I open?
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/check-session", { credentials: "include", cache: "no-store" });
        if (!res.ok) {
          router.replace("/Login");
          return;
        }
        const data = await res.json().catch(() => ({}));

        /* check-session is the cheapest probe but its shape is not guaranteed —
           it has returned the user both at the root and nested under `user`.
           /api/admin/session is the one route that normalises this AND answers
           isSuperAdmin with the server's own predicate, so prefer it whenever
           anything is missing. The optimistic branch below cannot know the role,
           which is why isSuperAdmin stays false there. */
        let role = data?.role || data?.Role || "";
        let email = data?.email || data?.Email || "";
        let name = data?.name || "";

        const probe = await fetch("/api/admin/session", {
          credentials: "include",
          cache: "no-store",
        });

        if (probe.ok) {
          const p = await probe.json();
          if (cancelled) return;
          setState({
            email: p.email || email || "",
            name: p.name || name || p.email || email || "",
            role: p.role || role,
            canManageUsers: Boolean(p.canManageUsers),
            canReviewGps: Boolean(p.canReviewGps),
            canViewAll: Boolean(p.canViewAll),
            isSuperAdmin: p.isSuperAdmin === true,
          });
          return;
        }

        if (!cancelled) {
          setState({
            email,
            name: name || email,
            role,
            /* Optimistic: the API is the real gate for everything except the
               Super Admin item, which must never be guessed open. Withholding
               it hides a tab the server would refuse anyway. */
            canManageUsers: true,
            canReviewGps: true,
            canViewAll: true,
            isSuperAdmin: false,
          });
        }
      } catch {
        router.replace("/Login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  /* Escape closes the confirm dialog. Without this it can only be dismissed by
     clicking "Stay" or the backdrop, which traps a keyboard user on a page
     they cannot leave. */
  useEffect(() => {
    if (!confirmSignOut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmSignOut(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmSignOut]);

  // Badge counts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [u, a, ob] = await Promise.all([
          fetch("/api/admin/users", { credentials: "include", cache: "no-store" }),
          fetch("/api/admin/approvals?filter=all", { credentials: "include", cache: "no-store" }),
          fetch("/api/ob-request?scope=queue&filter=pending", { credentials: "include", cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (u.ok) {
          const list = await u.json();
          if (Array.isArray(list)) setCounts((c) => ({ ...c, users: list.length }));
        }
        if (a.ok) {
          const j = await a.json();
          if (j?.counts) setCounts((c) => ({ ...c, pending: j.counts.pending || 0 }));
        }
        // A 403 here just means this role can't review OB — the tab itself
        // surfaces the message, so a missing badge is not worth an error.
        if (ob.ok) {
          const j = await ob.json();
          if (j?.counts) setCounts((c) => ({ ...c, obPending: j.counts.pending || 0 }));
        }
      } catch {
        /* badges are cosmetic */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Nav is intentionally NOT gated on client-side permission state.
   These tabs used to be hidden behind `state?.canViewAll`, which silently
   dropped them whenever the session probe was slow, failed, or returned the
   user nested under `user` (check-session does exactly that) — a missing tab
   with no explanation. Hiding a link is not access control anyway: every
   /api/admin/* route re-checks server-side and these pages surface a clear
   403 message when the role genuinely lacks permission.

   THE ONE EXCEPTION IS "Web Inquiries". It is hidden from non-Super-Admins
   because it holds third-party PII: there is no operational reason for a
   delegated Admin to read a stranger's message, and a tab they can always open
   and always be refused from is worse than no tab at all. The route is still
   gated by requireSuperAdmin() server-side — this only avoids the dead end.

   Two groups per the spec: Management (day-to-day) and Advanced (platform). */
/* Nav is built from state, so it must recompute when the session probe
     resolves. Before it does, the single Super-Admin-only item is withheld
     rather than flashed and then removed — the same reason the state starts
     null instead of pre-filled with an optimistic role. */
  const navGroups: NavGroup[] = useMemo(() => {
    const advanced: NavItem[] = [
      { href: "/admin/api-keys", label: "API Credentials", icon: KeyRound },
      { href: "/admin/api-keys/tester", label: "API Tester", icon: FlaskConical },
      { href: "/admin/backup", label: "Backup & Restore", icon: DatabaseBackup },
      { href: "/admin/companies", label: "Companies", icon: Building2 },
      { href: "/admin/settings", label: "Settings", icon: Settings },
      { href: "/admin/email-config", label: "Email Config", icon: Mail },
      // Super Admin only — see the note above. `state` is null on the first
      // render, so the item is withheld until /api/admin/session has actually
      // told us who this is. Never guessed open.
      ...(state?.isSuperAdmin
        ? [
            {
              href: "/admin/website-inquiries",
              label: "Web Inquiries",
              icon: MessageSquare,
              superAdminOnly: true,
            } as NavItem,
          ]
        : []),
      { href: "/admin/documentation", label: "Documentation", icon: Book },
    ];

    return [
      {
        heading: "Management",
        items: [
          { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
          { href: "/admin/users", label: "Users", icon: UsersIcon, badge: counts.users },
          {
            href: "/admin/approvals",
            label: "Approvals",
            icon: ClipboardCheck,
            badge: counts.pending,
            badgeTone: "amber",
          },
          { href: "/admin/site-visits", label: "Site Visits", icon: MapPinned },
          {
            href: "/admin/ob-approvals",
            label: "OB Approvals",
            icon: PlaneTakeoff,
            badge: counts.obPending,
            badgeTone: "amber",
          },
          { href: "/admin/reports", label: "Reports", icon: BarChart3 },
          { href: "/admin/timesheet", label: "Timesheet", icon: CalendarRange },
        ],
      },
      { heading: "Advanced", items: advanced },
    ];
  }, [state?.isSuperAdmin, counts.users, counts.pending, counts.obPending]);

  return (
    <div className="mint-ui mint-scope flex min-h-svh" style={{ background: "var(--bg)" }}>
      <Sidebar groups={navGroups} onSignOut={() => setConfirmSignOut(true)} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header
          className="flex items-center gap-3 px-4 md:px-6 py-3.5 border-b bg-[var(--card)] shrink-0"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="md:hidden flex items-center gap-2 shrink-0">
            <div
              className="w-9 h-9 rounded-[12px] flex items-center justify-center"
              style={{ background: SIDEBAR_BG }}
            >
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden>
                <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
                <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
                <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
              </svg>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <label className="flex items-center gap-2.5 h-11 px-3.5 rounded-[var(--r-btn)] border bg-[var(--bg)] max-w-md">
              <Search size={16} style={{ color: "var(--text-faint)" }} className="shrink-0" />
              <input
                type="search"
                placeholder="Search name, email, ReferenceID…"
                className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-semibold"
                style={{ color: "var(--text)" }}
              />
            </label>
          </div>

          {/* OB approvals only, per spec. `unread` comes from the notifications
              table, not from counts.pending — a reviewer can have pending work
              they have already seen, which is not an unread notification. */}
          <NotificationBell bell="admin" size={18} />

          <div className="hidden sm:flex items-center gap-2.5 shrink-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-black text-white"
              style={{ background: "var(--mint-btn)" }}
            >
              {initials(state?.name)}
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] font-extrabold truncate">{state?.name || "—"}</p>
              <p
                className="text-[10px] font-black tracking-[0.1em]"
                style={{ color: "var(--mint-strong)" }}
              >
                {(state?.role || "ADMIN").toUpperCase()}
              </p>
            </div>

            {/* Sign out — also here, not only in the sidebar. The sidebar is
                hidden below md, and the bottom bar is crowded with 13 nav
                items, so on a phone this was the one reachable control. */}
            <button
              type="button"
              onClick={() => setConfirmSignOut(true)}
              aria-label="Sign out"
              title="Sign out"
              className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 transition-colors"
              style={{ background: "var(--bg)", color: "var(--alert-ink)" }}
            >
              <LogOut size={17} strokeWidth={2.2} />
            </button>
          </div>
        </header>

        {/* Confirm step. Only shown after an explicit click, and dismissed by
            clicking away or pressing Escape — a confirmation dialog that can
            be escaped is not a trap. */}
        {confirmSignOut && (
          <>
            <button
              type="button"
              aria-label="Cancel sign out"
              onClick={() => setConfirmSignOut(false)}
              className="fixed inset-0 z-40"
              style={{ background: "rgba(15,23,42,0.45)", cursor: "default" }}
            />
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="signout-title"
              className="fixed left-1/2 top-1/2 z-50 w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 p-5"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-card-lg)",
                boxShadow: "var(--sh-card-lg)",
              }}
            >
              <p
                id="signout-title"
                className="text-[15px] font-extrabold text-[var(--text)] mb-1.5"
              >
                Sign out of the admin console?
              </p>
              <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mb-4 leading-relaxed">
                Any unsaved edits on this page will be lost.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmSignOut(false)}
                  className="min-h-[42px] px-4 rounded-[var(--r-btn)] text-[13px] font-extrabold"
                  style={{ background: "var(--bg)", color: "var(--text-muted)" }}
                >
                  Stay
                </button>
                <button
                  type="button"
                  onClick={signOut}
                  autoFocus
                  className="min-h-[42px] px-4 rounded-[var(--r-btn)] text-[13px] font-extrabold text-white"
                  style={{ background: "var(--alert)" }}
                >
                  Sign out
                </button>
              </div>
            </div>
          </>
        )}

        {/* Content */}
        <main className="flex-1 overflow-y-auto mint-scroll px-4 md:px-6 py-5 pb-24 md:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t bg-[var(--card)]"
        style={{ borderColor: "var(--border)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {navGroups.flatMap((g) => g.items).map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 flex flex-col items-center justify-center gap-1 min-h-[58px] relative"
            >
              <span className="relative">
                <Icon size={19} style={{ color: "var(--mint-strong)" }} />
                {typeof item.badge === "number" && item.badge > 0 && (
                  <span
                    className="absolute -top-1 -right-2 min-w-[16px] h-[16px] px-1 rounded-full flex items-center justify-center text-[10px] font-black"
                    style={{
                      background: item.badgeTone === "amber" ? "#F59E0B" : "var(--alert)",
                      color: item.badgeTone === "amber" ? "#3B2600" : "#fff",
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-extrabold text-[var(--text-muted)]">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function initials(name?: string): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}