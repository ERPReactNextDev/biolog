"use client";

/* ============================================================================
   Supporting states & detail views
   ----------------------------------------------------------------------------
   Splash, loading skeletons, error, offline queue, export confirmation, and
   the timesheet / GPS report entry points.
   ========================================================================== */

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MintDrawer } from "@/components/mint";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CloudOff,
  CloudUpload,
  FileDown,
  FileSpreadsheet,
  MapPin,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Card,
  EmptyState,
  Pill,
  Row,
  RowGroup,
  SectionLabel,
  Skeleton,
  cx,
} from "./ui";
import { getAllPendingLogs, removePendingLog, type PendingLog } from "@/lib/offline-store";
import { formatPHDateTime } from "@/lib/ph-time";
import { haptic } from "@/lib/haptics";
import type { ActivityData } from "./data";

// ── Splash ───────────────────────────────────────────────────────────────────

export function SplashScreen() {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-5"
      style={{
        background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--bg) 100%)",
      }}
      role="status"
      aria-label="Loading Biolog"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 14, stiffness: 200 }}
        className="w-[72px] h-[72px] rounded-[22px] flex items-center justify-center"
        style={{ background: "var(--mint-btn)", boxShadow: "var(--sh-btn)" }}
      >
        <svg width="34" height="34" viewBox="0 0 18 18" fill="none" aria-hidden>
          <rect x="2" y="8" width="14" height="2" rx="1" fill="white" />
          <rect x="2" y="4" width="9" height="2" rx="1" fill="white" />
          <rect x="2" y="12" width="11" height="2" rx="1" fill="white" />
        </svg>
      </motion.div>
      <div className="text-center">
        <p className="text-[20px] font-black tracking-[0.16em] text-[var(--mint-strong)]">BIOLOG</p>
        <p className="text-[12px] font-bold text-[var(--text-muted)] mt-1">
          Biometrics &amp; Field Attendance
        </p>
      </div>
      <div className="w-32 h-1 rounded-full bg-[var(--mint-soft)] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: "var(--mint)" }}
          initial={{ width: "0%" }}
          animate={{ width: ["0%", "70%", "100%"] }}
          transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity }}
        />
      </div>
    </div>
  );
}

// ── Loading skeleton (mirrors the Home layout) ───────────────────────────────

export function LoadingSkeleton() {
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
      <div className="mint-header px-5 pt-12 pb-16 flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        <Skeleton className="h-3.5 w-32 mb-2" />
        <Skeleton className="h-6 w-52" />
      </div>
      <div className="flex-1 px-4 -mt-10">
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Skeleton className="h-8 w-32 mb-2" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="w-px h-12 bg-[var(--border)]" />
            <div className="flex-1">
              <Skeleton className="h-3 w-16 mb-2" />
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-14 w-full rounded-[20px] mt-4" />
        </Card>
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-3.5">
              <Skeleton className="h-10 w-10 rounded-[13px] mb-2.5" />
              <Skeleton className="h-3 w-20 mb-1.5" />
              <Skeleton className="h-2.5 w-16" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Error overlay ────────────────────────────────────────────────────────────

export function ErrorOverlay({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center px-6"
      style={{ background: "var(--bg)" }}
    >
      <Card className="p-6 max-w-sm w-full">
        <EmptyState
          title="Can't load your data"
          message={`${message} Check your connection and try again — anything you already logged is safe on this phone.`}
          ctaLabel="Try again"
          onCta={onRetry}
          icon={<CloudOff size={26} />}
        />
      </Card>
    </div>
  );
}

// ── Offline / sync banner ────────────────────────────────────────────────────

export function SyncBanner({
  isOnline,
  isSyncing,
  pendingCount,
  onSyncNow,
}: {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  onSyncNow: () => void;
}) {
  if (isOnline && pendingCount === 0) return null;

  const offline = !isOnline;
  const tone = offline ? "var(--clay-soft)" : "var(--info-soft)";
  const fg = offline ? "var(--clay-ink)" : "var(--info)";

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 shrink-0 z-[60]"
      style={{ background: tone }}
      role="status"
    >
      {offline ? (
        <CloudOff size={15} style={{ color: fg }} className="shrink-0" />
      ) : (
        <CloudUpload
          size={15}
          style={{ color: fg }}
          className={cx("shrink-0", isSyncing && "animate-spin")}
        />
      )}
      <p className="text-[11.5px] font-bold flex-1 min-w-0" style={{ color: fg }}>
        {offline
          ? pendingCount > 0
            ? `Offline · ${pendingCount} record${pendingCount !== 1 ? "s" : ""} waiting to sync`
            : "You're offline — entries save to this phone"
          : isSyncing
            ? `Syncing ${pendingCount} record${pendingCount !== 1 ? "s" : ""}…`
            : `${pendingCount} record${pendingCount !== 1 ? "s" : ""} ready to sync`}
      </p>
      {!offline && pendingCount > 0 && !isSyncing && (
        <button
          type="button"
          onClick={() => {
            haptic("light");
            onSyncNow();
          }}
          className="shrink-0 text-[11.5px] font-black px-2.5 min-h-[32px] rounded-full"
          style={{ background: "var(--card)", color: fg }}
        >
          Sync
        </button>
      )}
    </div>
  );
}

