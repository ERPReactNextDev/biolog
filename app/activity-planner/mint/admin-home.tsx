"use client";

/* ============================================================================
   SUPER ADMIN DASHBOARD — "Admin Overview"
   ----------------------------------------------------------------------------
   Compact overview per the approved design: a dated heading, four stat cards,
   and a single "Action needed" banner that only lists things actually wrong.

   Counts are assembled from the three secured admin APIs so nothing here can
   read a record the role isn't entitled to:
     /api/admin/approvals  -> pending count
     /api/admin/users      -> total, new this month, locked accounts
     /api/admin/analytics  -> site visits, avg attendance, absent days
   ========================================================================== */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { Card } from "./ui";
import { LoadingSkeleton, ErrorOverlay } from "./states";

/* ── Session-authoritative admin gate ────────────────────────────────────────
   The first version decided with `isAdminish(userDetails)`, where userDetails
   comes from `/api/user?id=<url param>`. That param is client-controlled, which
   produced two bugs:

     • a Super Admin landing on `?id=83` (a TSA) was demoted to the agent
       screen, and
     • worse, a TSA landing on `?id=82` (the Super Admin) was shown the admin
       dashboard — total user count, pending approvals and GPS report
       locations. That is an information disclosure.

   /api/admin/session is derived from the signed cookie and already enforces
   permissions server-side, so it is the only thing allowed to answer this.  */

export type AdminAuth = { status: "loading" | "yes" | "no"; name?: string; role?: string };

