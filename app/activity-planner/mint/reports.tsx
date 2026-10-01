"use client";

/* ============================================================================
   REPORTS — rate ring, stat cards, activity breakdown, tools, export
   ----------------------------------------------------------------------------
   Per the brief: date range + export controls sit at the TOP, never buried at
   the bottom where a field agent would have to scroll to find them.
   ========================================================================== */

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bell,
  CalendarDays,
  Check,
  CloudOff,
  FileSpreadsheet,
  FileDown,
  LogIn,
  LogOut,
  MapPin,
  Store,
} from "lucide-react";
import {
  Button,
  Card,
  Chip,
  Eyebrow,
  Hint,
  Pill,
  ProgressBar,
  ProgressRing,
  Row,
  RowGroup,
  SectionLabel,
  StatTile,
} from "./ui";
import {
  attendanceAdvice,
  timeAgoLabel,
  type ActivityData,
  type ActivityLog,
} from "./data";

type RangePreset = "This Month" | "Last Month" | "Last 30 Days" | "Custom";

const RANGE_PRESETS: RangePreset[] = ["This Month", "Last Month", "Last 30 Days", "Custom"];

function presetToRange(preset: RangePreset): { from: string; to: string } | null {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case "This Month":
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    case "Last Month":
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "Last 30 Days": {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: iso(from), to: iso(now) };
    }
    default:
      return null;
  }
}

