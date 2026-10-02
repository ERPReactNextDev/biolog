"use client";

/* ============================================================================
   GPS Approvals queue
   ----------------------------------------------------------------------------
   Reads public.gps_reports via /api/admin/approvals. Column names are exactly
   as they exist in the schema.

   PhotoURL is jsonb and holds an ARRAY of urls, so it is normalised here —
   older rows may store a bare string or an object, hence the tolerant reader.
   ========================================================================== */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Clock,
  Image as ImageIcon,
  LogIn,
  LogOut,
  MapPin,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Pill } from "@/app/activity-planner/mint/ui";
import { LoadingSkeleton, ErrorOverlay } from "@/app/activity-planner/mint/states";

type Filter = "pending" | "approved" | "declined";

type Report = {
  id: number | string;
  ReferenceID?: string | null;
  Email?: string | null;
  Remarks?: string | null;
  TSM?: string | null;
  PhotoURL?: unknown;
  loginDate?: string | null;
  logoutDate?: string | null;
  Latitude?: string | null;
  Longitude?: string | null;
  Location?: string | null;
  reviewStatus?: string | null;
  reviewedBy?: string | null;
  reviewNotes?: string | null;
  reviewedAt?: string | null;
  date_created?: string | null;
};

/** jsonb may be a string, an array, or {url}. Normalise to string[]. */
function photoList(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t === "[]") return [];
    if (t.startsWith("[")) {
      try {
        return photoList(JSON.parse(t));
      } catch {
        return [t];
      }
    }
    return [t];
  }
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === "string" ? v : (v as { url?: string })?.url || ""))
      .filter(Boolean);
  }
  if (typeof raw === "object") {
    const url = (raw as { url?: string }).url;
    return url ? [url] : [];
  }
  return [];
}

const fmtDate = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
};

const fmtTime = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
};

/* ── Photo gallery ──────────────────────────────────────────────────────── */

function PhotoGallery({ urls, name }: { urls: string[]; name: string }) {
  const [open, setOpen] = useState<string | null>(null);

  if (urls.length === 0) {
    return (
      <p className="text-[11.5px] font-semibold text-[var(--text-faint)] flex items-center gap-1.5">
        <ImageIcon size={12} /> No photos attached
      </p>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold"
          style={{ background: "var(--info-soft)", color: "var(--info)" }}
        >
          <ImageIcon size={11} /> {urls.length} photo{urls.length > 1 ? "s" : ""}
        </span>
        <div className="flex gap-1.5">
          {urls.slice(0, 6).map((u, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setOpen(u)}
              aria-label={`View photo ${i + 1}`}
              className="w-11 h-11 rounded-[10px] overflow-hidden border active:scale-95 transition-transform"
              style={{ borderColor: "var(--border)" }}
            >
              <img src={u} alt={`${name} photo ${i + 1}`} className="w-full h-full object-cover" />
            </button>
          ))}
          {urls.length > 6 && (
            <span className="w-11 h-11 rounded-[10px] flex items-center justify-center text-[11px] font-black" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>
              +{urls.length - 6}
            </span>
          )}
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(15,23,42,0.9)" }}
          onClick={() => setOpen(null)}
          role="dialog"
          aria-label="Photo viewer"
        >
          <img src={open} alt={name} className="max-w-full max-h-full rounded-[16px] object-contain" />
          <button
            type="button"
            aria-label="Close photo"
            className="absolute top-5 right-5 w-11 h-11 rounded-full flex items-center justify-center text-white"
            style={{ background: "rgba(255,255,255,0.16)" }}
          >
            <X size={20} />
          </button>
        </div>
      )}
    </>
  );
}

/* ── Card ───────────────────────────────────────────────────────────────── */

