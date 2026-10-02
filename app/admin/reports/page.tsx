"use client";

/* ============================================================================
   REPORTS — team attendance overview
   ----------------------------------------------------------------------------
   Reads /api/admin/analytics, which aggregates `public.tasklog`
   (attendance_logs from the addendum does not exist — see that route's note).

   Rate colouring follows the addendum: green ≥20%, amber 10–19%, red <10%.
   ========================================================================== */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, TrendingUp } from "lucide-react";
import { Card } from "@/app/activity-planner/mint/ui";
import { LoadingSkeleton, ErrorOverlay } from "@/app/activity-planner/mint/states";

type Agent = {
  referenceId: string;
  firstname: string;
  lastname: string;
  email: string;
  department: string;
  tsm: string;
  presentDays: number;
  absentDays: number;
  visits: number;
  attendanceRate: number;
  totalHours: number;
  lateCount: number;
};

type Payload = {
  agents: Agent[];
  days: string[];
  totals: {
    avgPresent: number;
    avgAbsent: number;
    totalVisits: number;
    activeAgents: number;
    totalAgents: number;
    belowTen: number;
    zeroRate: number;
  };
};

const RANGES = [
  { key: "month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
  { key: "last_30", label: "Last 30 Days" },
  { key: "custom", label: "Custom Range" },
] as const;

const rateTone = (r: number) =>
  r >= 20 ? { bg: "var(--mint-soft)", fg: "var(--mint-strong)", bar: "var(--mint)" }
  : r >= 10 ? { bg: "var(--hint-bg)", fg: "var(--hint-text)", bar: "#F59E0B" }
  : { bg: "var(--alert-soft)", fg: "var(--alert-ink)", bar: "var(--alert)" };

const initials = (a: Agent) => {
  const n = `${a.firstname} ${a.lastname}`.trim() || a.email || "?";
  return n.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
};

export default function AdminReports() {
  const [range, setRange] = useState<string>("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dept, setDept] = useState("all");
  const [tsm, setTsm] = useState("all");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams({ range });
      if (range === "custom" && from && to) {
        p.set("from", from);
        p.set("to", to);
      }
      const res = await fetch(`/api/admin/analytics?${p.toString()}`, { credentials: "include", cache: "no-store" });
      if (res.status === 401) return setError("Your session expired. Sign in again.");
      if (res.status === 403) return setError("You do not have permission to view team reports.");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d?.message || "Could not build the report.");
      if (live.current) setData(d);
    } catch {
      if (live.current) setError("Network problem. Check your connection.");
    } finally {
      if (live.current) setLoading(false);
    }
  }, [range, from, to]);

  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  const agents = (data?.agents || []).filter(
    (a) => (dept === "all" || a.department === dept) && (tsm === "all" || a.tsm === tsm)
  );
  const departments = Array.from(new Set((data?.agents || []).map((a) => a.department).filter(Boolean)));
  const tsms = Array.from(new Set((data?.agents || []).map((a) => a.tsm).filter(Boolean)));

  const exportCsv = () => {
    const head = ["ReferenceID", "Name", "Email", "Department", "TSM", "Present", "Absent", "Visits", "Attendance Rate %"];
    const body = agents.map((a) => [
      a.referenceId,
      `${a.firstname} ${a.lastname}`.trim(),
      a.email,
      a.department,
      a.tsm,
      a.presentDays,
      a.absentDays,
      a.visits,
      a.attendanceRate,
    ]);
    const csv = [head, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `biolog-attendance-${range}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorOverlay message={error} onRetry={load} />;

  const t = data?.totals;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <h1 className="text-[19px] font-black text-[var(--text)] leading-tight">
          Attendance Reports — Team Overview
        </h1>
        <button
          type="button"
          onClick={exportCsv}
          disabled={agents.length === 0}
          className="min-h-[44px] px-4 rounded-[var(--r-btn)] text-[12.5px] font-extrabold flex items-center gap-2 transition-all active:scale-[0.98] disabled:opacity-45"
          style={{ background: "var(--mint-btn)", color: "#fff", boxShadow: "var(--sh-btn)" }}
        >
          <Download size={15} /> Export to Excel
        </button>
      </div>

      {/* Range chips */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {RANGES.map((r) => {
          const active = range === r.key;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className="min-h-[42px] px-3.5 rounded-full text-[12px] font-extrabold border transition-all active:scale-95"
              style={{
                background: active ? "var(--mint-btn)" : "var(--card)",
                color: active ? "#fff" : "var(--text-muted)",
                borderColor: active ? "transparent" : "var(--border)",
              }}
            >
              {r.label}
            </button>
          );
        })}
        {range === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-11 px-3 rounded-[var(--r-btn)] border bg-[var(--card)] text-[12.5px] font-bold outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
            />
            <span className="text-[12px] font-bold text-[var(--text-faint)]">to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-11 px-3 rounded-[var(--r-btn)] border bg-[var(--card)] text-[12.5px] font-bold outline-none"
              style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
            />
          </div>
        )}
      </div>

      {/* Team stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Avg Present" value={`${t?.avgPresent ?? 0}%`} tone={rateTone(t?.avgPresent ?? 0)} />
        <Stat label="Avg Absent" value={`${t?.avgAbsent ?? 0}%`} tone={{ fg: "var(--alert-ink)" }} />
        <Stat label="Total Visits" value={t?.totalVisits ?? 0} tone={{ fg: "var(--clay-ink)" }} />
        <Stat label="Agents" value={t?.activeAgents ?? 0} tone={{ fg: "var(--info)" }} />
      </div>

      {/* Low-attendance hint */}
      {(t?.belowTen || 0) + (t?.zeroRate || 0) > 0 && (
        <div
          className="flex items-start gap-2.5 rounded-[var(--r-card)] p-3.5 mb-4"
          style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-px" />
          <p className="text-[12px] font-bold leading-relaxed">
            <strong>
              {(t?.belowTen || 0) + (t?.zeroRate || 0)} agent
              {(t?.belowTen || 0) + (t?.zeroRate || 0) === 1 ? "" : "s"} below 10%
            </strong>{" "}
            — review their Site Visits before the next payroll cut-off.
          </p>
        </div>
      )}

      {/* Filters */}
      {(departments.length > 1 || tsms.length > 1) && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="h-11 px-3 rounded-[var(--r-btn)] border bg-[var(--card)] text-[12.5px] font-bold outline-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <select
            value={tsm}
            onChange={(e) => setTsm(e.target.value)}
            className="h-11 px-3 rounded-[var(--r-btn)] border bg-[var(--card)] text-[12.5px] font-bold outline-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          >
            <option value="all">All TSMs</option>
            {tsms.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Per-agent breakdown */}
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2.5">
        Per-agent breakdown
      </p>
      {agents.length === 0 ? (
        <Card className="p-8 text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            <TrendingUp size={24} />
          </div>
          <p className="text-[15px] font-black text-[var(--text)]">No agents match</p>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1">
            Try clearing the department or TSM filter.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {agents.map((a) => {
            const tone = rateTone(a.attendanceRate);
            return (
              <Card key={a.referenceId} className="p-3.5">
                <div className="flex items-center gap-3">
                  <span
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-black text-white shrink-0"
                    style={{ background: "var(--mint-btn)" }}
                  >
                    {initials(a)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-extrabold text-[var(--text)] truncate">
                      {`${a.firstname} ${a.lastname}`.trim() || a.email}
                    </p>
                    <p className="text-[10.5px] font-semibold text-[var(--text-faint)] truncate">
                      {a.referenceId}
                      {a.department ? ` · ${a.department}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    <Mini label={`${a.presentDays} present`} tone="mint" />
                    <Mini label={`${a.absentDays} absent`} tone="alert" />
                    <Mini label={`${a.visits} visits`} tone="clay" />
                    <span
                      className="min-w-[52px] text-right text-[13px] font-black mint-num"
                      style={{ color: tone.fg }}
                    >
                      {a.attendanceRate}%
                    </span>
                  </div>
                </div>
                <div
                  className="h-1.5 rounded-full mt-2.5 overflow-hidden"
                  style={{ background: "var(--border)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(2, Math.min(100, a.attendanceRate))}%`,
                      background: tone.bar,
                    }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: { fg: string } }) {
  return (
    <Card className="p-4 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mint-num text-[26px] font-black leading-tight mt-1" style={{ color: tone.fg }}>
        {value}
      </p>
    </Card>
  );
}

function Mini({ label, tone }: { label: string; tone: "mint" | "alert" | "clay" }) {
  const map = {
    mint: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
    alert: { bg: "var(--alert-soft)", fg: "var(--alert-ink)" },
    clay: { bg: "var(--clay-soft)", fg: "var(--clay-ink)" },
  } as const;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-extrabold whitespace-nowrap"
      style={{ background: map[tone].bg, color: map[tone].fg }}
    >
      {label}
    </span>
  );
}