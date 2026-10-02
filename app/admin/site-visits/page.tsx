"use client";

/* ============================================================================
   SITE VISITS & ACTIVITY LOG — who did what, when and where
   ----------------------------------------------------------------------------
   Reads /api/admin/activity, which unions `public.tasklog` + `public.meetings`.
   (The addendum named site_visits / attendance_logs; those tables do not exist
   in this project — see the schema note in that route.)

   Without can_view_all the API scopes to the caller's own ReferenceID, so this
   page cannot leak another agent's records even if the URL is edited.
   ========================================================================== */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Download,
  Image as ImageIcon,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { Card, Pill } from "@/app/activity-planner/mint/ui";
import { LoadingSkeleton, ErrorOverlay } from "@/app/activity-planner/mint/states";

type Entry = {
  id: string;
  kind: "log" | "meeting";
  referenceId: string;
  firstname: string;
  lastname: string;
  email: string;
  department: string;
  profilePicture: string | null;
  activityType: string;
  timestamp: string | null;
  location: string;
  latitude: string | null;
  longitude: string | null;
  clientType: string;
  photo: string;
  photos: string[];
  remarks: string;
};

const CHIPS = [
  { key: "all", label: "All Activities" },
  { key: "login", label: "Login" },
  { key: "logout", label: "Logout" },
  { key: "site_visit", label: "Site Visit" },
  { key: "meeting", label: "Meeting" },
] as const;

