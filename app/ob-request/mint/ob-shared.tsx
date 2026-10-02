"use client";

/* ============================================================================
   OB REQUEST — shared presentation pieces
   ----------------------------------------------------------------------------
   Status badges, the form field kit, the guidelines box, photo thumbnails and
   the approval timeline. Used by the submit tab, the history tab, the detail
   screen and the admin queue so an OB request looks identical everywhere.

   Built from the Calm Mint primitives in app/activity-planner/mint/ui.tsx —
   no bespoke design tokens beyond the --violet* ramp added for "For COO".
   ========================================================================== */

import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Flag,
  ImageOff,
  Info,
  MapPin,
  Plane,
  X,
} from "lucide-react";
import { cx, SectionLabel } from "@/app/activity-planner/mint/ui";
import {
  OB_GUIDELINES,
  OB_PHOTO_HINT,
  OB_STATUS,
  formatObDate,
  formatObDateTime,
  normaliseObStatus,
  obStatusTone,
  type ObRequest,
} from "@/lib/ob-requests";

/* ── Status badge ────────────────────────────────────────────────────────────
   Amber / green / red / violet, driven by lib/ob-requests so the admin queue
   and the agent's history cannot disagree about what a status looks like. */

const STATUS_ICON = {
  clock: Clock3,
  check: CheckCircle2,
  x: X,
  flag: Flag,
} as const;

export function ObStatusBadge({
  status,
  size = "md",
  className,
}: {
  status?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const tone = obStatusTone(status);
  const Icon = STATUS_ICON[tone.Icon];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full font-extrabold whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        className
      )}
      style={{ background: tone.bg, color: tone.fg }}
    >
      <Icon size={size === "sm" ? 10 : 12} strokeWidth={2.6} />
      {tone.label}
    </span>
  );
}

/** "Late filing" chip — separate from status, because it can co-exist with any. */
export function LateFilingBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold whitespace-nowrap",
        className
      )}
      style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
    >
      <AlertTriangle size={10} strokeWidth={2.6} />
      Late filing
    </span>
  );
}

/* ── Card header ─────────────────────────────────────────────────────────── */