// ── Export confirmation sheet ────────────────────────────────────────────────

export function ExportConfirmSheet({
  open,
  onClose,
  recordCount,
  rangeLabel,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  recordCount: number;
  rangeLabel: string;
  onConfirm: () => void;
}) {
  return (
    <MintDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      onClose={onClose}
      title={`Export ${recordCount} record${recordCount !== 1 ? "s" : ""}?`}
    >
      <div className="px-5 py-4" style={{ background: "var(--card)" }}>
        <div className="w-14 h-14 rounded-[18px] bg-[var(--mint-soft)] flex items-center justify-center mb-3.5">
          <FileDown size={24} className="text-[var(--mint-strong)]" />
        </div>
        <h2 className="text-[19px] font-black text-[var(--text)] leading-tight">
          Export {recordCount} record{recordCount !== 1 ? "s" : ""}?
        </h2>
        <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 leading-relaxed">
          This downloads an Excel file with {rangeLabel}. Share it with your supervisor or save it
          for your records.
        </p>

        {recordCount === 0 && (
          <div
            className="rounded-[var(--r-card)] p-3 mt-3.5"
            style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
          >
            <p className="text-[12px] font-bold leading-relaxed">
              No records match this range. Widen the date range or clear the email filter.
            </p>
          </div>
        )}

        <div className="flex gap-2.5 mt-5">
          <Button
            size="lg"
            full
            icon={<FileDown size={19} />}
            disabled={recordCount === 0}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            Export
          </Button>
          <Button size="lg" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </MintDrawer>
  );
}

// ── Offline queue ────────────────────────────────────────────────────────────

