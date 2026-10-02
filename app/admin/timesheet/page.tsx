"use client";

/* ============================================================================
   TIMESHEET — weekly admin view
   ----------------------------------------------------------------------------
   Reads /api/admin/analytics over a date range. Hours are the gap between a
   shift Login and the matching Logout in `public.tasklog`.

   A clock-in with NO matching clock-out is shown as a red cell with 0h rather
   than being silently inflated — the addendum calls that out explicitly, and
   the Site Visits tab is where you verify those.
   ========================================================================== */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Info, Search } from "lucide-react";
import { Card } from "@/app/activity-planner/mint/ui";
import { LoadingSkeleton, ErrorOverlay } from "@/app/activity-planner/mint/states";

type Agent = {
  referenceId: string;
  firstname: string;
  lastname: string;
  email: string;
  totalHours: number;
  lateCount: number;
  grid: Record<string, number>;
};

type Payload = {
  agents: Agent[];
  days: string[];
  range: { from: string; to: string };
  totals: { totalHours: number; totalLate: number };
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Monday-based week containing today. */
function weekRange(offsetWeeks = 0) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 0 = Monday
  const mon = new Date(now);
  mon.setDate(now.getDate() - day + offsetWeeks * 7);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { from: iso(mon), to: iso(sun), label: `${iso(mon)} → ${iso(sun)}` };
}

const dayLabel = (isoDay: string) =>
  new Date(isoDay).toLocaleDateString("en-PH", { weekday: "short", day: "numeric" });

const initials = (a: Agent) => {
  const n = `${a.firstname} ${a.lastname}`.trim() || a.email || "?";
  return n.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || "").join("");
};