export function ObCardHeader({
  icon,
  title,
  subtitle,
  right,
  tone = "mint",
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  tone?: "mint" | "clay" | "info" | "violet";
}) {
  const map = {
    mint: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
    clay: { bg: "var(--clay-soft)", fg: "var(--clay-ink)" },
    info: { bg: "var(--info-soft)", fg: "var(--info)" },
    violet: { bg: "var(--violet-soft)", fg: "var(--violet-ink)" },
  }[tone];

  return (
    <div className="flex items-center gap-3 mb-4">
      <div
        className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
        style={{ background: map.bg, color: map.fg }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-extrabold text-[var(--text)] leading-tight">{title}</p>
        {subtitle && (
          <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

export function ObCard({
  children,
  className,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "rounded-[var(--r-card-lg)] border p-4",
        "bg-[var(--card)] border-[var(--border)] shadow-[var(--sh-card)]",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── Field kit ───────────────────────────────────────────────────────────── */

const FIELD_SHELL =
  "w-full rounded-[14px] border px-3.5 text-[13px] font-semibold outline-none transition-colors";

export function ObLabel({
  children,
  required,
  hint,
}: {
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5 mb-1.5">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {children}
      </span>
      {required && <span className="text-[10.5px] font-black text-[var(--alert)]">*</span>}
      {hint && (
        <span className="text-[10px] font-bold text-[var(--text-faint)] normal-case tracking-normal ml-auto">
          {hint}
        </span>
      )}
    </span>
  );
}

/**
 * Auto-filled field from the signed-in profile. Disabled on purpose — the
 * values come from the users table and are re-copied server-side, so letting
 * anyone type here would only create a value that disagrees with the database.
 */
export function ObAutoField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <ObLabel>{label}</ObLabel>
      <div
        className={cx(FIELD_SHELL, "flex items-center min-h-[48px] cursor-not-allowed")}
        style={{
          borderColor: "var(--border)",
          background: "var(--bg)",
          color: "var(--text-muted)",
        }}
        aria-disabled
        title="Taken from your profile — not editable"
      >
        <span className="truncate">{value?.trim() || "—"}</span>
      </div>
    </div>
  );
}

export function ObInput({
  label,
  value,
  onChange,
  placeholder,
  required,
  hint,
  icon,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  icon?: React.ReactNode;
  type?: string;
}) {
  return (
    <label className="block">
      <ObLabel required={required} hint={hint}>
        {label}
      </ObLabel>
      <div className="relative">
        {icon && (
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--text-faint)" }}
          >
            {icon}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cx(FIELD_SHELL, "min-h-[48px]", icon ? "pl-9" : "")}
          style={{
            borderColor: "var(--border-strong)",
            background: "var(--card)",
            color: "var(--text)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--mint)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border-strong)";
          }}
        />
      </div>
    </label>
  );
}

export function ObDateField({
  label,
  value,
  onChange,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  required?: boolean;
}) {
  return (
    <ObInput
      label={label}
      type="date"
      value={value}
      onChange={onChange}
      required={required}
      hint={hint}
      icon={<Plane size={14} />}
    />
  );
}

export function ObTextarea({
  label,
  value,
  onChange,
  placeholder,
  required,
  rows = 3,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <ObLabel required={required} hint={maxLength ? `${value.length}/${maxLength}` : undefined}>
        {label}
      </ObLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className={cx(FIELD_SHELL, "py-3 leading-relaxed resize-none")}
        style={{
          borderColor: "var(--border-strong)",
          background: "var(--card)",
          color: "var(--text)",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--mint)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--border-strong)";
        }}
      />
    </label>
  );
}

/* ── Guidelines box (amber, collapsible) ────────────────────────────────── */

export function ObGuidelinesBox({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="rounded-[var(--r-card-lg)] border overflow-hidden"
      style={{ background: "var(--hint-bg)", borderColor: "rgba(245,158,11,.28)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-4 py-3.5 text-left"
      >
        <Info size={16} style={{ color: "var(--hint-text)" }} className="shrink-0" />
        <span className="flex-1 min-w-0">
          <span
            className="block text-[12.5px] font-extrabold"
            style={{ color: "var(--hint-text)" }}
          >
            Filing guidelines
          </span>
          <span
            className="block text-[11px] font-semibold opacity-80 leading-snug"
            style={{ color: "var(--hint-text)" }}
          >
            3 rules from the ROBT form
          </span>
        </span>
        <ChevronDown
          size={17}
          style={{ color: "var(--hint-text)" }}
          className={cx("shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <ol className="px-4 pb-4 pt-0 space-y-2">
          {OB_GUIDELINES.map((g, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className="shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-black mt-px"
                style={{ background: "rgba(245,158,11,.25)", color: "var(--hint-text)" }}
              >
                {i + 1}
              </span>
              <span
                className="text-[12px] font-semibold leading-relaxed"
                style={{ color: "var(--hint-text)" }}
              >
                {g}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ── Photo hint ─────────────────────────────────────────────────────────── */

export function ObPhotoHint() {
  return (
    <div
      className="flex items-start gap-2.5 rounded-[var(--r-card)] p-3"
      style={{ background: "var(--info-soft)" }}
    >
      <Info size={14} style={{ color: "var(--info)" }} className="shrink-0 mt-px" />
      <p className="text-[11.5px] font-semibold leading-relaxed" style={{ color: "var(--info)" }}>
        {OB_PHOTO_HINT}
      </p>
    </div>
  );
}

/* ── Photo thumbnail ────────────────────────────────────────────────────── */

export function ObPhotoThumb({
  src,
  alt,
  onRemove,
  onOpen,
  index,
  size = 96,
}: {
  src: string;
  alt: string;
  onRemove?: () => void;
  onOpen?: () => void;
  index: number;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View ${alt} full size`}
        className="block w-full overflow-hidden rounded-[14px]"
        style={{ border: "1px solid var(--border)", height: size }}
      >
        {broken ? (
          <span
            className="w-full h-full flex flex-col items-center justify-center gap-1"
            style={{ background: "var(--bg)", color: "var(--text-faint)" }}
          >
            <ImageOff size={18} />
            <span className="text-[9px] font-extrabold">Unavailable</span>
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            onError={() => setBroken(true)}
            className="w-full h-full object-cover"
          />
        )}
      </button>

      <span
        className="absolute top-1.5 left-1.5 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-black"
        style={{ background: "rgba(15,23,42,.62)", color: "#fff" }}
      >
        {index + 1}
      </span>

      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${alt}`}
          className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center shadow-sm"
          style={{ background: "var(--alert)" }}
        >
          <X size={13} className="text-white" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/* ── Detail rows ────────────────────────────────────────────────────────── */

export function ObDetailRow({
  label,
  value,
  icon,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      {icon && (
        <span className="shrink-0 mt-0.5" style={{ color: "var(--text-faint)" }}>
          {icon}
        </span>
      )}
      <span className="w-[112px] shrink-0 text-[11.5px] font-bold text-[var(--text-muted)] leading-snug">
        {label}
      </span>
      <span
        className={cx(
          "flex-1 min-w-0 text-[12.5px] font-extrabold text-[var(--text)] leading-snug",
          mono && "mint-num"
        )}
      >
        {value || "—"}
      </span>
    </div>
  );
}

export function ObDivider() {
  return <div className="h-px my-1" style={{ background: "var(--border)" }} />;
}

/* ── Approval timeline ──────────────────────────────────────────────────── */

type TimelineStep = {
  key: string;
  label: string;
  detail?: string;
  state: "done" | "current" | "todo" | "failed";
};

/**
 * The approval trail. The chain today is Agent → HRAD: the photo stands in for
 * the employee and Department Head signatures being physically on the paper, so
 * there are only two real steps. COO sign-off on late filings is a later phase
 * and is not drawn here yet.
 */
export function ObApprovalTimeline({ row }: { row: ObRequest }) {
  const status = normaliseObStatus(row.Status);
  const filed = Boolean(row.date_created);
  const decided = status === OB_STATUS.APPROVED || status === OB_STATUS.DECLINED;

  const steps: TimelineStep[] = [
    {
      key: "filed",
      label: "Signed form uploaded",
      detail: row.date_created
        ? `${formatObDateTime(row.date_created)}${row.IsLateFiling ? " · filed late" : ""}`
        : undefined,
      state: filed ? "done" : "todo",
    },
    {
      key: "hrad",
      label: "HRAD review",
      detail: decided
        ? status === OB_STATUS.APPROVED
          ? "Received and recorded"
          : "Not approved"
        : row.IsLateFiling
          ? "Late filing — justification attached"
          : "Awaiting decision",
      state: decided ? (status === OB_STATUS.APPROVED ? "done" : "failed") : "current",
    },
  ];

  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const isLast = i === steps.length - 1;
        const dot =
          s.state === "done"
            ? { bg: "var(--mint)", ring: "var(--mint-soft)" }
            : s.state === "current"
              ? { bg: "var(--hint-bg)", ring: "#f59e0b" }
              : s.state === "failed"
                ? { bg: "var(--alert)", ring: "var(--alert-soft)" }
                : { bg: "var(--border-strong)", ring: "var(--bg)" };

        const labelColor =
          s.state === "done"
            ? "var(--text)"
            : s.state === "current"
              ? "var(--hint-text)"
              : s.state === "failed"
                ? "var(--alert-ink)"
                : "var(--text-faint)";

        return (
          <li key={s.key} className="flex gap-3">
            {/* rail */}
            <div className="flex flex-col items-center shrink-0" style={{ width: 22 }}>
              <span
                className="w-[15px] h-[15px] rounded-full flex items-center justify-center shrink-0"
                style={{ background: dot.bg, boxShadow: `0 0 0 4px ${dot.ring}` }}
              >
                {s.state === "done" ? (
                  <CheckCircle2 size={9} className="text-white" strokeWidth={3.5} />
                ) : s.state === "current" ? (
                  <Clock3 size={9} style={{ color: "#b45309" }} strokeWidth={3.5} />
                ) : s.state === "failed" ? (
                  <X size={9} className="text-white" strokeWidth={3.5} />
                ) : null}
              </span>
              {!isLast && (
                <span className="flex-1 w-[2px] my-1" style={{ background: "var(--border)" }} />
              )}
            </div>

            <div className={cx("flex-1 min-w-0", isLast ? "pb-0" : "pb-4")}>
              <p className="text-[12.5px] font-extrabold leading-tight" style={{ color: labelColor }}>
                {s.label}
              </p>
              {s.detail && (
                <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
                  {s.detail}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Reviewer notes / justification ─────────────────────────────────────── */

export function ObNote({
  label,
  children,
  tone = "mint",
  icon,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "mint" | "amber" | "alert" | "neutral";
  icon?: React.ReactNode;
}) {
  const map = {
    mint: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
    amber: { bg: "var(--hint-bg)", fg: "var(--hint-text)" },
    alert: { bg: "var(--alert-soft)", fg: "var(--alert-ink)" },
    neutral: { bg: "var(--bg)", fg: "var(--text-muted)" },
  }[tone];

  return (
    <div className="rounded-[var(--r-card)] p-3" style={{ background: map.bg }}>
      <p
        className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.12em] mb-1.5"
        style={{ color: map.fg }}
      >
        {icon}
        {label}
      </p>
      <p className="text-[12.5px] font-semibold leading-relaxed" style={{ color: "var(--text)" }}>
        {children}
      </p>
    </div>
  );
}

/* ── Summary strip reused by list rows ──────────────────────────────────── */

export function ObTripSummary({ row }: { row: ObRequest }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[var(--text)]">
        <MapPin size={13} className="shrink-0" style={{ color: "var(--clay)" }} />
        <span className="truncate">{row.Destination?.trim() || "Destination not stated"}</span>
      </p>
      <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[var(--text-muted)]">
        <Plane size={12} className="shrink-0" style={{ color: "var(--text-faint)" }} />
        {row.DateOfOB ? formatObDate(row.DateOfOB) : "No date of OB"}
      </p>
    </div>
  );
}

/* ── Section heading used inside the page body ─────────────────────────── */

export function ObSectionHeading({ children }: { children: React.ReactNode }) {
  return <SectionLabel className="mb-2.5 block">{children}</SectionLabel>;
}