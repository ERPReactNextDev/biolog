"use client";

/* ============================================================================
   BIOLOG · "Calm Mint" — shared component library
   ----------------------------------------------------------------------------
   Every screen in app/activity-planner is built from these primitives, so the
   whole app stays visually consistent. Icons are lucide-react, chosen to match
   the Remix Icon line style (no new dependency).
   ========================================================================== */

import React from "react";
import { AlertCircle, ChevronRight, Inbox, Loader2, WifiOff } from "lucide-react";
import { haptic } from "@/lib/haptics";

export const cx = (...c: Array<string | false | null | undefined>) =>
  c.filter(Boolean).join(" ");

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  className,
  children,
  onClick,
  as = "div",
  ...rest
}: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  as?: "div" | "button";
} & React.HTMLAttributes<HTMLElement>) {
  const base =
    "bg-[var(--card)] border border-[var(--border)] rounded-[var(--r-card-lg)] shadow-[var(--sh-card)]";

  if (as === "button" || onClick) {
    return (
      <button
        type="button"
        onClick={() => {
          haptic("light");
          onClick?.();
        }}
        className={cx(base, "mint-tap w-full text-left active:bg-[var(--mint-soft)]", className)}
        {...rest}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={cx(base, className)} {...rest}>
      {children}
    </div>
  );
}

/** Section label — small, uppercase, tracked-out. */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cx(
        "text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)]",
        className
      )}
    >
      {children}
    </p>
  );
}

