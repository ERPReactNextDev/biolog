"use client";

/* ============================================================================
   ADMIN · Audit Logs
   ----------------------------------------------------------------------------
   REBUILT IN THE CALM MINT SYSTEM.

   This page was the last one still on the legacy theme: `bg-brand-bg`,
   `text-gray-*`, shadcn Card/Table/Input, 2rem radii — and it rendered its own
   sticky header with a back arrow and breadcrumb INSIDE the admin layout, which
   already draws a sidebar and a top bar. So it was visually a different app
   from every page beside it.

   It now uses the same primitives as the rest of the console (mint Card/Button,
   the --card / --mint-strong token palette) and renders NO header of its own —
   the admin layout supplies the chrome.

   Layout follows the house pattern: page title, filter chips with counts, then a
   grouped list rather than a wide table, which reads better on the narrow
   screens this app is mostly used on.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DatabaseBackup,
  FileSpreadsheet,
  History,
  KeyRound,
  Loader2,
  Mail,
  PlaneTakeoff,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Button, Card } from "@/app/activity-planner/mint/ui";
import { ErrorOverlay } from "@/app/activity-planner/mint/states";
import { formatPHDate, formatPHDateTime } from "@/lib/ph-time";

interface AuditLog {
  _id: string;
  adminId: string;
  adminName: string;
  action: string;
  targetId: string;
  targetName: string;
  details: string;
  date_created: string;
}

/* ── Action vocabulary ─────────────────────────────────────────────────────
   recordAuditLog() takes a free-text action string, so new verbs appear
   whenever a feature is added. Unmapped actions fall back to a neutral pill
   rather than disappearing — an unrecognised entry is still an audit record and
   hiding it would be the wrong failure mode. */

type ActionTone = { bg: string; fg: string; Icon: typeof History };

const ACTION_TONE: Record<string, ActionTone> = {
  CREATE_USER: { bg: "var(--mint-soft)", fg: "var(--mint-strong)", Icon: UserPlus },
  UPDATE_USER: { bg: "var(--info-soft)", fg: "var(--info)", Icon: Users },
  DELETE_USER: { bg: "var(--alert-soft)", fg: "var(--alert-ink)", Icon: Trash2 },
  GRANT_ACCESS: { bg: "var(--mint-soft)", fg: "var(--mint-strong)", Icon: ShieldCheck },
  REVOKE_ACCESS: { bg: "var(--hint-bg)", fg: "var(--hint-text)", Icon: ShieldAlert },
  UPDATE_SETTINGS: { bg: "var(--violet-soft)", fg: "var(--violet-ink)", Icon: Settings },
  CREATE_BACKUP: { bg: "var(--info-soft)", fg: "var(--info)", Icon: DatabaseBackup },
  RESET_PASSWORD: { bg: "var(--clay-soft)", fg: "var(--clay-ink)", Icon: KeyRound },
  UPDATE_EMAIL_CONFIG: { bg: "var(--clay-soft)", fg: "var(--clay-ink)", Icon: Mail },
  UPDATE_COMPANY: { bg: "var(--info-soft)", fg: "var(--info)", Icon: Users },
  REVIEW_GPS_REPORT: { bg: "var(--mint-soft)", fg: "var(--mint-strong)", Icon: ShieldCheck },
  REVIEW_OB_REQUEST: { bg: "var(--mint-soft)", fg: "var(--mint-strong)", Icon: PlaneTakeoff },
  EXPORT_DATA: { bg: "var(--clay-soft)", fg: "var(--clay-ink)", Icon: FileSpreadsheet },
};

const NEUTRAL: ActionTone = { bg: "var(--bg)", fg: "var(--text-muted)", Icon: History };

function toneFor(action: string): ActionTone {
  return ACTION_TONE[action] || NEUTRAL;
}

/** "CREATE_USER" -> "Create user". Used for the filter chips. */
function actionLabel(action: string): string {
  const known = Object.keys(ACTION_TONE);
  if (!known.includes(action)) return action.replace(/_/g, " ").toLowerCase();
  return action
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "2h ago" — how the grouped list orders and labels rows. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatPHDate(iso, { month: "short", day: "numeric" });
}