export function OfflineQueueSheet({
  open,
  onClose,
  isOnline,
  isSyncing,
  onSyncNow,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  isOnline: boolean;
  isSyncing: boolean;
  onSyncNow: () => void;
  onRefresh: () => void;
}) {
  const [logs, setLogs] = useState<PendingLog[] | null>(null);

  useEffect(() => {
    if (!open) return;
    getAllPendingLogs()
      .then(setLogs)
      .catch(() => setLogs([]));
  }, [open, isOnline, isSyncing]);

  const discard = async (id: string) => {
    await removePendingLog(id);
    haptic("medium");
    setLogs((prev) => (prev ? prev.filter((l) => l.id !== id) : prev));
    toast.info("Record discarded.");
  };

  return (
    <MintDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      onClose={onClose}
      title="Offline Queue"
      description="Records saved on this phone"
      maxHeight="85vh"
      header={
        <>
            <div className="px-5 pb-3.5 flex items-start justify-between gap-3 shrink-0 border-b border-[var(--border)] bg-[var(--card)]">
              <div className="min-w-0">
                <h2 className="text-[19px] font-black text-[var(--text)] leading-tight">
                  Offline Queue
                </h2>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                  Records saved on this phone
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-muted)] active:bg-[var(--mint-soft)] shrink-0"
              >
                <X size={18} />
              </button>
            </div>
        </>
      }
      footer={
        <div
          className="px-5 pt-3.5 pb-4 border-t border-[var(--border)] bg-[var(--card)] flex gap-2.5 shrink-0"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <Button
            size="lg"
            full
            icon={<CloudUpload size={19} />}
            loading={isSyncing}
            disabled={!isOnline || (logs?.length ?? 0) === 0}
            onClick={onSyncNow}
          >
            {isOnline ? "Sync now" : "Offline — waiting for signal"}
          </Button>
          <Button
            size="lg"
            variant="secondary"
            icon={<RefreshCw size={18} />}
            onClick={onRefresh}
            ariaLabel="Refresh queue"
          >
            {""}
          </Button>
        </div>
      }
    >
            <div className="px-5 py-4">
              {logs === null ? (
                <div className="space-y-2.5">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-[var(--r-card)]" />
                  ))}
                </div>
              ) : logs.length === 0 ? (
                <Card>
                  <EmptyState
                    title="Nothing waiting"
                    message="Every record on this phone has reached the server. Log a visit or clock in to test it while offline."
                    ctaLabel="Log a site visit"
                    onCta={onClose}
                    icon={<Check size={26} />}
                  />
                </Card>
              ) : (
                <>
                  <div
                    className="rounded-[var(--r-card)] p-3.5 mb-4 flex items-start gap-2.5"
                    style={{
                      background: isOnline ? "var(--mint-soft)" : "var(--clay-soft)",
                    }}
                  >
                    <CloudUpload
                      size={16}
                      className={cx("shrink-0 mt-px", isSyncing && "animate-spin")}
                      style={{ color: isOnline ? "var(--mint-strong)" : "var(--clay-ink)" }}
                    />
                    <p
                      className="text-[12px] font-bold leading-relaxed"
                      style={{ color: isOnline ? "var(--mint-strong)" : "var(--clay-ink)" }}
                    >
                      {logs.length} record{logs.length !== 1 ? "s" : ""} waiting.{" "}
                      {isOnline
                        ? "Tap sync to send them now."
                        : "They upload automatically as soon as you have signal."}
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    {logs.map((l) => {
                    const p = l.payload as Record<string, any>;
                    const created = p?.date_created;
                    return (
                      <Card key={l.id} className="p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <Pill tone="clay">{String(p?.Status ?? "Queued")}</Pill>
                              {l.retries > 0 && (
                                <Pill tone="alert">
                                  {l.retries} retr{l.retries !== 1 ? "ies" : "y"}
                                </Pill>
                              )}
                            </div>
                            <p className="text-[12.5px] font-bold text-[var(--text)] mt-2">
                              {p?.Type === "Client Visit"
                                ? p?.SiteVisitAccount || "Client visit"
                                : p?.Type || "Attendance"}
                            </p>
                            <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-0.5">
                              {created ? formatPHDateTime(created) : "Time not recorded"}
                            </p>
                            {p?.Location && (
                              <p className="text-[10.5px] font-semibold text-[var(--text-faint)] mt-1 line-clamp-1">
                                {String(p.Location)}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => discard(l.id)}
                            aria-label="Discard record"
                            className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0 active:bg-[var(--alert-soft)]"
                            style={{ color: "var(--alert)" }}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </Card>
                    );
                  })}
                  </div>
                </>
              )}
            </div>
    </MintDrawer>
  );
}

// ── Timesheet / GPS report entry points ──────────────────────────────────────

export function ToolScreen({
  title,
  subtitle,
  icon,
  tone,
  onBack,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tone: "mint" | "clay";
  onBack: () => void;
  children: React.ReactNode;
}) {
  const map = {
    mint: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
    clay: { bg: "var(--clay-soft)", fg: "var(--clay-ink)" },
  }[tone];

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      <div className="mint-header px-4 pt-12 pb-4 flex-shrink-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-11 h-11 rounded-[14px] bg-[var(--card)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] active:bg-[var(--mint-soft)] mb-4"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-[15px] flex items-center justify-center shrink-0"
            style={{ background: map.bg, color: map.fg }}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <h1 className="text-[20px] font-black text-[var(--text)] leading-tight">{title}</h1>
            <p className="text-[11.5px] font-bold text-[var(--text-muted)] mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="flex-1 mint-scroll px-4 pb-32">{children}</div>
    </div>
  );
}

