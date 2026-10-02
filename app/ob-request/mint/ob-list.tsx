"use client";

/* ============================================================================
   OB REQUEST · Tab B — My OB Requests
   ----------------------------------------------------------------------------
   History list, plus a full detail view. The detail view is the same component
   the admin queue reuses for its read-only half, so the agent sees precisely the
   record the reviewer sees.
   ========================================================================== */

import React, { useMemo, useState } from "react";
import {
  Briefcase,
  CalendarDays,
  ChevronRight,
  FileText,
  Inbox,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  obPhotos,
  obEmployeeName,
  obRelativeDay,
  formatObDate,
  formatObDateTime,
  OB_STATUS,
  normaliseObStatus,
  isOpenStatus,
  type ObRequest,
} from "@/lib/ob-requests";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/app/activity-planner/mint/ui";
import {
  LateFilingBadge,
  ObApprovalTimeline,
  ObCard,
  ObCardHeader,
  ObDetailRow,
  ObDivider,
  ObNote,
  ObPhotoThumb,
  ObSectionHeading,
  ObStatusBadge,
  ObTripSummary,
} from "./ob-shared";
import ObImageViewer from "./image-viewer";

/* ── List ───────────────────────────────────────────────────────────────── */

export function ObHistoryTab({
  requests,
  loading,
  error,
  refreshing,
  onRetry,
  onNewRequest,
  onOpen,
}: {
  requests: ObRequest[];
  loading: boolean;
  error: string | null;
  refreshing?: boolean;
  onRetry: () => void;
  onNewRequest: () => void;
  onOpen: (row: ObRequest) => void;
}) {
  const [filter, setFilter] = useState<"all" | "open" | "approved" | "declined">("all");

  const counts = useMemo(() => {
    return {
      all: requests.length,
      open: requests.filter((r) => isOpenStatus(r.Status)).length,
      approved: requests.filter((r) => normaliseObStatus(r.Status) === OB_STATUS.APPROVED).length,
      declined: requests.filter((r) => normaliseObStatus(r.Status) === OB_STATUS.DECLINED).length,
    };
  }, [requests]);

  const visible = useMemo(() => {
    switch (filter) {
      case "open":
        return requests.filter((r) => isOpenStatus(r.Status));
      case "approved":
        return requests.filter((r) => normaliseObStatus(r.Status) === OB_STATUS.APPROVED);
      case "declined":
        return requests.filter((r) => normaliseObStatus(r.Status) === OB_STATUS.DECLINED);
      default:
        return requests;
    }
  }, [requests, filter]);

  if (loading && requests.length === 0) {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-[var(--r-card-lg)]" />
        ))}
      </div>
    );
  }

  if (error && requests.length === 0) {
    return <ErrorState message={error} onRetry={onRetry} />;
  }

  const chips: Array<{ key: typeof filter; label: string; n: number }> = [
    { key: "all", label: "All", n: counts.all },
    { key: "open", label: "Open", n: counts.open },
    { key: "approved", label: "Approved", n: counts.approved },
    { key: "declined", label: "Declined", n: counts.declined },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-4 px-4">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            aria-pressed={filter === c.key}
            className="shrink-0 min-h-[36px] px-3.5 rounded-full text-[12px] font-extrabold border transition-all active:scale-95"
            style={
              filter === c.key
                ? { background: "var(--mint-btn)", color: "#fff", borderColor: "transparent" }
                : { background: "var(--card)", color: "var(--text-muted)", borderColor: "var(--border)" }
            }
          >
            {c.label}
            <span className="ml-1.5 opacity-70">{c.n}</span>
          </button>
        ))}

        {refreshing && (
          <RefreshCw size={14} className="animate-spin shrink-0 ml-auto" style={{ color: "var(--mint)" }} />
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Inbox size={28} />}
          title={requests.length === 0 ? "No OB requests yet" : "Nothing in this filter"}
          message={
            requests.length === 0
              ? "When you have a signed ROBT form, photograph it here and submit it for approval."
              : "Try a different filter to see your other requests."
          }
          ctaLabel="Submit an OB request"
          onCta={onNewRequest}
        />
      ) : (
        <div className="space-y-2.5">
          {visible.map((row) => (
            <ObListRow key={row.id} row={row} onOpen={() => onOpen(row)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ObListRow({ row, onOpen }: { row: ObRequest; onOpen: () => void }) {
  const photos = obPhotos(row);
  const open = isOpenStatus(row.Status);

  return (
    <Card as="button" onClick={onOpen} className="w-full p-3.5 text-left">
      <div className="flex items-start gap-3">
        {/* First photo doubles as the thumbnail */}
        {photos.length > 0 ? (
          <ObPhotoThumb src={photos[0]} index={0} alt="OB form" size={60} />
        ) : (
          <div
            className="w-[60px] h-[60px] rounded-[14px] flex items-center justify-center shrink-0"
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >
            <FileText size={20} style={{ color: "var(--text-faint)" }} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="text-[13px] font-extrabold text-[var(--text)] leading-tight truncate">
              {row.Destination?.trim() || "OB request"}
            </p>
            <span className="mint-num text-[10.5px] font-bold text-[var(--text-faint)] shrink-0 mt-px">
              {obRelativeDay(row.date_created)}
            </span>
          </div>

          <ObTripSummary row={row} />

          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <ObStatusBadge status={row.Status} size="sm" />
            {row.IsLateFiling && <LateFilingBadge />}
            {photos.length > 1 && (
              <span className="text-[10px] font-bold text-[var(--text-faint)]">
                +{photos.length - 1} more
              </span>
            )}
          </div>
        </div>

        <ChevronRight size={16} className="text-[var(--text-faint)] shrink-0 mt-1" />
      </div>

      {open && row.Status === OB_STATUS.FOR_COO && (
        <p
          className="text-[10.5px] font-semibold mt-2.5 pt-2.5 leading-snug"
          style={{ color: "var(--violet-ink)", borderTop: "1px solid var(--border)" }}
        >
          Filed late — justification attached, awaiting HRAD review.
        </p>
      )}
    </Card>
  );
}

/* ── Detail ─────────────────────────────────────────────────────────────── */

/**
 * Read-only detail. `showEmployee` is on for the agent's own view; the admin
 * queue reuses this with the employee block already rendered in its header.
 */
export function ObDetail({
  row,
  onBack,
  onSubmitAnother,
  footer,
}: {
  row: ObRequest;
  onBack: () => void;
  onSubmitAnother?: () => void;
  footer?: React.ReactNode;
}) {
  const photos = obPhotos(row);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const status = normaliseObStatus(row.Status);

  return (
    <div className="space-y-4">
      {/* Header card */}
      <ObCard>
        <div className="flex items-start justify-between gap-3 mb-3.5">
          <div className="min-w-0">
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Request for Official Business Trip
            </p>
            <p className="text-[16px] font-black text-[var(--text)] leading-tight mt-1 truncate">
              {row.Destination?.trim() || "Destination not stated"}
            </p>
          </div>
          <ObStatusBadge status={row.Status} />
        </div>

        {row.IsLateFiling && (
          <div className="mb-3">
            <LateFilingBadge />
          </div>
        )}

        {/* Photos */}
        {photos.length > 0 ? (
          <div>
            <ObSectionHeading>
              Signed form{photos.length > 1 ? ` · ${photos.length} images` : ""}
            </ObSectionHeading>
            <div className="grid grid-cols-3 gap-2.5">
              {photos.map((src, i) => (
                <ObPhotoThumb
                  key={src}
                  src={src}
                  index={i}
                  alt={`OB form image ${i + 1}`}
                  size={96}
                  onOpen={() => setViewerIndex(i)}
                />
              ))}
            </div>
            <p className="text-[10.5px] font-semibold text-[var(--text-faint)] mt-2 text-center">
              Tap a photo to zoom
            </p>
          </div>
        ) : (
          <ObNote label="No photo" tone="alert">
            This request has no image attached, so there is nothing for a reviewer to approve.
          </ObNote>
        )}
      </ObCard>

      {/* Trip details */}
      <ObCard>
        <ObCardHeader icon={<Briefcase size={18} />} title="Trip details" />

        <ObDetailRow
          label="Name"
          value={obEmployeeName(row)}
          icon={<FileText size={13} />}
        />
        <ObDivider />
        <ObDetailRow label="Position" value={row.Position} />
        <ObDivider />
        <ObDetailRow label="Department" value={row.Department} />
        <ObDivider />
        <ObDetailRow
          label="Destination"
          value={row.Destination}
          icon={<MapPin size={13} />}
        />
        <ObDivider />
        <ObDetailRow
          label="Date of OB"
          value={row.DateOfOB ? formatObDate(row.DateOfOB) : undefined}
          icon={<CalendarDays size={13} />}
        />
        <ObDivider />
        <ObDetailRow label="Date filed" value={formatObDate(row.date_created)} />
        <ObDivider />
        <ObDetailRow label="Reference ID" value={row.ReferenceID} mono />

        {row.PurposeOfTravel?.trim() && (
          <>
            <ObDivider />
            <div className="py-2.5">
              <p className="text-[11.5px] font-bold text-[var(--text-muted)] mb-1.5">
                Purpose of travel
              </p>
              <p className="text-[12.5px] font-semibold text-[var(--text)] leading-relaxed">
                {row.PurposeOfTravel}
              </p>
            </div>
          </>
        )}
      </ObCard>

      {/* Justification */}
      {row.IsLateFiling && (
        <ObCard>
          <ObCardHeader
            icon={<ShieldCheck size={18} />}
            title="Late-filing justification"
            subtitle="Required by guideline 3"
            tone="clay"
          />
          <ObNote label="Your explanation" tone="amber">
            {row.Justification?.trim() || "No justification was provided."}
          </ObNote>
        </ObCard>
      )}

      {/* Timeline */}
      <ObCard>
        <ObCardHeader icon={<ShieldCheck size={18} />} title="Approval timeline" />
        <ObApprovalTimeline row={row} />

        {row.ReviewedBy && (
          <div className="mt-4 pt-3.5" style={{ borderTop: "1px solid var(--border)" }}>
            <ObNote
              label={status === OB_STATUS.APPROVED ? "Approved by" : "Reviewed by"}
              tone={status === OB_STATUS.APPROVED ? "mint" : status === OB_STATUS.DECLINED ? "alert" : "neutral"}
            >
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

        {!row.ReviewedBy && (
          <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-4 leading-relaxed">
            Waiting on HRAD to review your signed form.
          </p>
        )}
      </ObCard>

      {/* Actions */}
      <div className="flex gap-2.5 pb-2">
        {onSubmitAnother && (
          <Button
            variant="secondary"
            size="md"
            className="flex-1"
            onClick={onSubmitAnother}
            icon={<Plus size={17} />}
          >
            Submit another OB
          </Button>
        )}
        <Button variant="ghost" size="md" onClick={onBack} icon={<ChevronRight size={17} className="rotate-180" />}>
          Back
        </Button>
      </div>

      {footer}

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