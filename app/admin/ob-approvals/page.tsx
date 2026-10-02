"use client";

/* ============================================================================
   OB Approvals — review queue for Official Business Trip requests
   ----------------------------------------------------------------------------
   Image-first review. The photo of the signed ROBT form IS the artifact, so the
   queue leads with a thumbnail and the detail opens a pinch/zoom viewer rather
   than a text summary.

   RBAC: /api/ob-request and /api/ob-request/review both enforce `can_review_ob`
   (HRAD / Super Admin — see lib/rbac.ts). The approval chain is Agent → HRAD.
   This page only hides things for convenience; the server is the boundary, and
   a 403 here is rendered as a real message rather than an empty list.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  FileSpreadsheet,
  Inbox,
  Loader2,
  Plane,
  PlaneTakeoff,
  Search,
  ShieldAlert,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Card } from "@/app/activity-planner/mint/ui";
import { LoadingSkeleton, ErrorOverlay } from "@/app/activity-planner/mint/states";
import ObImageViewer from "@/app/ob-request/mint/image-viewer";
import {
  LateFilingBadge,
  ObApprovalTimeline,
  ObCard,
  ObCardHeader,
  ObDetailRow,
  ObDivider,
  ObNote,
  ObPhotoThumb,
  ObStatusBadge,
} from "@/app/ob-request/mint/ob-shared";
import { reviewObRequest } from "@/app/ob-request/mint/ob-data";
import {
  OB_STATUS,
  formatObDate,
  formatObDateTime,
  obEmployeeInitials,
  obEmployeeName,
  obPhotos,
  obRelativeDay,
  type ObRequest,
} from "@/lib/ob-requests";

type Filter = "pending" | "approved" | "declined" | "late" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "declined", label: "Declined" },
  { key: "late", label: "Late Filing" },
  { key: "all", label: "All" },
];

/* ── Excel export ───────────────────────────────────────────────────────────
   Mirrors app/activity-planner/mint/reports.tsx: exceljs is already a
   dependency, imported dynamically so it never lands in the initial bundle. */