export default function AdminTimesheet() {
  const [week, setWeek] = useState(() => weekRange(0));
  const [q, setQ] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams({ range: "custom", from: week.from, to: week.to });
      const res = await fetch(`/api/admin/analytics?${p.toString()}`, { credentials: "include", cache: "no-store" });
      if (res.status === 401) return setError("Your session expired. Sign in again.");
      if (res.status === 403) return setError("You do not have permission to view team timesheets.");
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d?.message || "Could not build the timesheet.");
      if (live.current) setData(d);
    } catch {
      if (live.current) setError("Network problem. Check your connection.");
    } finally {
      if (live.current) setLoading(false);
    }
  }, [week.from, week.to]);

  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  const agents = useMemo(
    () =>
      (data?.agents || []).filter((a) =>
        q.trim()
          ? `${a.firstname} ${a.lastname} ${a.email} ${a.referenceId}`
              .toLowerCase()
              .includes(q.trim().toLowerCase())
          : true
      ),
    [data, q]
  );

  const days = data?.days || [];

  // Under/over time against a 40h week, and missing-shift count.
  const STANDARD = 40;
  const summary = agents.map((a) => {
    const hours = Object.values(a.grid || {}).reduce((s, h) => s + h, 0);
    const under = Math.max(0, STANDARD - hours);
    const over = Math.max(0, hours - STANDARD);
    const missing = days.filter((d) => {
      const v = a.grid?.[d];
      return v === undefined || v === 0;
    }).length;
    return { ...a, hours, under, over, missing };
  });
  const totals = summary.reduce(
    (acc, a) => ({
      hours: acc.hours + a.hours,
      late: acc.late + a.lateCount,
      under: acc.under + a.under,
      over: acc.over + a.over,
    }),
    { hours: 0, late: 0, under: 0, over: 0 }
  );

  const exportCsv = () => {
    const head = ["ReferenceID", "Name", ...days.map(dayLabel), "Total Hours", "Late", "Undertime", "Overtime"];
    const body = summary.map((a) => [
      a.referenceId,
      `${a.firstname} ${a.lastname}`.trim(),
      ...days.map((d) => (a.grid?.[d] ? `${a.grid[d]}h` : "0")),
      a.hours,
      a.lateCount,
      Math.round(a.under * 10) / 10,
      Math.round(a.over * 10) / 10,
    ]);
    const csv = [head, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const el = document.createElement("a");
    el.href = url;
    el.download = `biolog-timesheet-${week.from}_to_${week.to}.csv`;
    el.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorOverlay message={error} onRetry={load} />;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-[19px] font-black text-[var(--text)] leading-tight">Timesheet</h1>
          <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-0.5">
            {week.label}
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={summary.length === 0}
          className="min-h-[44px] px-4 rounded-[var(--r-btn)] text-[12.5px] font-extrabold flex items-center gap-2 transition-all active:scale-[0.98] disabled:opacity-45"
          style={{ background: "var(--mint-btn)", color: "#fff", boxShadow: "var(--sh-btn)" }}
        >
          <Download size={15} /> Export
        </button>
      </div>

      {/* Week + search */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <button
          type="button"
          onClick={() => setWeek(weekRange(-1))}
          className="min-h-[44px] px-4 rounded-[var(--r-btn)] border text-[12.5px] font-extrabold"
          style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
        >
          ← Prev week
        </button>
        <button
          type="button"
          onClick={() => setWeek(weekRange(0))}
          className="min-h-[44px] px-4 rounded-[var(--r-btn)] text-[12.5px] font-extrabold"
          style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
        >
          This week
        </button>
        <button
          type="button"
          onClick={() => setWeek(weekRange(1))}
          className="min-h-[44px] px-4 rounded-[var(--r-btn)] border text-[12.5px] font-extrabold"
          style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--text)" }}
        >
          Next week →
        </button>
        <label
          className="flex items-center gap-2 h-11 px-3.5 rounded-[var(--r-btn)] border bg-[var(--card)] flex-1 min-w-[200px] ml-auto"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <Search size={15} style={{ color: "var(--text-faint)" }} className="shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-semibold"
            style={{ color: "var(--text)" }}
          />
        </label>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Total Hours" value={`${Math.round(totals.hours * 10) / 10}h`} color="var(--mint-strong)" />
        <Stat label="Total Late" value={`${Math.round(totals.late * 10) / 10}h`} color="var(--alert-ink)" />
        <Stat label="Undertime" value={`${Math.round(totals.under * 10) / 10}h`} color="#B45309" />
        <Stat label="Overtime" value={`${Math.round(totals.over * 10) / 10}h`} color="var(--info)" />
      </div>

      {/* Grid */}
      <div
        className="rounded-[var(--r-card-lg)] border overflow-hidden"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr style={{ background: "var(--mint-btn)", color: "#fff" }}>
                <th className="text-left px-4 py-3 text-[11px] font-black">Employee</th>
                {days.map((d) => (
                  <th key={d} className="text-center px-2 py-3 text-[11px] font-black whitespace-nowrap">
                    {dayLabel(d)}
                  </th>
                ))}
                <th className="text-center px-3 py-3 text-[11px] font-black">Total</th>
                <th className="text-center px-3 py-3 text-[11px] font-black">Late</th>
                <th className="text-center px-3 py-3 text-[11px] font-black">Under</th>
                <th className="text-center px-3 py-3 text-[11px] font-black">OT</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 ? (
                <tr>
                  <td colSpan={days.length + 5} className="px-4 py-10 text-center">
                    <p className="text-[14px] font-black text-[var(--text)]">No timesheet rows</p>
                    <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-1">
                      Nothing was logged for this week, or your search matched nobody.
                    </p>
                  </td>
                </tr>
              ) : (
                summary.map((a) => (
                  <tr key={a.referenceId} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black text-white shrink-0"
                          style={{ background: "var(--mint-btn)" }}
                        >
                          {initials(a)}
                        </span>
                        <span className="text-[12.5px] font-extrabold text-[var(--text)] truncate">
                          {`${a.firstname} ${a.lastname}`.trim() || a.email}
                        </span>
                      </div>
                    </td>
                    {days.map((d) => {
                      const v = a.grid?.[d];
                      const present = typeof v === "number" && v > 0;
                      return (
                        <td key={d} className="px-2 py-2.5 text-center">
                          <span
                            className="inline-flex min-w-[44px] h-7 px-2 items-center justify-center rounded-full text-[11px] font-black"
                            style={
                              present
                                ? { background: "var(--mint-soft)", color: "var(--mint-strong)" }
                                : { background: "var(--alert-soft)", color: "var(--alert-ink)" }
                            }
                          >
                            {present ? `${Math.round(v * 10) / 10}h` : "—"}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center mint-num text-[12px] font-black text-[var(--text)]">
                      {Math.round(a.hours * 10) / 10}h
                    </td>
                    <td className="px-3 py-2.5 text-center mint-num text-[12px] font-extrabold" style={{ color: a.lateCount ? "var(--alert-ink)" : "var(--text-faint)" }}>
                      {a.lateCount ? `${a.lateCount * 1}h` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center mint-num text-[12px] font-extrabold" style={{ color: a.under > 0 ? "#B45309" : "var(--text-faint)" }}>
                      {a.under > 0 ? `${Math.round(a.under * 10) / 10}h` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-center mint-num text-[12px] font-extrabold" style={{ color: a.over > 0 ? "var(--info)" : "var(--text-faint)" }}>
                      {a.over > 0 ? `${Math.round(a.over * 10) / 10}h` : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p
        className="flex items-start gap-2 text-[11.5px] font-semibold text-[var(--text-muted)] mt-3 leading-relaxed"
      >
        <Info size={13} className="shrink-0 mt-px" style={{ color: "var(--info)" }} />
        Some clock-ins may not have a matching clock-out — those days show as{" "}
        <strong>0h</strong>. Verify them in the Site Visits tab.
      </p>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Card className="p-4 text-center">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mint-num text-[26px] font-black leading-tight mt-1" style={{ color }}>
        {value}
      </p>
    </Card>
  );
}