export default function AuditLogsPage() {
  const router = useRouter();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/audit-logs", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.replace("/Login");
        return;
      }
      if (!res.ok) throw new Error(json?.error || "Could not load audit logs.");
      setLogs(Array.isArray(json) ? json : []);
    } catch (err: any) {
      setError(err?.message || "Could not load audit logs.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  /* Which actions are actually present, so the chips reflect real data rather
     than a fixed list that may not match this install. */
  const actionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of logs) m.set(l.action, (m.get(l.action) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (actionFilter !== "all" && l.action !== actionFilter) return false;
      if (!q) return true;
      return [l.adminName, l.targetName, l.targetId, l.action, l.details]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [logs, search, actionFilter]);

  /* Group by calendar day so the list reads as a timeline. */
  const grouped = useMemo(() => {
    const out: { day: string; label: string; rows: AuditLog[] }[] = [];
    for (const l of filtered) {
      const day = formatPHDate(l.date_created, { year: "numeric", month: "2-digit", day: "2-digit" });
      const label = formatPHDate(l.date_created, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const last = out[out.length - 1];
      if (last && last.day === day) last.rows.push(l);
      else out.push({ day, label, rows: [l] });
    }
    return out;
  }, [filtered]);

  if (error && logs.length === 0) {
    return <ErrorOverlay message={error} onRetry={load} />;
  }

  return (
    <div className="mint-ui mint-scope">
      {/* Head */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-black text-[var(--text)] leading-tight tracking-tight">
            Audit Logs
          </h1>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 leading-snug">
            Every administrative action, newest first
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={load}
          loading={loading}
          icon={<History size={16} />}
        >
          Refresh
        </Button>
      </div>

      {/* Filters */}
      {logs.length > 0 && (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 mb-3">
            <FilterChip
              active={actionFilter === "all"}
              onClick={() => setActionFilter("all")}
              label="All"
              n={logs.length}
            />
            {actionCounts.map(([action, n]) => (
              <FilterChip
                key={action}
                active={actionFilter === action}
                onClick={() => setActionFilter(actionFilter === action ? "all" : action)}
                label={actionLabel(action)}
                n={n}
              />
            ))}
          </div>

          <label
            className="flex items-center gap-2.5 h-[44px] px-3.5 rounded-[14px] border mb-4"
            style={{ background: "var(--card)", borderColor: "var(--border)" }}
          >
            <Search size={15} style={{ color: "var(--text-faint)" }} className="shrink-0" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search admin, action, target user…"
              className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] font-semibold"
              style={{ color: "var(--text)" }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="w-7 h-7 rounded-[9px] flex items-center justify-center shrink-0"
                style={{ color: "var(--text-faint)" }}
              >
                <X size={14} />
              </button>
            )}
          </label>
        </>
      )}

      {/* List */}
      {loading && logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--mint)" }} />
          <p className="text-[12px] font-bold" style={{ color: "var(--text-muted)" }}>
            Loading audit logs…
          </p>
        </div>
      ) : grouped.length === 0 ? (
        <Card className="py-14">
          <div className="flex flex-col items-center text-center px-6">
            <div
              className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
              style={{ background: "var(--mint-soft)", color: "var(--mint)" }}
            >
              {search || actionFilter !== "all" ? (
                <Search size={28} />
              ) : (
                <History size={28} />
              )}
            </div>
            <p className="text-[15px] font-extrabold text-[var(--text)]">
              {search || actionFilter !== "all" ? "No matching entries" : "No actions recorded yet"}
            </p>
            <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 max-w-[300px] leading-relaxed">
              {search || actionFilter !== "all"
                ? "Try a different search or action filter."
                : "Administrative changes will appear here as they happen."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.day}>
              <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2.5">
                {group.label}
              </p>

              <Card className="divide-y divide-[var(--border)] overflow-hidden">
                {group.rows.map((log) => {
                  const tone = toneFor(log.action);
                  const Icon = tone.Icon;
                  return (
                    <div key={log._id} className="flex items-start gap-3 px-4 py-3">
                      {/* Action */}
                      <span
                        className="w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0"
                        style={{ background: tone.bg, color: tone.fg }}
                        aria-hidden
                      >
                        <Icon size={16} strokeWidth={2.4} />
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[13px] font-extrabold text-[var(--text)] leading-tight">
                            {actionLabel(log.action)}
                          </p>
                          <span className="text-[10px] font-bold text-[var(--text-faint)] shrink-0 mt-px">
                            {relativeTime(log.date_created)}
                          </span>
                        </div>

                        {log.details && (
                          <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
                            {log.details}
                          </p>
                        )}

                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span
                            className="text-[9.5px] font-extrabold px-1.5 py-[3px] rounded-full leading-none"
                            style={{ background: tone.bg, color: tone.fg }}
                          >
                            {log.adminName || "Unknown admin"}
                          </span>
                          {(log.targetName || log.targetId) && (
                            <span className="text-[10.5px] font-bold text-[var(--text-faint)] truncate">
                              → {log.targetName || log.targetId}
                            </span>
                          )}
                          <span className="mint-num text-[10px] font-bold text-[var(--text-faint)]">
                            {formatPHDateTime(log.date_created)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  n,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  n: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="shrink-0 min-h-[36px] px-3.5 rounded-full text-[12px] font-extrabold border transition-all active:scale-95"
      style={
        active
          ? { background: "var(--mint-btn)", color: "#fff", borderColor: "transparent" }
          : { background: "var(--card)", color: "var(--text-muted)", borderColor: "var(--border)" }
      }
    >
      {label}
      <span className="ml-1.5 opacity-70">{n}</span>
    </button>
  );
}