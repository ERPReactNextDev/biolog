"use client";

/* ============================================================================
   Admin · Location Review
   ----------------------------------------------------------------------------
   The queue behind the GeoFlag column. One row per attendance record that
   needs a human: an out-of-fence visit, a low-accuracy fix, or a log filed
   from a stale offline position.

   WHY OUTSIDE THE FENCE IS FIRST
   A manager reading this list is looking for one thing: who was somewhere they
   should not have been. Accuracy and staleness are context for that, not the
   subject. So the ordering is severity, then time — and an out-of-fence visit
   is never buried under a low-accuracy entry.

   WHY IT IS NOT COLOURED RED
   Most of these rows are a phone in a basement, not misconduct. Amber reads as
   "check this"; red would put every indoor clock-in in the same category as a
   failure and train everyone to skim past.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CloudOff,
  Crosshair,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Pill } from "@/app/activity-planner/mint/ui";
import { ErrorOverlay } from "@/app/activity-planner/mint/states";
import { formatPHDateTime } from "@/lib/ph-time";

interface Row {
  id: number;
  referenceId: string;
  type: string;
  status: string;
  siteVisitAccount: string | null;
  location: string | null;
  latitude: string | null;
  longitude: string | null;
  photoUrl: string | null;
  remarks: string | null;
  accuracyM: number | null;
  source: string | null;
  flag: string;
  distanceM: number | null;
  siteName: string | null;
  reviewed: boolean;
  dateCreated: string;
  agentName: string | null;
  manager: string | null;
  tsm: string | null;
}

/* Severity order. Unknown flags sort last rather than disappearing — an
   unrecognised value still came from the database and is still worth a look. */
const SEVERITY: Record<string, number> = {
  outside_geofence: 0,
  low_accuracy: 1,
  network_fix: 2,
  offline_stale: 3,
  manual_override: 4,
};

const FLAG_META: Record<
  string,
  { label: string; Icon: typeof AlertTriangle; tone: "amber" | "info" | "neutral" }
> = {
  outside_geofence: { label: "Outside fence", Icon: ShieldAlert, tone: "amber" },
  low_accuracy: { label: "Low accuracy", Icon: AlertTriangle, tone: "amber" },
  network_fix: { label: "Network fix", Icon: Crosshair, tone: "info" },
  offline_stale: { label: "Offline fix", Icon: CloudOff, tone: "info" },
  manual_override: { label: "Set manually", Icon: Navigation, tone: "neutral" },
};