async function exportToExcel(rows: ObRequest[], label: string) {
  if (rows.length === 0) {
    toast.error("No requests in this filter to export.");
    return;
  }

  try {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Biolog";
    const ws = wb.addWorksheet("OB Requests");

    ws.columns = [
      { header: "Reference ID", key: "ref", width: 16 },
      { header: "Name", key: "name", width: 24 },
      { header: "Position", key: "position", width: 20 },
      { header: "Department", key: "dept", width: 20 },
      { header: "Destination", key: "dest", width: 28 },
      { header: "Date of OB", key: "dateob", width: 14 },
      { header: "Purpose", key: "purpose", width: 40 },
      { header: "Late filing", key: "late", width: 12 },
      { header: "Justification", key: "just", width: 40 },
      { header: "Status", key: "status", width: 18 },
      { header: "Images", key: "images", width: 8 },
      { header: "Reviewed by", key: "by", width: 26 },
      { header: "Review notes", key: "notes", width: 40 },
      { header: "Reviewed at", key: "at", width: 18 },
      { header: "Date filed", key: "filed", width: 18 },
    ];

    ws.getRow(1).font = { bold: true, color: { argb: "FF0D9669" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F4EE" } };

    rows.forEach((r) => {
      ws.addRow({
        ref: r.ReferenceID,
        name: obEmployeeName(r),
        position: r.Position || "",
        dept: r.Department || "",
        dest: r.Destination || "",
        dateob: r.DateOfOB ? formatObDate(r.DateOfOB) : "",
        purpose: r.PurposeOfTravel || "",
        late: r.IsLateFiling ? "YES" : "NO",
        just: r.Justification || "",
        status: r.Status || OB_STATUS.PENDING,
        images: obPhotos(r).length,
        by: r.ReviewedBy || "",
        notes: r.ReviewNotes || "",
        at: r.ReviewedAt ? formatObDateTime(r.ReviewedAt) : "",
        filed: formatObDateTime(r.date_created),
      });
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `biolog-ob-requests-${label}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported ${rows.length} request${rows.length !== 1 ? "s" : ""} to Excel.`);
  } catch {
    toast.error("Export failed. Check your connection and try again.");
  }
}

/* ── Queue row ───────────────────────────────────────────────────────────── */

function QueueRow({
  row,
  onOpen,
}: {
  row: ObRequest;
  onOpen: () => void;
}) {
  const photos = obPhotos(row);
  const decided = row.Status === OB_STATUS.APPROVED || row.Status === OB_STATUS.DECLINED;

  return (
    <Card as="button" onClick={onOpen} className="w-full p-3.5 text-left">
      <div className="flex items-start gap-3">
        {photos.length > 0 ? (
          <ObPhotoThumb src={photos[0]} index={0} alt="Signed OB form" size={64} />
        ) : (
          <div
            className="w-16 h-16 rounded-[14px] flex items-center justify-center shrink-0"
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >
            <Plane size={20} style={{ color: "var(--text-faint)" }} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13.5px] font-extrabold text-[var(--text)] truncate">
                {obEmployeeName(row)}
              </p>
              <p className="text-[11px] font-semibold text-[var(--text-muted)] truncate">
                {[row.Position, row.Department].filter(Boolean).join(" · ") || row.ReferenceID}
              </p>
            </div>
            <span className="mint-num text-[10.5px] font-bold text-[var(--text-faint)] shrink-0 mt-px">
              {obRelativeDay(row.date_created)}
            </span>
          </div>

          <p className="text-[12px] font-semibold text-[var(--text)] mt-1.5 truncate">
            {row.Destination?.trim() || "Destination not stated"}
          </p>
          <p className="mint-num text-[11px] font-semibold text-[var(--text-muted)]">
            {row.DateOfOB ? formatObDate(row.DateOfOB) : "No date of OB"}
            {photos.length > 1 && ` · ${photos.length} images`}
          </p>

          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <ObStatusBadge status={row.Status} size="sm" />
            {row.IsLateFiling && <LateFilingBadge />}
          </div>
        </div>
      </div>

      {decided && row.ReviewedBy && (
        <p
          className="text-[10.5px] font-semibold mt-2.5 pt-2.5 leading-snug"
          style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}
        >
          {row.Status} by {row.ReviewedBy} · {formatObDateTime(row.ReviewedAt)}
        </p>
      )}
    </Card>
  );
}

/* ── Detail + review panel ───────────────────────────────────────────────── */

function ReviewDetail({
  row,
  onBack,
  onReviewed,
}: {
  row: ObRequest;
  onBack: () => void;
  onReviewed: (id: number | string, next: string) => void;
}) {
  const photos = obPhotos(row);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const status = row.Status || OB_STATUS.PENDING;
  const open = status === OB_STATUS.PENDING || status === OB_STATUS.FOR_COO;

  const decide = async (action: string) => {
    if (action === OB_STATUS.DECLINED && !notes.trim()) {
      toast.error("Add a reason so the agent knows what to fix.");
      return;
    }

    setBusy(action);
    try {
      const res = await reviewObRequest({ requestId: row.id, action, notes });
      toast.success(res.message, {
        description: res.notified === false ? "Saved, but the notification email did not send." : undefined,
      });
      setNotes("");
      onReviewed(row.id, action);
    } catch (err: any) {
      toast.error(err?.message || "Could not save the review.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl">
      {/* Back */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 min-h-[40px] px-3 -ml-3 rounded-[13px] text-[12.5px] font-extrabold transition-colors"
        style={{ color: "var(--mint-strong)" }}
      >
        <ChevronLeft size={17} /> Back to queue
      </button>

      <ObCard className="mt-2">
        {/* Employee */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-[14px] font-black text-white shrink-0"
            style={{ background: "var(--mint-btn)" }}
          >
            {obEmployeeInitials(row)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-extrabold text-[var(--text)] truncate">
              {obEmployeeName(row)}
            </p>
            <p className="text-[11.5px] font-semibold text-[var(--text-muted)] truncate">
              {[row.Position, row.Department].filter(Boolean).join(" · ") || "—"}
            </p>
            <p className="mint-num text-[11px] font-bold text-[var(--text-faint)] mt-0.5">
              {row.ReferenceID} · filed {obRelativeDay(row.date_created)}
            </p>
          </div>
          <ObStatusBadge status={row.Status} />
        </div>

        {row.IsLateFiling && (
          <div className="mb-3.5 flex items-start gap-2.5 rounded-[var(--r-card)] p-3" style={{ background: "var(--hint-bg)" }}>
            <AlertTriangle size={14} style={{ color: "var(--hint-text)" }} className="shrink-0 mt-px" />
            <p className="text-[11.5px] font-bold leading-relaxed" style={{ color: "var(--hint-text)" }}>
              Late filing — less than one (1) day of notice. Guideline 3 expects a
              justification, so check the agent&apos;s reason below before deciding.
            </p>
          </div>
        )}

        {/* The artifact */}
        {photos.length > 0 ? (
          <>
            <p className="text-[10.5px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] mb-2">
              Signed form{photos.length > 1 ? ` · ${photos.length} images` : ""}
            </p>
            <div className="grid grid-cols-3 gap-2.5 mb-1.5">
              {photos.map((src, i) => (
                <ObPhotoThumb
                  key={src}
                  src={src}
                  index={i}
                  alt={`Signed OB form ${i + 1}`}
                  size={i === 0 ? 140 : 96}
                  onOpen={() => setViewerIndex(i)}
                />
              ))}
            </div>
            <p className="text-[10.5px] font-semibold text-[var(--text-faint)] text-center">
              Tap to zoom · check that all four signatures are legible
            </p>
          </>
        ) : (
          <ObNote label="No photo" tone="alert">
            No image is attached, so the signatures cannot be verified. This should not have been
            submittable.
          </ObNote>
        )}

        <ObDivider />

        <ObDetailRow label="Destination" value={row.Destination} />
        <ObDivider />
        <ObDetailRow label="Date of OB" value={row.DateOfOB ? formatObDate(row.DateOfOB) : undefined} />
        <ObDivider />
        <ObDetailRow label="Date filed" value={formatObDateTime(row.date_created)} />
        {row.PurposeOfTravel?.trim() && (
          <>
            <ObDivider />
            <div className="py-2.5">
              <p className="text-[11.5px] font-bold text-[var(--text-muted)] mb-1.5">Purpose of travel</p>
              <p className="text-[12.5px] font-semibold text-[var(--text)] leading-relaxed">
                {row.PurposeOfTravel}
              </p>
            </div>
          </>
        )}
        {row.IsLateFiling && (
          <>
            <ObDivider />
            <div className="py-2.5">
              <p className="text-[11.5px] font-bold text-[var(--text-muted)] mb-1.5">
                Agent&apos;s justification
              </p>
              <ObNote label="Justification" tone="amber">
                {row.Justification?.trim() || "No justification was provided."}
              </ObNote>
            </div>
          </>
        )}
      </ObCard>

      {/* Timeline */}
      <ObCard>
        <ObCardHeader icon={<PlaneTakeoff size={18} />} title="Approval timeline" />
        <ObApprovalTimeline row={row} />

        {row.ReviewedBy && (
          <div className="mt-4 pt-3.5" style={{ borderTop: "1px solid var(--border)" }}>
            <ObNote label="Last reviewed by" tone="neutral">
              <span className="font-extrabold">{row.ReviewedBy}</span>
              {row.ReviewedAt && (
                <span className="font-semibold text-[var(--text-muted)]">
                  {" · "}
                  {formatObDateTime(row.ReviewedAt)}
                </span>
              )}
              {row.ReviewNotes?.trim() && (
                <>
                  <br />
                  <span className="mt-1 block">{row.ReviewNotes}</span>
                </>
              )}
            </ObNote>
          </div>
        )}
      </ObCard>

      {/* Actions */}
      {open ? (
        <ObCard>
          <ObCardHeader
            icon={<ShieldAlert size={18} />}
            title="Review decision"
            subtitle="HRAD decision — the agent is emailed as soon as you decide"
            tone="clay"
          />

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="Review notes — required when declining…"
            className="w-full px-3.5 py-3 rounded-[var(--r-card)] border bg-[var(--card)] text-[12.5px] font-semibold outline-none resize-none"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          />

          {row.IsLateFiling && (
            <p
              className="text-[11px] font-semibold mt-2 flex items-start gap-1.5 leading-relaxed"
              style={{ color: "var(--clay-ink)" }}
            >
              <AlertTriangle size={12} className="shrink-0 mt-px" />
              Filed late — decide on the justification above.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3.5">
            <Button
              size="md"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => decide(OB_STATUS.DECLINED)}
              icon={busy === OB_STATUS.DECLINED ? undefined : <X size={16} />}
            >
              {busy === OB_STATUS.DECLINED ? "Declining…" : "Decline"}
            </Button>

            <Button
              size="md"
              full
              disabled={busy !== null}
              loading={busy === OB_STATUS.APPROVED}
              onClick={() => decide(OB_STATUS.APPROVED)}
              icon={busy === OB_STATUS.APPROVED ? undefined : <Check size={16} />}
            >
              {busy === OB_STATUS.APPROVED ? "Approving…" : "Approve"}
            </Button>
          </div>
        </ObCard>
      ) : (
        <ObCard className="text-center py-6">
          <p className="text-[13px] font-extrabold text-[var(--text)]">
            This request is closed
          </p>
          <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-1 leading-relaxed">
            {row.ReviewedBy
              ? `${row.Status} by ${row.ReviewedBy} on ${formatObDate(row.ReviewedAt)}. Decisions are final.`
              : "Already decided. Decisions are final."}
          </p>
        </ObCard>
      )}

      {viewerIndex !== null && (
        <ObImageViewer
          images={photos}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function ObApprovalsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("pending");
  const [rows, setRows] = useState<ObRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<ObRequest | null>(null);
  const live = useRef(true);

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    setError("");
    setForbidden(false);
    try {
      const res = await fetch(`/api/ob-request?scope=queue&filter=${f}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) {
        setForbidden(true);
        setRows([]);
        return;
      }
      if (!res.ok) {
        setError(data?.error || "Could not load OB requests.");
        return;
      }
      if (!live.current) return;
      setRows(Array.isArray(data.requests) ? data.requests : []);
      if (data.counts) setCounts(data.counts);
    } catch {
      if (live.current) setError("Network problem. Check your connection.");
    } finally {
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    setSelected(null);
    load(filter);
    return () => {
      live.current = false;
    };
  }, [filter, load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.Name, r.ReferenceID, r.Destination, r.Department, r.Position, r.PurposeOfTravel]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, search]);

  /* Requests whose HRAD email bounced. If auto-send is off, EmailStatus is
     NULL and must NOT be counted — a deliberate configuration is not a
     failure, and showing the banner for it would cry wolf on every request. */
  const failedEmails = useMemo(
    () => rows.filter((r) => (r as any).EmailStatus === "failed").length,
    [rows]
  );

  const onReviewed = (id: number | string, next: string) => {
    setSelected(null);
    setRows((r) => r.filter((x) => String(x.id) !== String(id)));
    setCounts((c) => ({
      ...c,
      pending: Math.max(0, (c.pending || 0) - (next === OB_STATUS.APPROVED || next === OB_STATUS.DECLINED ? 1 : 0)),
      approved: (c.approved || 0) + (next === OB_STATUS.APPROVED ? 1 : 0),
      declined: (c.declined || 0) + (next === OB_STATUS.DECLINED ? 1 : 0),
    }));
  };

  /* ── Detail view ──────────────────────────────────────────────────────── */
  if (selected) {
    return (
      <div className="mint-ui mint-scope">
        <ReviewDetail row={selected} onBack={() => setSelected(null)} onReviewed={onReviewed} />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mint-ui mint-scope flex flex-col items-center justify-center text-center px-6 py-16">
        <div
          className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
          style={{ background: "var(--alert-soft)", color: "var(--alert)" }}
        >
          <ShieldAlert size={28} />
        </div>
        <p className="text-[16px] font-black text-[var(--text)]">Access denied</p>
        <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 max-w-[320px] leading-relaxed">
          OB requests are reviewed by HRAD or a Super Admin. Agents can see their own
          requests under OB Request → My OB Requests.
        </p>
      </div>
    );
  }

  if (loading && rows.length === 0) return <LoadingSkeleton />;
  if (error && rows.length === 0) return <ErrorOverlay message={error} onRetry={() => load(filter)} />;

  return (
    <div className="mint-ui mint-scope">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-black text-[var(--text)] leading-tight tracking-tight">
            OB Approvals
          </h1>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 leading-snug">
            Review the signed Request for Official Business Trip forms
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => exportToExcel(visible, filter)}
          icon={<FileSpreadsheet size={16} />}
        >
          Export to Excel
        </Button>
      </div>

      {/* Filters + search */}
      <div className="flex items-center gap-2.5 flex-wrap mb-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const n = counts[f.key] || 0;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className="min-h-[42px] px-4 rounded-full text-[12.5px] font-extrabold border transition-all active:scale-95 flex items-center gap-1.5 shrink-0"
                style={{
                  background: active ? "var(--mint-btn)" : "var(--card)",
                  color: active ? "#fff" : "var(--text-muted)",
                  borderColor: active ? "transparent" : "var(--border)",
                }}
              >
                {f.label}
                {n > 0 && (
                  <span
                    className="min-w-[19px] h-[19px] px-1 rounded-full flex items-center justify-center text-[10px] font-black"
                    style={{
                      background: active ? "rgba(255,255,255,.24)" : "var(--mint-soft)",
                      color: active ? "#fff" : "var(--mint-strong)",
                    }}
                  >
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <label
          className="flex items-center gap-2.5 h-[42px] px-3.5 rounded-full border flex-1 min-w-[180px] max-w-xs"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <Search size={15} style={{ color: "var(--text-faint)" }} className="shrink-0" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, destination…"
            className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] font-semibold"
            style={{ color: "var(--text)" }}
          />
        </label>
      </div>

      {/* Email delivery failures */}
      {failedEmails > 0 && (
        <div
          className="flex items-start gap-2.5 rounded-[var(--r-card)] p-3.5 mb-4"
          style={{ background: "var(--hint-bg)", border: "1px solid rgba(245,158,11,.3)" }}
        >
          <AlertTriangle size={16} style={{ color: "var(--hint-text)" }} className="shrink-0 mt-px" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-extrabold" style={{ color: "var(--hint-text)" }}>
              {failedEmails} OB email{failedEmails === 1 ? "" : "s"} failed to send
            </p>
            <p className="text-[11.5px] font-semibold mt-0.5 leading-relaxed" style={{ color: "var(--hint-text)" }}>
              HRAD may not have been notified. Check the recipients and sender in Email Config.
            </p>
            <button
              type="button"
              onClick={() => router.push("/admin/email-config")}
              className="text-[11.5px] font-extrabold mt-2 min-h-[32px] px-2.5 rounded-[10px]"
              style={{ background: "rgba(245,158,11,.2)", color: "var(--hint-text)" }}
            >
              Open Email Config
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center text-center px-6 py-14">
          <div
            className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
            style={{ background: "var(--mint-soft)", color: "var(--mint)" }}
          >
            {search ? <Search size={26} /> : <Inbox size={26} />}
          </div>
          <p className="text-[15px] font-extrabold text-[var(--text)]">
            {search ? "No matches" : `No ${filter === "all" ? "" : FILTERS.find((f) => f.key === filter)?.label.toLowerCase() || ""} OB requests`}
          </p>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 max-w-[300px] leading-relaxed">
            {search
              ? "Try a different name, reference ID or destination."
              : filter === "pending"
                ? "You're all caught up. New requests arrive here as agents file them."
                : "Nothing has been filed in this category yet."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {visible.map((row) => (
            <QueueRow key={row.id} row={row} onOpen={() => setSelected(row)} />
          ))}
        </div>
      )}

      {loading && rows.length > 0 && (
        <p className="flex items-center justify-center gap-2 mt-4 text-[11.5px] font-semibold" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={13} className="animate-spin" />
          Refreshing…
        </p>
      )}
    </div>
  );
}