/** Card title + optional supporting line. */
export function CardTitle({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[15px] font-extrabold text-[var(--text)] leading-tight">
          {title}
        </h3>
        {subtitle && (
          <p className="text-[12px] font-medium text-[var(--text-muted)] mt-0.5 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

// ── Status pill ──────────────────────────────────────────────────────────────

export type Tone = "mint" | "clay" | "alert" | "info" | "neutral";

const TONE: Record<Tone, { bg: string; fg: string; dot: string }> = {
  mint: { bg: "var(--mint-soft)", fg: "var(--mint-strong)", dot: "var(--mint)" },
  clay: { bg: "var(--clay-soft)", fg: "var(--clay-ink)", dot: "var(--clay)" },
  alert: { bg: "var(--alert-soft)", fg: "var(--alert-ink)", dot: "var(--alert)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)", dot: "var(--info)" },
  neutral: { bg: "var(--bg)", fg: "var(--text-muted)", dot: "var(--text-faint)" },
};

export function Pill({
  children,
  tone = "neutral",
  dot,
  pulse,
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold",
        className
      )}
      style={{ background: t.bg, color: t.fg }}
    >
      {dot && (
        <span
          className={cx("w-1.5 h-1.5 rounded-full", pulse && "animate-pulse-soft")}
          style={{ background: t.dot }}
        />
      )}
      {children}
    </span>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

type BtnVariant = "primary" | "clockout" | "secondary" | "ghost" | "danger";

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "lg",
  disabled,
  loading,
  icon,
  full,
  type = "button",
  form,
  className,
  ariaLabel,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  full?: boolean;
  type?: "button" | "submit";
  /** Associates the button with a <form id> so it can submit from outside it. */
  form?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const sizes = {
    sm: "min-h-[40px] px-4 text-[13px] rounded-[14px] gap-1.5",
    md: "min-h-[48px] px-5 text-[14px] rounded-[var(--r-btn)] gap-2",
    lg: "min-h-[56px] px-6 text-[16px] rounded-[20px] gap-2.5",
  }[size];

  const variants: Record<BtnVariant, string> = {
    primary:
      "bg-[var(--mint-btn)] text-white shadow-[var(--sh-btn)] active:bg-[var(--mint-strong)] active:shadow-none",
    clockout:
      "bg-[var(--clay-ink)] text-white shadow-[0_6px_16px_rgba(180,92,56,.3)] active:brightness-95",
    secondary:
      "bg-[var(--card)] text-[var(--text)] border border-[var(--border-strong)] active:bg-[var(--mint-soft)]",
    ghost: "bg-transparent text-[var(--mint-strong)] active:bg-[var(--mint-soft)]",
    danger:
      "bg-[var(--alert-soft)] text-[var(--alert-ink)] border border-[var(--alert)]/25 active:bg-[var(--alert)]/15",
  };

  return (
    <button
      type={type}
      form={form}
      onClick={() => {
        if (disabled || loading) return;
        haptic("medium");
        onClick?.();
      }}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center font-extrabold tracking-tight",
        "transition-all active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mint)]",
        sizes,
        variants[variant],
        full && "w-full",
        className
      )}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** Square 44px icon button used in headers. */
export function IconButton({
  children,
  onClick,
  label,
  className,
  tone = "surface",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
  className?: string;
  tone?: "surface" | "plain";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        haptic("light");
        onClick?.();
      }}
      className={cx(
        "w-11 h-11 rounded-[14px] flex items-center justify-center transition-colors",
        tone === "surface"
          ? "bg-[var(--card)] border border-[var(--border)] text-[var(--text-muted)] active:bg-[var(--mint-soft)]"
          : "text-[var(--text-muted)]",
        className
      )}
    >
      {children}
    </button>
  );
}

// ── Progress ring ────────────────────────────────────────────────────────────

export function ProgressRing({
  value,
  size = 92,
  stroke = 10,
  tone = "var(--mint)",
  track = "var(--mint-soft)",
  children,
}: {
  value: number; // 0-100
  size?: number;
  stroke?: number;
  tone?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <div
      className="relative shrink-0 flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(clamped)} percent`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - (clamped / 100) * circ}
          style={{ transition: "stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

// ── Progress bar ─────────────────────────────────────────────────────────────

export function ProgressBar({
  value,
  tone = "var(--mint)",
  height = 8,
  className,
}: {
  value: number;
  tone?: string;
  height?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cx("w-full rounded-full bg-[var(--mint-soft)] overflow-hidden", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${clamped}%`,
          background: tone,
          transition: "width .7s cubic-bezier(.22,1,.36,1)",
        }}
      />
    </div>
  );
}

// ── Stat tile ────────────────────────────────────────────────────────────────

export function StatTile({
  value,
  label,
  icon,
  tone = "mint",
  hint,
  onClick,
  className,
}: {
  value: React.ReactNode;
  label: string;
  icon?: React.ReactNode;
  tone?: Tone;
  hint?: string;
  onClick?: () => void;
  className?: string;
}) {
  const t = TONE[tone];
  const body = (
    <>
      <div
        className="w-9 h-9 rounded-[12px] flex items-center justify-center mb-2.5"
        style={{ background: t.bg, color: t.fg }}
      >
        {icon}
      </div>
      <p
        className="mint-num text-[24px] font-black leading-none"
        style={{ color: tone === "neutral" ? "var(--text)" : t.fg }}
      >
        {value}
      </p>
      <p className="text-[11px] font-bold text-[var(--text-muted)] mt-1.5 leading-tight">
        {label}
      </p>
      {hint && (
        <p className="text-[10px] font-semibold text-[var(--text-faint)] mt-1 leading-snug">
          {hint}
        </p>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => {
          haptic("light");
          onClick();
        }}
        className={cx(
          "mint-tap text-left rounded-[var(--r-card)] p-3.5 border bg-[var(--card)] border-[var(--border)] shadow-[var(--sh-card)]",
          className
        )}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={cx(
        "rounded-[var(--r-card)] p-3.5 border bg-[var(--card)] border-[var(--border)] shadow-[var(--sh-card)]",
        className
      )}
    >
      {body}
    </div>
  );
}

// ── Row (settings / list navigation) ─────────────────────────────────────────

export function Row({
  icon,
  title,
  subtitle,
  right,
  onClick,
  tone = "mint",
  chevron = true,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  tone?: Tone;
  chevron?: boolean;
  className?: string;
}) {
  const t = TONE[tone];

  const content = (
    <>
      {icon && (
        <div
          className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
          style={{ background: t.bg, color: t.fg }}
        >
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold text-[var(--text)] leading-tight truncate">
          {title}
        </p>
        {subtitle && (
          <p className="text-[11.5px] font-medium text-[var(--text-muted)] mt-0.5 leading-snug">
            {subtitle}
          </p>
        )}
      </div>
      {right}
      {chevron && !right && (
        <ChevronRight size={18} className="text-[var(--text-faint)] shrink-0" />
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => {
          haptic("light");
          onClick();
        }}
        className={cx(
          "mint-tap w-full flex items-center gap-3.5 px-4 py-3.5 text-left",
          className
        )}
      >
        {content}
      </button>
    );
  }
  return <div className={cx("w-full flex items-center gap-3.5 px-4 py-3.5", className)}>{content}</div>;
}

/** Grouped list wrapper that draws the dividers. */
export function RowGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "bg-[var(--card)] border border-[var(--border)] rounded-[var(--r-card-lg)] shadow-[var(--sh-card)] overflow-hidden divide-y divide-[var(--border)]",
        className
      )}
    >
      {children}
    </div>
  );
}

// ── Toggle switch ────────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        haptic("light");
        onChange(!checked);
      }}
      className={cx(
        "w-[52px] h-[30px] rounded-full p-[3px] flex items-center transition-colors shrink-0",
        checked ? "bg-[var(--mint-btn)]" : "bg-[var(--border-strong)]",
        disabled && "opacity-50"
      )}
    >
      <span
        className="w-6 h-6 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? "translateX(22px)" : "translateX(0)" }}
      />
    </button>
  );
}

// ── Filter chip ──────────────────────────────────────────────────────────────

export function Chip({
  children,
  active,
  onClick,
  className,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        haptic("light");
        onClick?.();
      }}
      className={cx(
        "shrink-0 min-h-[38px] px-4 rounded-full text-[12.5px] font-extrabold border transition-all active:scale-95",
        active
          ? "bg-[var(--mint-btn)] text-white border-transparent shadow-[0_4px_12px_rgba(13,150,105,.25)]"
          : "bg-[var(--card)] text-[var(--text-muted)] border-[var(--border)]",
        className
      )}
    >
      {children}
    </button>
  );
}

// ── Hint / advisory banner ───────────────────────────────────────────────────

export function Hint({
  children,
  icon,
  className,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx("flex items-start gap-2.5 rounded-[var(--r-card)] p-3", className)}
      style={{ background: "var(--hint-bg)", color: "var(--hint-text)" }}
    >
      {icon && <span className="shrink-0 mt-px">{icon}</span>}
      <p className="text-[12px] font-bold leading-relaxed">{children}</p>
    </div>
  );
}

// ── States: loading / empty / error / offline ────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("rounded-xl bg-[var(--mint-soft)] animate-pulse", className)} />;
}

/** Every empty state ships a primary CTA — no dead ends. */
export function EmptyState({
  title,
  message,
  ctaLabel,
  onCta,
  icon,
}: {
  title: string;
  message: string;
  ctaLabel: string;
  onCta: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-10">
      <div className="w-16 h-16 rounded-[20px] bg-[var(--mint-soft)] flex items-center justify-center text-[var(--mint)] mb-4">
        {icon ?? <Inbox size={28} />}
      </div>
      <p className="text-[15px] font-extrabold text-[var(--text)]">{title}</p>
      <p className="text-[12.5px] font-medium text-[var(--text-muted)] mt-1.5 max-w-[260px] leading-relaxed">
        {message}
      </p>
      <Button onClick={onCta} className="mt-5" icon={<ChevronRight size={18} />}>
        {ctaLabel}
      </Button>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  title = "Something went wrong",
}: {
  message: string;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-10">
      <div className="w-16 h-16 rounded-[20px] bg-[var(--alert-soft)] flex items-center justify-center text-[var(--alert)] mb-4">
        <AlertCircle size={28} />
      </div>
      <p className="text-[15px] font-extrabold text-[var(--text)]">{title}</p>
      <p className="text-[12.5px] font-medium text-[var(--text-muted)] mt-1.5 max-w-[280px] leading-relaxed">
        {message}
      </p>
      <Button onClick={onRetry} className="mt-5" icon={<Loader2 size={18} />}>
        Try again
      </Button>
    </div>
  );
}

export function OfflineState({ pendingCount }: { pendingCount: number }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-10">
      <div className="w-16 h-16 rounded-[20px] bg-[var(--clay-soft)] flex items-center justify-center text-[var(--clay-ink)] mb-4">
        <WifiOff size={28} />
      </div>
      <p className="text-[15px] font-extrabold text-[var(--text)]">You're offline</p>
      <p className="text-[12.5px] font-medium text-[var(--text-muted)] mt-1.5 max-w-[280px] leading-relaxed">
        {pendingCount > 0
          ? `${pendingCount} record${pendingCount !== 1 ? "s" : ""} saved on this phone. They'll upload automatically once you have signal.`
          : "You can still clock in and log visits — everything is saved locally and syncs later."}
      </p>
    </div>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────────────

export function Avatar({
  src,
  initials,
  size = 72,
  className,
}: {
  src?: string | null;
  initials: string;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={cx("rounded-full object-cover border-2 border-[var(--card)]", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={cx(
        "rounded-full bg-[var(--mint-btn)] flex items-center justify-center text-white font-black border-2 border-[var(--card)]",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

// ── Screen scaffold ──────────────────────────────────────────────────────────

/**
 * Standard screen frame: mint gradient header, then a scrollable body.
 * `header` sits in the gradient region; `children` scrolls beneath it.
 */
export function Screen({
  header,
  children,
  footerPad = true,
  className,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  footerPad?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col h-full bg-[var(--bg)]", className)}>
      <div className="mint-header flex-shrink-0">{header}</div>
      <div
        className={cx(
          "flex-1 mint-scroll px-4",
          footerPad ? "pb-32" : "pb-6"
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Small uppercase label used above icon grids. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <SectionLabel className="mb-2.5 block">{children}</SectionLabel>;
}