export function ReportsScreen({ data }: { data: ActivityData }) {
  const router = useRouter();
  const {
    userId,
    userDetails,
    allVisibleAccounts,
    monthlyStats,
    currentMonth,
    pendingCount,
    isOnline,
    syncNow,
    isSyncing,
  } = data;

  const [preset, setPreset] = useState<RangePreset>("This Month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [emailFilter, setEmailFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState<number | null>(null);

  const monthLabel = currentMonth.toLocaleString("en-US", { month: "long" });
  const advice = useMemo(() => attendanceAdvice(monthlyStats, monthLabel), [monthlyStats, monthLabel]);

  // ── Filter logs by the chosen range + email ─────────────────────────────
  const { filtered, rangeLabel } = useMemo(() => {
    const range =
      preset === "Custom"
        ? customFrom
          ? { from: customFrom, to: customTo || customFrom }
          : null
        : presetToRange(preset);

    let list: ActivityLog[] = allVisibleAccounts;
    if (range) {
      const from = new Date(`${range.from}T00:00:00`);
      const to = new Date(`${range.to}T23:59:59`);
      list = list.filter((l: ActivityLog) => {
        const d = new Date(l.date_created);
        return d >= from && d <= to;
      });
    }
    if (emailFilter.trim()) {
      const q = emailFilter.trim().toLowerCase();
      list = list.filter((l: ActivityLog) => l.Email?.toLowerCase() === q);
    }

    return {
      filtered: list,
      rangeLabel: range ? `${range.from} → ${range.to}` : "All records",
    };
  }, [allVisibleAccounts, preset, customFrom, customTo, emailFilter]);

  const loginCount = filtered.filter((l) => l.Status === "Login").length;
  const logoutCount = filtered.filter((l) => l.Status === "Logout").length;
  const visitCount = filtered.filter((l) => l.Type === "Client Visit").length;
  const maxBreakdown = Math.max(loginCount, logoutCount, visitCount, 1);

  // ── Excel export (uses exceljs already in the project) ───────────────────
  const exportToExcel = async () => {
    if (exporting) return;
    setExporting(true);
    setExportDone(null);
    try {
      const range =
        preset === "Custom"
          ? customFrom
            ? { from: customFrom, to: customTo || customFrom }
            : null
          : presetToRange(preset);

      const params = new URLSearchParams();
      params.append("page", "1");
      params.append("limit", "10000");
      params.append("role", userDetails?.Role || "User");
      if (userDetails?.Role !== "SuperAdmin" && userDetails?.Role !== "Human Resources") {
        params.append("referenceID", userDetails?.ReferenceID || "");
      }
      if (range) {
        params.append("startDate", new Date(`${range.from}T00:00:00`).toISOString());
        params.append("endDate", new Date(`${range.to}T23:59:59`).toISOString());
      }

      const res = await fetch(`/api/ModuleSales/Activity/FetchLog?${params.toString()}`);
      if (!res.ok) throw new Error("fetch failed");
      const json = await res.json();
      let logs: ActivityLog[] = json.data || [];

      if (emailFilter.trim()) {
        const q = emailFilter.trim().toLowerCase();
        logs = logs.filter((l) => l.Email?.toLowerCase() === q);
      }

      if (logs.length === 0) {
        toast.error("No records in this range to export.");
        return;
      }

      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Attendance");

      ws.columns = [
        { header: "Reference ID", key: "ref", width: 18 },
        { header: "Email", key: "email", width: 28 },
        { header: "Type", key: "type", width: 16 },
        { header: "Status", key: "status", width: 14 },
        { header: "Date & Time", key: "date", width: 22 },
        { header: "Location", key: "loc", width: 46 },
        { header: "Client", key: "client", width: 24 },
        { header: "Remarks", key: "remarks", width: 34 },
      ];

      ws.getRow(1).font = { bold: true, color: { argb: "FF0D9669" } };
      ws.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE6F4EE" },
      };

      logs.forEach((l) => {
        ws.addRow({
          ref: l.ReferenceID,
          email: l.Email,
          type: l.Type,
          status: l.Status,
          date: new Date(l.date_created).toLocaleString(),
          loc: l.Location,
          client: l.SiteVisitAccount,
          remarks: l.Remarks,
        });
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `biolog-attendance-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);

      setExportDone(logs.length);
      toast.success(`Exported ${logs.length} record${logs.length !== 1 ? "s" : ""} to Excel.`);
    } catch {
      toast.error("Export failed. Check your connection and try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {/* Header */}
      <div className="mint-header px-4 pt-12 pb-4 flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-11 h-11 rounded-[15px] flex items-center justify-center font-black text-white shrink-0"
            style={{ background: "var(--mint-btn)", boxShadow: "var(--sh-btn)" }}
            aria-hidden
          >
            {userDetails
              ? `${userDetails.Firstname[0] ?? ""}${userDetails.Lastname[0] ?? ""}`.toUpperCase()
              : "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-extrabold text-[var(--text)] truncate">
              {userDetails ? `${userDetails.Firstname} ${userDetails.Lastname}` : "—"}
            </p>
            <p className="text-[11px] font-bold text-[var(--text-muted)] truncate">
              {userDetails?.Role ?? "—"} · {userDetails?.TSM ? `Zone ${userDetails.TSM}` : ""}
            </p>
          </div>
          <Pill tone="mint">{monthLabel.slice(0, 3)} 2026</Pill>
        </div>
        <h1 className="text-[24px] font-black text-[var(--text)] tracking-tight">
          Attendance Reports
        </h1>
      </div>

      <div className="flex-1 mint-scroll px-4 pb-32">
        {/* ── Date range + email filter FIRST (per brief) ─────────────────── */}
        <Card className="p-4 mb-4">
          <SectionLabel className="mb-2.5">Date Range</SectionLabel>
          <div className="flex gap-2 overflow-x-auto mint-scroll pb-1 -mx-1 px-1 mb-3">
            {RANGE_PRESETS.map((p) => (
              <Chip key={p} active={preset === p} onClick={() => setPreset(p)}>
                {p}
              </Chip>
            ))}
          </div>

          {preset === "Custom" && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From date"
                className="min-h-[48px] px-3 rounded-[14px] border border-[var(--border-strong)] bg-[var(--card)] text-[13px] font-bold text-[var(--text)] min-w-0"
              />
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To date"
                className="min-h-[48px] px-3 rounded-[14px] border border-[var(--border-strong)] bg-[var(--card)] text-[13px] font-bold text-[var(--text)] min-w-0"
              />
            </div>
          )}

          <SectionLabel className="mb-2.5">Filter by Email</SectionLabel>
          <input
            type="email"
            value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
            placeholder="All agents"
            aria-label="Filter by email"
            className="w-full min-h-[48px] px-4 rounded-[var(--r-btn)] border border-[var(--border-strong)] bg-[var(--card)] text-[13.5px] font-semibold text-[var(--text)] placeholder:text-[var(--text-faint)] mb-3"
          />

          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-[11.5px] font-bold text-[var(--text-muted)] min-w-0">
              <span className="mint-num text-[var(--text)]">{filtered.length}</span> record
              {filtered.length !== 1 ? "s" : ""} · {rangeLabel}
            </p>
          </div>

          <Button
            full
            size="md"
            icon={<FileDown size={18} />}
            loading={exporting}
            onClick={exportToExcel}
          >
            {exporting ? "Preparing file…" : "Export to Excel"}
          </Button>

          {exportDone !== null && (
            <p className="text-[11.5px] font-bold text-[var(--mint-strong)] mt-2.5 flex items-center gap-1.5">
              <Check size={13} /> Saved {exportDone} record{exportDone !== 1 ? "s" : ""} to your
              downloads.
            </p>
          )}
        </Card>

        {/* ── Attendance ring + context ───────────────────────────────────── */}
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-4">
            <ProgressRing
              value={advice.rate}
              size={92}
              tone={
                advice.tone === "alert"
                  ? "var(--alert)"
                  : advice.tone === "clay"
                    ? "var(--clay)"
                    : "var(--mint)"
              }
            >
              <div className="text-center">
                <p
                  className="mint-num text-[20px] font-black leading-none"
                  style={{
                    color:
                      advice.tone === "alert"
                        ? "var(--alert-ink)"
                        : advice.tone === "clay"
                          ? "var(--clay-ink)"
                          : "var(--mint-strong)",
                  }}
                >
                  {advice.rate}%
                </p>
                <p className="text-[9px] font-black uppercase tracking-wide text-[var(--text-faint)] mt-0.5">
                  Rate
                </p>
              </div>
            </ProgressRing>

            <div className="flex-1 min-w-0">
              <SectionLabel>Attendance Rate</SectionLabel>
              <p className="text-[13.5px] font-extrabold text-[var(--text)] mt-1 leading-snug">
                {monthlyStats.present} present · {monthlyStats.absent} absent ·{" "}
                {monthlyStats.visits} site visits
              </p>
              <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-1">
                {monthLabel} {currentMonth.getFullYear()}
              </p>
            </div>
          </div>

          {/* Numbers never stand alone — always say what to do about them */}
          <div className="mt-3.5">
            {advice.tone === "mint" ? (
              <div
                className="flex items-start gap-2.5 rounded-[var(--r-card)] p-3"
                style={{ background: "var(--mint-soft)" }}
              >
                <Check size={15} className="text-[var(--mint-strong)] shrink-0 mt-px" />
                <p className="text-[12px] font-bold text-[var(--mint-strong)] leading-relaxed">
                  {advice.message}
                </p>
              </div>
            ) : (
              <Hint icon={<FileSpreadsheet size={14} />}>{advice.message}</Hint>
            )}
          </div>
        </Card>

        {/* ── Stat cards ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          <StatTile
            value={monthlyStats.present}
            label="Present"
            icon={<LogIn size={17} />}
            tone="mint"
            hint={`of ${monthlyStats.total} work days`}
          />
          <StatTile
            value={monthlyStats.absent}
            label="Absent"
            icon={<LogOut size={17} />}
            tone="alert"
            hint="no login recorded"
          />
          <StatTile
            value={monthlyStats.visits}
            label="Site Visits"
            icon={<Store size={17} />}
            tone="clay"
            hint="client check-ins"
          />
        </div>

        {/* ── Activity breakdown ──────────────────────────────────────────── */}
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3.5">
            <SectionLabel>Activity Breakdown</SectionLabel>
            <span className="text-[10.5px] font-bold text-[var(--text-faint)]">
              in selected range
            </span>
          </div>

          {[
            { label: "Login Records", v: loginCount, c: "var(--mint)", Icon: LogIn },
            { label: "Logout Records", v: logoutCount, c: "var(--alert)", Icon: LogOut },
            { label: "Client Visits", v: visitCount, c: "var(--clay)", Icon: Store },
          ].map((row) => (
            <div key={row.label} className="mb-3 last:mb-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--text)]">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: row.c }}
                    aria-hidden
                  />
                  {row.label}
                </span>
                <span className="mint-num text-[12.5px] font-black text-[var(--text)]">
                  {row.v}
                </span>
              </div>
              <ProgressBar value={(row.v / maxBreakdown) * 100} tone={row.c} height={7} />
            </div>
          ))}

          <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-3.5 pt-3 border-t border-[var(--border)] leading-relaxed">
            {loginCount > 0 && logoutCount > 0
              ? `${loginCount - logoutCount > 0 ? `${loginCount - logoutCount} unmatched clock-in${loginCount - logoutCount !== 1 ? "s" : ""}` : "Every clock-in has a matching clock-out"} — check the timesheet if anything looks off.`
              : "Some clock-ins may not have a matching clock-out. Open the timesheet to verify."}
          </p>
        </Card>

        {/* ── Tools ───────────────────────────────────────────────────────── */}
        <Eyebrow>Tools</Eyebrow>
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <ToolTile
            icon={<FileSpreadsheet size={19} />}
            title="Timesheet"
            subtitle="Hours, late & OT"
            tone="mint"
            onClick={() =>
              router.push(
                `/time-attendance/timesheet${userId ? `?id=${encodeURIComponent(userId)}` : ""}`
              )
            }
          />
          <ToolTile
            icon={<MapPin size={19} />}
            title="GPS Report"
            subtitle="Submit location"
            tone="clay"
            onClick={() =>
              router.push(
                `/gps-report${userId ? `?id=${encodeURIComponent(userId)}` : ""}`
              )
            }
          />
          <ToolTile
            icon={<CloudOff size={19} />}
            title="Offline"
            subtitle={
              pendingCount > 0
                ? `${pendingCount} pending sync`
                : isOnline
                  ? "All synced"
                  : "No connection"
            }
            tone={pendingCount > 0 ? "clay" : "info"}
            onClick={() => {
              if (pendingCount > 0 && isOnline) syncNow();
              else
                toast.info(
                  isOnline
                    ? "Everything is already synced."
                    : "You're offline. Pending records will upload automatically."
                );
            }}
          />
          <ToolTile
            icon={<FileDown size={19} />}
            title="Export"
            subtitle="Excel file"
            tone="info"
            onClick={exportToExcel}
          />
        </div>

        {isSyncing && (
          <p className="text-[11.5px] font-bold text-[var(--info)] text-center mb-3">
            Syncing {pendingCount} pending record{pendingCount !== 1 ? "s" : ""}…
          </p>
        )}

        {/* Offline nudge */}
        {!isOnline && (
          <Card className="p-3.5" style={{ background: "var(--clay-soft)", borderColor: "transparent" }}>
            <div className="flex items-start gap-2.5">
              <CloudOff size={16} className="text-[var(--clay-ink)] shrink-0 mt-px" />
              <p className="text-[12px] font-bold text-[var(--clay-ink)] leading-relaxed">
                Working offline. Your reports show cached data — tap Sync when you&apos;re back on
                mobile data.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function ToolTile({
  icon,
  title,
  subtitle,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tone: "mint" | "clay" | "info";
  onClick: () => void;
}) {
  const map = {
    mint: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
    clay: { bg: "var(--clay-soft)", fg: "var(--clay-ink)" },
    info: { bg: "var(--info-soft)", fg: "var(--info)" },
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className="mint-tap text-left rounded-[var(--r-card)] border border-[var(--border)] bg-[var(--card)] p-3.5 shadow-[var(--sh-card)] active:bg-[var(--mint-soft)]"
    >
      <div
        className="w-9 h-9 rounded-[12px] flex items-center justify-center mb-2"
        style={{ background: map.bg, color: map.fg }}
      >
        {icon}
      </div>
      <p className="text-[13px] font-extrabold text-[var(--text)] leading-tight">{title}</p>
      <p className="text-[10.5px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
        {subtitle}
      </p>
    </button>
  );
}