function GPSReportCard({
  report,
  onReviewed,
}: {
  report: Report;
  onReviewed: (id: number | string, status: Filter) => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"approved" | "declined" | null>(null);
  const photos = useMemo(() => photoList(report.PhotoURL), [report.PhotoURL]);

  const settled = (report.reviewStatus || "pending").toLowerCase() as Filter;
  const isPending = settled === "pending";

  const decide = async (status: "approved" | "declined") => {
    if (busy) return;
    if (status === "declined" && !notes.trim()) {
      toast.error("Add a reason so the agent knows why it was declined.");
      return;
    }
    setBusy(status);
    try {
      const res = await fetch("/api/gps-report/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", cache: "no-store",
        body: JSON.stringify({ reportId: report.id, status, reviewNotes: notes.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Couldn't save that review.");
        return;
      }
      toast.success(
        status === "approved" ? "Report approved." : "Report declined.",
        data?.emailError ? { description: "Saved, but the notification email failed to send." } : undefined
      );
      setNotes("");
      onReviewed(report.id, status);
    } catch {
      toast.error("Network problem — review not saved.");
    } finally {
      setBusy(null);
    }
  };

  const statusTone =
    settled === "approved" ? "mint" : settled === "declined" ? "alert" : "neutral";

  return (
    <Card className="p-4 mb-3">
      {/* Head */}
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-[14px] font-black text-white shrink-0"
          style={{ background: "var(--mint-btn)" }}
        >
          {initials(report.Email)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-extrabold text-[var(--text)] truncate">
            {report.Email || "Unknown agent"}
          </p>
          <p className="text-[11.5px] font-semibold text-[var(--text-muted)] truncate">
            {report.ReferenceID || "—"} · {fmtDate(report.date_created)}
          </p>
        </div>
        <Pill tone={statusTone as "mint" | "alert" | "neutral"}>
          {settled === "pending" ? "Pending" : settled === "approved" ? "Approved" : "Declined"}
        </Pill>
      </div>

      {/* Location */}
      <div
        className="mt-3 flex items-center gap-2 rounded-[var(--r-card)] px-3 py-2"
        style={{ background: "var(--bg)" }}
      >
        <MapPin size={13} style={{ color: "var(--clay)" }} className="shrink-0" />
        <p className="text-[12px] font-semibold text-[var(--text)] truncate">
          {report.Location || "No location recorded"}
        </p>
      </div>

      {/* Times + coords */}
      <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Meta icon={<LogIn size={11} />} label="Time in" value={fmtTime(report.loginDate)} />
        <Meta icon={<LogOut size={11} />} label="Time out" value={fmtTime(report.logoutDate)} />
        <Meta icon={<MapPin size={11} />} label="Latitude" value={report.Latitude || "—"} />
        <Meta icon={<MapPin size={11} />} label="Longitude" value={report.Longitude || "—"} />
      </div>

      {/* Reason */}
      {report.Remarks && (
        <div className="mt-3">
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] mb-1">
            Reason
          </p>
          <p className="text-[12.5px] font-semibold text-[var(--text)] leading-relaxed">
            {report.Remarks}
          </p>
        </div>
      )}

      {/* Photos */}
      <div className="mt-3">
        <PhotoGallery urls={photos} name={report.Email || "agent"} />
      </div>

      {/* Review */}
      {isPending ? (
        <>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Add review notes (optional)…"
            className="mt-3 w-full px-3 py-2.5 rounded-[var(--r-card)] border bg-[var(--card)] text-[12.5px] font-semibold outline-none resize-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          />
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <Button
              size="md"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => decide("declined")}
              icon={busy === "declined" ? undefined : <X size={16} />}
            >
              {busy === "declined" ? "Declining…" : "Decline"}
            </Button>
            <Button
              size="md"
              full
              disabled={busy !== null}
              loading={busy === "approved"}
              onClick={() => decide("approved")}
              icon={busy === "approved" ? undefined : <Check size={16} />}
            >
              Approve
            </Button>
          </div>
        </>
      ) : (
        <div
          className="mt-3 rounded-[var(--r-card)] p-3"
          style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
        >
          <p className="text-[11px] font-extrabold text-[var(--text-muted)]">
            Reviewed by {report.reviewedBy || "unknown"} · {fmtDate(report.reviewedAt)}
          </p>
          {report.reviewNotes && (
            <p className="text-[12px] font-semibold text-[var(--text)] mt-1 leading-relaxed">
              {report.reviewNotes}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div
      className="rounded-[var(--r-card)] px-2.5 py-2"
      style={{ background: "var(--bg)" }}
    >
      <p className="flex items-center gap-1 text-[9.5px] font-black uppercase tracking-[0.1em] text-[var(--text-muted)]">
        {icon}
        {label}
      </p>
      <p className="mint-num text-[12px] font-extrabold text-[var(--text)] mt-0.5 truncate">
        {value}
      </p>
    </div>
  );
}

function initials(email?: string | null): string {
  if (!email) return "?";
  const name = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

/* ── Queue ──────────────────────────────────────────────────────────────── */

const FILTERS: { key: Filter; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
];

export default function ApprovalsQueue() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [reports, setReports] = useState<Report[]>([]);
  const [counts, setCounts] = useState<Record<Filter, number>>({
    pending: 0,
    approved: 0,
    declined: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const live = useRef(true);

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/approvals?filter=${f}`, {
        credentials: "include", cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || "Could not load reports.");
        return;
      }
      if (!live.current) return;
      setReports(Array.isArray(data.reports) ? data.reports : []);
      if (data.counts) setCounts(data.counts);
    } catch {
      if (live.current) setError("Network problem. Check your connection.");
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    load(filter);
    return () => {
      live.current = false;
    };
  }, [filter, load]);

  const onReviewed = (id: number | string, status: Filter) => {
    setReports((r) => r.filter((x) => x.id !== id));
    setCounts((c) => ({
      ...c,
      pending: Math.max(0, c.pending - (status === "pending" ? 1 : 0)),
      [status]: c[status] + 1,
    }));
  };

  return (
    <div>
      {/* Tabs + counts */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = counts[f.key] || 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className="min-h-[42px] px-4 rounded-full text-[12.5px] font-extrabold border transition-all active:scale-95 flex items-center gap-1.5"
              style={{
                background: active ? "var(--mint-btn)" : "var(--card)",
                color: active ? "#fff" : "var(--text-muted)",
                borderColor: active ? "transparent" : "var(--border)",
              }}
            >
              {f.label}
              <span
                className="min-w-[20px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10.5px] font-black"
                style={{
                  background: active ? "rgba(255,255,255,0.25)" : "var(--bg)",
                  color: active ? "#fff" : "var(--text-muted)",
                }}
              >
                {n}
              </span>
            </button>
          );
        })}

        <span
          className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-full"
          style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
        >
          <CalendarDays size={12} />
          public.gps_reports · reviewStatus = &apos;{filter === "declined" ? "declined" : filter}&apos;
        </span>
      </div>

      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorOverlay message={error} onRetry={() => load(filter)} />
      ) : reports.length === 0 ? (
        <Card className="p-8 text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
          >
            <Check size={24} />
          </div>
          <p className="text-[15px] font-black text-[var(--text)]">Nothing here</p>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 max-w-sm mx-auto">
            {filter === "pending"
              ? "No GPS reports are waiting for review. New submissions will appear here."
              : `No ${filter} reports yet.`}
          </p>
        </Card>
      ) : (
        <>
          {reports.map((r) => (
            <GPSReportCard key={r.id} report={r} onReviewed={onReviewed} />
          ))}
          <p className="flex items-center justify-center gap-1.5 text-[11.5px] font-semibold text-[var(--text-faint)] py-3">
            <Clock size={12} /> {reports.length} report{reports.length > 1 ? "s" : ""}
          </p>
        </>
      )}
    </div>
  );
}