const TYPE_TONE: Record<string, { bg: string; fg: string }> = {
  Login: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
  Logout: { bg: "var(--alert-soft)", fg: "var(--alert-ink)" },
  "Site Visit": { bg: "var(--clay-soft)", fg: "var(--clay-ink)" },
  Meeting: { bg: "var(--info-soft)", fg: "var(--info)" },
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

function initials(e: Entry) {
  const n = `${e.firstname} ${e.lastname}`.trim() || e.email || "?";
  return n
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

const fmtDateTime = (v: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
  );
};

export default function SiteVisitsAdmin() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [chip, setChip] = useState<string>("all");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(iso(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<Entry | null>(null);
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ type: chip, from, to });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/admin/activity?${params.toString()}`, {
        credentials: "include", cache: "no-store",
      });
      if (res.status === 401) {
        setError("Your session expired. Sign in again.");
        return;
      }
      if (res.status === 403) {
        setError("You do not have permission to view team activity.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || "Could not load activity.");
        return;
      }
      if (!live.current) return;
      setEntries(Array.isArray(data.activity) ? data.activity : []);
      setTotals(data.totals || {});
    } catch {
      if (live.current) setError("Network problem. Check your connection.");
    } finally {
      if (live.current) setLoading(false);
    }
  }, [chip, from, to, q]);

  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  /* CSV export — computed from what's on screen. */
  const exportCsv = () => {
    const head = [
      "Name",
      "ReferenceID",
      "Email",
      "Activity Type",
      "Timestamp",
      "Location",
      "Client Type",
      "Remarks",
    ];
    const body = entries.map((e) => [
      `${e.firstname} ${e.lastname}`.trim(),
      e.referenceId,
      e.email,
      e.activityType,
      e.timestamp || "",
      e.location,
      e.clientType || "—",
      e.remarks,
    ]);
    const csv = [head, ...body]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `biolog-activity-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const source = useMemo(
    () => "public.tasklog + public.meetings",
    []
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-[19px] font-black text-[var(--text)] leading-tight">
            Site Visits &amp; Activity Log
          </h1>
          <p
            className="text-[11.5px] font-semibold mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            <MapPin size={11} /> Source: {source}
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={entries.length === 0}
          className="min-h-[44px] px-4 rounded-[var(--r-btn)] text-[12.5px] font-extrabold flex items-center gap-2 transition-all active:scale-[0.98] disabled:opacity-45"
          style={{ background: "var(--mint-btn)", color: "#fff", boxShadow: "var(--sh-btn)" }}
        >
          <Download size={15} /> Export Log
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {CHIPS.map((c) => {
          const active = chip === c.key;
          const n = totals[c.key];
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip(c.key)}
              className="min-h-[42px] px-3.5 rounded-full text-[12px] font-extrabold border transition-all active:scale-95 flex items-center gap-1.5"
              style={{
                background: active ? "var(--mint-btn)" : "var(--card)",
                color: active ? "#fff" : "var(--text-muted)",
                borderColor: active ? "transparent" : "var(--border)",
              }}
            >
              {c.label}
              {typeof n === "number" && (
                <span
                  className="min-w-[19px] h-[17px] px-1 rounded-full flex items-center justify-center text-[10px] font-black"
                  style={{
                    background: active ? "rgba(255,255,255,0.25)" : "var(--bg)",
                    color: active ? "#fff" : "var(--text-muted)",
                  }}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + date range */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <label
          className="flex items-center gap-2 h-11 px-3.5 rounded-[var(--r-btn)] border bg-[var(--card)] flex-1 min-w-[220px]"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <Search size={15} style={{ color: "var(--text-faint)" }} className="shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search user, location, ReferenceID…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] font-semibold"
            style={{ color: "var(--text)" }}
          />
        </label>
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
          className="h-11 px-3 rounded-[var(--r-btn)] border bg-[var(--card)] text-[12.5px] font-bold outline-none"
          style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
        />
        <span className="text-[12px] font-bold text-[var(--text-faint)]">to</span>
        <input
          type="date"
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
          className="h-11 px-3 rounded-[var(--r-btn)] border bg-[var(--card)] text-[12.5px] font-bold outline-none"
          style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
        />
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorOverlay message={error} onRetry={load} />
      ) : entries.length === 0 ? (
        <Card className="p-8 text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            <CalendarDays size={24} />
          </div>
          <p className="text-[15px] font-black text-[var(--text)]">No activity in this range</p>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 max-w-sm mx-auto">
            Widen the date range, or clear the filter to see everything the team logged.
          </p>
        </Card>
      ) : (
        <>
          {/* Table */}
          <div
            className="rounded-[var(--r-card-lg)] border overflow-hidden"
            style={{ borderColor: "var(--border)", background: "var(--card)" }}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr style={{ background: "var(--bg)" }}>
                    {["User (who did it)", "Activity", "Time", "Location", "Client", "Photo"].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.1em]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const tone = TYPE_TONE[e.activityType] || TYPE_TONE.Login;
                    return (
                      <tr
                        key={e.id}
                        onClick={() => setDetail(e)}
                        className="cursor-pointer border-t transition-colors"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            {e.profilePicture ? (
                              <img
                                src={e.profilePicture}
                                alt=""
                                className="w-8 h-8 rounded-full object-cover shrink-0"
                              />
                            ) : (
                              <span
                                className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black text-white shrink-0"
                                style={{ background: "var(--mint-btn)" }}
                              >
                                {initials(e)}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="text-[12.5px] font-extrabold text-[var(--text)] truncate">
                                {`${e.firstname} ${e.lastname}`.trim() || e.email}
                              </p>
                              <p className="text-[10.5px] font-semibold text-[var(--text-faint)] truncate">
                                {e.referenceId}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold"
                            style={{ background: tone.bg, color: tone.fg }}
                          >
                            {e.activityType}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 mint-num text-[11.5px] font-bold text-[var(--text-muted)] whitespace-nowrap">
                          {fmtDateTime(e.timestamp)}
                        </td>
                        <td className="px-4 py-2.5 text-[11.5px] font-semibold text-[var(--text)] max-w-[260px]">
                          <span className="line-clamp-1">{e.location || "—"}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {e.clientType ? (
                            <Pill tone={e.clientType.toLowerCase().startsWith("new") ? "info" : "clay"}>
                              {e.clientType}
                            </Pill>
                          ) : (
                            <span className="text-[12px] text-[var(--text-faint)]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {e.photo ? (
                            <img
                              src={e.photo}
                              alt=""
                              className="w-8 h-8 rounded-[8px] object-cover border"
                              style={{ borderColor: "var(--border)" }}
                            />
                          ) : (
                            <ImageIcon size={16} style={{ color: "var(--text-faint)" }} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11.5px] font-semibold text-[var(--text-faint)] mt-2.5">
            {entries.length} record{entries.length === 1 ? "" : "s"} · click a row for full details
          </p>
        </>
      )}

      {/* Event details */}
      {detail && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.6)" }}
          onClick={() => setDetail(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[88vh] overflow-y-auto"
          >
          <Card className="w-full p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-[17px] font-black text-[var(--text)]">Event details</h2>
                <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-0.5">
                  {`${detail.firstname} ${detail.lastname}`.trim() || detail.email} ·{" "}
                  {detail.referenceId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                aria-label="Close"
                className="w-11 h-11 rounded-[13px] flex items-center justify-center shrink-0"
                style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 mb-4">
              <KV label="Activity" value={detail.activityType} />
              <KV label="Exact time" value={fmtDateTime(detail.timestamp)} />
              <KV label="Client type" value={detail.clientType || "—"} />
              <KV label="Department" value={detail.department || "—"} />
              <KV label="Latitude" value={detail.latitude ?? "—"} />
              <KV label="Longitude" value={detail.longitude ?? "—"} />
            </div>

            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] mb-1.5">
              Location
            </p>
            <p className="text-[12.5px] font-semibold text-[var(--text)] mb-4 leading-relaxed">
              {detail.location || "No location recorded"}
            </p>

            {detail.remarks && (
              <>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] mb-1.5">
                  Remarks
                </p>
                <p className="text-[12.5px] font-semibold text-[var(--text)] mb-4 leading-relaxed">
                  {detail.remarks}
                </p>
              </>
            )}

            {detail.photos.length > 0 && (
              <>
                <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] mb-1.5">
                  Photos
                </p>
                <div className="flex gap-2 flex-wrap mb-4">
                  {detail.photos.map((u, i) => (
                    <a
                      key={i}
                      href={u}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-20 h-20 rounded-[12px] overflow-hidden border"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <img src={u} alt="" className="w-full h-full object-cover" />
                    </a>
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={exportCsv}
              className="w-full min-h-[44px] rounded-[var(--r-btn)] text-[13px] font-extrabold flex items-center justify-center gap-2"
              style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
            >
              <Download size={15} /> Download this log
            </button>
          </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--r-card)] px-3 py-2" style={{ background: "var(--bg)" }}>
      <p className="text-[9.5px] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="text-[12px] font-extrabold text-[var(--text)] mt-0.5 truncate">{value}</p>
    </div>
  );
}