/** Timesheet summary built from the same log data the Reports screen uses. */
export function TimesheetDetail({ data }: { data: ActivityData }) {
  const router = useRouter();
  const { currentMonth, allVisibleAccounts } = data;

  const monthLabel = currentMonth.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const { logins, logouts, workedDays, avgHours } = React.useMemo(() => {
    const inMonth = allVisibleAccounts.filter((p) => {
      const d = new Date(p.date_created);
      return (
        d.getFullYear() === currentMonth.getFullYear() &&
        d.getMonth() === currentMonth.getMonth()
      );
    });

    const byDay: Record<string, { in?: number; out?: number }> = {};
    inMonth.forEach((l) => {
      const d = new Date(l.date_created);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const t = d.getTime();
      if (l.Status === "Login") {
        byDay[key] ||= {};
        if (!byDay[key].in || t < byDay[key].in!) byDay[key].in = t;
      }
      if (l.Status === "Logout") {
        byDay[key] ||= {};
        if (!byDay[key].out || t > byDay[key].out!) byDay[key].out = t;
      }
    });

    const days = Object.entries(byDay);
    const withBoth = days.filter(([, v]) => v.in && v.out);
    const avg =
      withBoth.length > 0
        ? withBoth.reduce((acc, [, v]) => acc + (v.out! - v.in!) / 3600000, 0) /
          withBoth.length
        : 0;

    const worked = Object.keys(byDay).length;

    return {
      logins: inMonth.filter((l) => l.Status === "Login").length,
      logouts: inMonth.filter((l) => l.Status === "Logout").length,
      workedDays: worked,
      avgHours: Math.round(avg * 10) / 10,
    };
  }, [allVisibleAccounts, currentMonth]);

  const unmatched = Math.max(0, logins - logouts);

  return (
    <ToolScreen
      title="Timesheet"
      subtitle={`${monthLabel} · Hours, late & overtime`}
      icon={<FileSpreadsheet size={21} />}
      tone="mint"
      onBack={() => router.back()}
    >
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        {[
          { v: workedDays, l: "Days worked", c: "var(--mint-strong)", bg: "var(--mint-soft)" },
          { v: avgHours, l: "Avg hours/day", c: "var(--info)", bg: "var(--info-soft)" },
          { v: logins, l: "Clock-ins", c: "var(--clay-ink)", bg: "var(--clay-soft)" },
        ].map((s) => (
          <Card key={s.l} className="p-3.5">
            <p className="mint-num text-[22px] font-black leading-none" style={{ color: s.c }}>
              {s.v}
            </p>
            <p className="text-[10.5px] font-bold text-[var(--text-muted)] mt-1.5 leading-tight">
              {s.l}
            </p>
          </Card>
        ))}
      </div>

      {unmatched > 0 && (
        <Card
          className="p-3.5 mb-4"
          style={{ background: "var(--hint-bg)", borderColor: "transparent" }}
        >
          <p className="text-[12px] font-bold leading-relaxed" style={{ color: "var(--hint-text)" }}>
            {unmatched} clock-in{unmatched !== 1 ? "s" : ""} without a matching clock-out in{" "}
            {monthLabel}. Close them before payroll cut-off so your hours aren't undercounted.
          </p>
        </Card>
      )}

      <SectionLabel className="mb-2.5">Day Breakdown</SectionLabel>
      <RowGroup>
        {allVisibleAccounts
          .filter((p) => {
            const d = new Date(p.date_created);
            return (
              d.getFullYear() === currentMonth.getFullYear() &&
              d.getMonth() === currentMonth.getMonth()
            );
          })
          .slice(0, 12)
          .map((l, i) => (
            <Row
              key={`${l._id}-${i}`}
              icon={<CalendarDays size={17} />}
              tone={l.Status === "Login" ? "mint" : "info"}
              title={formatPHDateTime(l.date_created)}
              subtitle={l.Location || "No location recorded"}
              right={
                <Pill tone={l.Status === "Login" ? "mint" : "info"}>{l.Status}</Pill>
              }
              chevron={false}
              onClick={() => data.onEventClick(l)}
            />
          ))}
      </RowGroup>
    </ToolScreen>
  );
}