export default function GeoFlagsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notConfigured, setNotConfigured] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [reviewed, setReviewed] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/geo-flags", {
        credentials: "include",
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        window.location.href = "/Login";
        return;
      }
      if (!res.ok) throw new Error(json?.error || "Could not load flagged records.");
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setNotConfigured(json.reason === "not_configured");
    } catch (e: any) {
      setError(e?.message || "Could not load flagged records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const markReviewed = async (id: number) => {
    /* Optimistic: the queue is a work list, and waiting on a round trip to
       make a row disappear makes the list feel stuck. Reverted on failure. */
    setReviewed((s) => new Set(s).add(id));
    try {
      const res = await fetch(`/api/admin/geo-flags?id=${id}`, {
        method: "PATCH",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not mark as reviewed.");
      setRows((rs) => rs.filter((r) => r.id !== id));
      toast.success("Marked as reviewed.");
    } catch (e: any) {
      setReviewed((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      toast.error(e?.message || "Could not mark as reviewed.");
    }
  };

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.flag, (m.get(r.flag) || 0) + 1);
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const list = filter === "all" ? rows : rows.filter((r) => r.flag === filter);
    return [...list].sort((a, b) => {
      const sa = SEVERITY[a.flag] ?? 99;
      const sb = SEVERITY[b.flag] ?? 99;
      if (sa !== sb) return sa - sb;
      return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
    });
  }, [rows, filter]);

  if (error && rows.length === 0) return <ErrorOverlay message={error} onRetry={load} />;

  return (
    <div className="mint-ui mint-scope">
      {/* Head */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-black text-[var(--text)] leading-tight tracking-tight">
            Location Review
          </h1>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 leading-snug">
            Attendance records whose location needs a second look
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={16} />}
          onClick={load}
          loading={loading}
        >
          Refresh
        </Button>
      </div>

      {notConfigured && (
        <Card className="p-4 mb-4" style={{ background: "var(--amber-soft)", border: "none" }}>
          <p className="text-[12.5px] font-extrabold" style={{ color: "var(--amber-ink)" }}>
            Nothing to review yet — the location-quality columns have not been created.
          </p>
          <p className="text-[12px] font-semibold mt-1 leading-relaxed" style={{ color: "var(--amber-ink)" }}>
            Run{" "}
            <code className="mint-num font-extrabold">supabase/migrations/20260106_location_accuracy.sql</code>{" "}
            in the Supabase SQL Editor. Until then no attendance record is ever flagged.
          </p>
        </Card>
      )}

      {/* Filters, built from what is actually queued */}
      {rows.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 mb-3">
          <Chip active={filter === "all"} onClick={() => setFilter("all")} label="All" n={rows.length} />
          {[...counts.entries()]
            .sort((a, b) => (SEVERITY[a[0]] ?? 99) - (SEVERITY[b[0]] ?? 99))
            .map(([flag, n]) => (
              <Chip
                key={flag}
                active={filter === flag}
                onClick={() => setFilter(filter === flag ? "all" : flag)}
                label={FLAG_META[flag]?.label || flag.replace(/_/g, " ")}
                n={n}
              />
            ))}
        </div>
      )}

      {/* List */}
      {loading && rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--mint)" }} />
          <p className="text-[12px] font-bold" style={{ color: "var(--text-muted)" }}>
            Loading the queue…
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <Card className="py-14">
          <div className="flex flex-col items-center text-center px-6">
            <div
              className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
              style={{ background: "var(--mint-soft)", color: "var(--mint)" }}
            >
              <Check size={28} />
            </div>
            <p className="text-[15px] font-extrabold text-[var(--text)]">
              {rows.length === 0 ? "Nothing to review" : "No records in this filter"}
            </p>
            <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 max-w-[340px] leading-relaxed">
              {rows.length === 0
                ? "Every attendance record so far has a location good enough to accept. This fills up when a visit lands outside a client fence, when GPS was poor, or when a log was filed offline."
                : "Try a different filter."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((r) => {
            const meta = FLAG_META[r.flag] || {
              label: r.flag.replace(/_/g, " "),
              Icon: AlertTriangle,
              tone: "neutral" as const,
            };
            const Icon = meta.Icon;
            const isOutside = r.flag === "outside_geofence";

            return (
              <Card key={r.id} className="p-3.5">
                <div className="flex items-start gap-3">
                  <span
                    className="w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0"
                    style={{
                      background: isOutside ? "var(--amber-soft)" : "var(--bg)",
                      color: isOutside ? "var(--amber-ink)" : "var(--text-muted)",
                    }}
                    aria-hidden
                  >
                    <Icon size={16} strokeWidth={2.4} />
                  </span>

                  <div className="flex-1 min-w-0">
                    {/* Who + what */}
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-[13px] font-extrabold text-[var(--text)] leading-tight">
                          {r.agentName || r.referenceId}
                        </p>
                        <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                          {r.status} · {r.type}
                          {r.siteVisitAccount ? ` · ${r.siteVisitAccount}` : ""}
                        </p>
                      </div>
                      <Pill tone={meta.tone}>{meta.label}</Pill>
                    </div>

                    {/* The numbers that explain WHY it is queued */}
                    <div
                      className="flex items-center gap-2 mt-2 flex-wrap text-[11px] font-bold"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span className="mint-num">
                        {formatPHDateTime(r.dateCreated)}
                      </span>
                      {r.accuracyM != null && (
                        <span className="mint-num">±{Math.round(Number(r.accuracyM))} m</span>
                      )}
                      {isOutside && r.distanceM != null && (
                        <span className="mint-num" style={{ color: "var(--amber-ink)" }}>
                          {Math.round(Number(r.distanceM))} m from {r.siteName || "the client"}
                        </span>
                      )}
                    </div>

                    {r.location && (
                      <p className="text-[11.5px] font-semibold text-[var(--text-faint)] mt-1 leading-snug">
                        <MapPin size={11} className="inline mr-1 -mt-0.5" />
                        {r.location}
                      </p>
                    )}

                    {r.remarks && (
                      <p className="text-[11.5px] font-semibold text-[var(--text)] mt-1.5 leading-snug">
                        &ldquo;{r.remarks}&rdquo;
                      </p>
                    )}

                    {/* The evidence the spec requires for an out-of-fence visit */}
                    {isOutside && (
                      <div className="flex items-center gap-2 mt-2">
                        {r.photoUrl ? (
                          <a
                            href={r.photoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={r.photoUrl}
                              alt="Attendance photo"
                              className="w-11 h-11 rounded-[10px] object-cover"
                              style={{ border: "1px solid var(--border)" }}
                            />
                          </a>
                        ) : (
                          <Pill tone="amber">No photo</Pill>
                        )}
                        <span className="text-[11px] font-semibold text-[var(--text-faint)]">
                          {r.photoUrl ? "Photo attached" : "Photo was required"}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-2.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Check size={15} />}
                        loading={reviewed.has(r.id)}
                        onClick={() => markReviewed(r.id)}
                      >
                        Mark reviewed
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {filtered.length > 0 && (
        <p className="text-[11.5px] font-semibold text-[var(--text-faint)] mt-4">
          Marking a record reviewed does not change the attendance — it only removes it from this
          list. The flag and its measurements are kept on the row.
        </p>
      )}
    </div>
  );
}

function Chip({
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