export function useAdminAuth(): AdminAuth {
  const [auth, setAuth] = useState<AdminAuth>({ status: "loading" });

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/session", { credentials: "include", cache: "no-store" });
        // 401/403 both mean "not an admin" — not an error worth surfacing.
        if (!res.ok) {
          if (!dead) setAuth({ status: "no" });
          return;
        }
        const d = await res.json();
        const allowed = Boolean(d.canReviewGps || d.canManageUsers);
        if (dead) return;
        setAuth({
          status: allowed ? "yes" : "no",
          name: d.name || d.email,
          role: d.role || "Admin",
        });
      } catch {
        if (!dead) setAuth({ status: "no" });
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  return auth;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const MAX_ATTEMPTS = 5;

function isLocked(u: { LoginAttempts?: number | null; LockUntil?: string | null }): boolean {
  if ((u.LoginAttempts ?? 0) < MAX_ATTEMPTS) return false;
  if (!u.LockUntil) return true;
  const t = new Date(u.LockUntil).getTime();
  return Number.isNaN(t) ? true : t > Date.now();
}

const monthLabel = (d = new Date()) =>
  d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/* ── Stat card ───────────────────────────────────────────────────────────── */

type StatTone = "mint" | "clay" | "amber" | "info";

const TONE: Record<StatTone, { fg: string }> = {
  mint: { fg: "var(--mint-strong)" },
  clay: { fg: "var(--clay-ink)" },
  amber: { fg: "#B45309" },
  info: { fg: "var(--info)" },
};

function StatCard({
  label,
  value,
  hint,
  tone,
  hintTone = "muted",
  icon,
}: {
  label: string;
  value: string | number;
  hint: string;
  tone: StatTone;
  hintTone?: "muted" | "up" | "down";
  icon?: React.ReactNode;
}) {
  return (
    <Card className="p-4 flex flex-col">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mint-num text-[28px] font-black leading-none mt-2" style={{ color: TONE[tone].fg }}>
        {value}
      </p>
      <p
        className="text-[11px] font-bold mt-2 flex items-center gap-1"
        style={{
          color:
            hintTone === "down"
              ? "var(--alert-ink)"
              : hintTone === "up"
                ? "var(--mint-strong)"
                : "var(--text-muted)",
        }}
      >
        {hintTone === "up" && <ArrowUp size={11} />}
        {hintTone === "down" && <ArrowDown size={11} />}
        {hint}
      </p>
      {icon && <span className="sr-only">{icon}</span>}
    </Card>
  );
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */

type Snapshot = {
  totalUsers: number;
  newThisMonth: number;
  siteVisits: number;
  pending: number;
  avgAttendance: number;
  locked: number;
  absentDays: number;
};

export default function AdminHome({ name, role }: { name?: string; role?: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Manager scope falls back gracefully — a 403 here shouldn't blank the
      // whole dashboard, so each request is allowed to degrade on its own.
      const [aRes, uRes, anRes] = await Promise.all([
        fetch("/api/admin/approvals?filter=all", { credentials: "include", cache: "no-store" }),
        fetch("/api/admin/users", { credentials: "include", cache: "no-store" }),
        fetch("/api/admin/analytics?range=month", { credentials: "include", cache: "no-store" }),
      ]);

      if (aRes.status === 401) {
        window.location.href = "/Login";
        return;
      }
      if (aRes.status === 403) {
        setError("You do not have permission to view the admin overview.");
        return;
      }

      const approvals = aRes.ok ? await aRes.json().catch(() => ({})) : {};
      const users = uRes.ok ? await uRes.json().catch(() => []) : [];
      const analytics = anRes.ok ? await anRes.json().catch(() => ({})) : {};

      const list: any[] = Array.isArray(users) ? users : [];
      const since = startOfMonth().getTime();

      if (!live.current) return;
      setSnap({
        totalUsers: list.length,
        newThisMonth: list.filter((u) => {
          if (!u.createdAt) return false;
          const t = new Date(u.createdAt).getTime();
          return !Number.isNaN(t) && t >= since;
        }).length,
        siteVisits: analytics?.totals?.totalVisits ?? 0,
        pending: approvals?.counts?.pending ?? 0,
        avgAttendance: analytics?.totals?.avgPresent ?? 0,
        locked: list.filter(isLocked).length,
        absentDays: (analytics?.agents || []).reduce(
          (s: number, a: any) => s + (a.absentDays || 0),
          0
        ),
      });
    } catch {
      if (live.current) setError("Network problem. Check your connection.");
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorOverlay message={error} onRetry={load} />;

  const s = snap!;
  const thisMonth = monthLabel();

  /* Only mention a problem that actually exists. */
  const flags: string[] = [];
  if (s.pending > 0) {
    flags.push(`${s.pending} GPS report${s.pending === 1 ? "" : "s"} pending review`);
  }
  if (s.locked > 0) {
    flags.push(
      `${s.locked} user${s.locked === 1 ? "" : "s"} locked out (${MAX_ATTEMPTS} failed attempts)`
    );
  }
  if (s.absentDays > 0) {
    flags.push(`${s.absentDays} absent days in ${thisMonth.split(" ")[0]}`);
  }

  const needsReview = s.avgAttendance < 20;

  return (
    <div>
      {/* Heading */}
      <h1 className="text-[19px] font-black text-[var(--text)] leading-tight mb-4">
        Admin Overview <span className="font-bold text-[var(--text-muted)]">— {thisMonth}</span>
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <StatCard
          label="Total Users"
          value={s.totalUsers}
          tone="mint"
          hint={s.newThisMonth > 0 ? `+${s.newThisMonth} this month` : "Across every role"}
          hintTone={s.newThisMonth > 0 ? "up" : "muted"}
        />
        <StatCard
          label="Site Visits"
          value={s.siteVisits}
          tone="clay"
          hint="this month"
          hintTone="muted"
        />
        <StatCard
          label="Pending Approvals"
          value={s.pending}
          tone="amber"
          hint={s.pending > 0 ? "GPS reports" : "None waiting"}
          hintTone="muted"
        />
        <StatCard
          label="Avg Attendance"
          value={`${s.avgAttendance}%`}
          tone="info"
          hint={needsReview ? "needs review" : "on track"}
          hintTone={needsReview ? "down" : "muted"}
        />
      </div>

      {/* Action banner */}
      {flags.length > 0 ? (
        <div
          className="flex items-start gap-2.5 rounded-[var(--r-card)] p-3.5"
          style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
          role="status"
        >
          <AlertTriangle size={15} className="shrink-0 mt-px" />
          <p className="text-[12px] font-bold leading-relaxed">
            <strong>Action needed:</strong> {flags.join(" · ")}
            {s.locked > 0 || s.absentDays > 0
              ? " — i-check ang Site Visits tab para makita sino ang mga active."
              : "."}
          </p>
        </div>
      ) : (
        <div
          className="flex items-start gap-2.5 rounded-[var(--r-card)] p-3.5"
          style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          role="status"
        >
          <p className="text-[12px] font-bold leading-relaxed">
            Nothing needs attention right now.
            {name ? ` Thanks, ${String(name).split(" ")[0]}.` : ""}
          </p>
        </div>
      )}

      {/* Signed in as — quiet context for the mobile variant of this screen */}
      {role && (
        <p className="text-[11px] font-semibold text-[var(--text-faint)] mt-4">
          Signed in as {role}
        </p>
      )}
    </div>
  );
}