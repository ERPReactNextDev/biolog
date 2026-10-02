"use client";

/* ============================================================================
   Shared "Calm Mint" building blocks for components/ — the same design system
   as app/activity-planner/mint, but usable from anywhere in the app tree.
   ----------------------------------------------------------------------------
   These render outside .mint-root (portaled dialogs, camera, login form), so
   they carry their own `mint-ui` class to pick up the font + tap behaviour.
   ========================================================================== */

import React from "react";
import { Loader2, Timer } from "lucide-react";
import { cx } from "@/app/activity-planner/mint/ui";
import { usePreferences } from "@/lib/preferences";

export { cx };

/* ── Camera timer preferences ───────────────────────────────────────────────── */

/**
 * Countdown-timer settings for the camera, restored in the Calm Mint system.
 * The original lived inline in the old monolithic page; the prefs plumbing in
 * lib/preferences.ts was never removed.
 */
export function CameraTimerSettings() {
  const { prefs, setPref } = usePreferences();
  const PRESETS = [3, 5, 10, 15, 30];

  return (
    <div
      className="rounded-[var(--r-card-lg)] border overflow-hidden mb-4"
      style={{
        background: "var(--card)",
        borderColor: "var(--border)",
        boxShadow: "var(--sh-card)",
      }}
    >
      <div
        className="flex items-center gap-3.5 px-4 py-3.5"
        style={{
          borderBottom: prefs.cameraTimerEnabled ? "1px solid var(--border)" : undefined,
        }}
      >
        <div
          className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0"
          style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
        >
          <Timer size={19} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-extrabold text-[var(--text)]">Countdown Timer</p>
          <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
            {prefs.cameraTimerEnabled
              ? `${prefs.cameraTimerSeconds}s countdown before capture — time to hold still.`
              : "Capture instantly on tap. Faster, but blur is more likely."}
          </p>
        </div>
        <SwitchPill
          checked={prefs.cameraTimerEnabled}
          onChange={(v) => setPref("cameraTimerEnabled", v)}
          label="Countdown timer"
        />
      </div>

      {prefs.cameraTimerEnabled && (
        <div className="px-4 py-3.5">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] mb-2.5 text-[var(--text-muted)]">
            Duration
          </p>
          <div className="flex gap-2 flex-wrap">
            {PRESETS.map((s) => {
              const isSelected = prefs.cameraTimerSeconds === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setPref("cameraTimerSeconds", s)}
                  aria-pressed={isSelected}
                  className="flex-1 min-w-[52px] min-h-[44px] rounded-[14px] text-[13px] font-extrabold transition-all active:scale-95"
                  style={
                    isSelected
                      ? {
                          background: "var(--mint-btn)",
                          color: "white",
                          border: "1px solid transparent",
                        }
                      : {
                          background: "var(--card-alt)",
                          color: "var(--text-muted)",
                          border: "1px solid var(--border)",
                        }
                  }
                >
                  {s}s
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Local toggle so this file doesn't depend on the mint/ Switch. */
function SwitchPill({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="w-[52px] h-[30px] rounded-full p-[3px] flex items-center shrink-0 transition-colors"
      style={{ background: checked ? "var(--mint-btn)" : "var(--border-strong)" }}
    >
      <span
        className="w-6 h-6 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? "translateX(22px)" : "translateX(0)" }}
      />
    </button>
  );
}

/* ── Buttons ───────────────────────────────────────────────────────────────── */

type Variant = "primary" | "clockout" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
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

const SIZES = {
  sm: "min-h-[44px] px-4 text-[13px] rounded-[14px] gap-1.5",
  md: "min-h-[48px] px-5 text-[14px] rounded-[var(--r-btn)] gap-2",
  lg: "min-h-[56px] px-6 text-[16px] rounded-[20px] gap-2.5",
} as const;

export function MintButton({
  children,
  onClick,
  variant = "primary",
  size = "lg",
  disabled,
  loading,
  icon,
  full,
  type = "button",
  className,
  ariaLabel,
  form,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: keyof typeof SIZES;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  full?: boolean;
  type?: "button" | "submit";
  className?: string;
  ariaLabel?: string;
  /**
   * `id` of a form elsewhere in the tree. Lets a sticky drawer footer submit
   * the form rendered in the scrollable body above it.
   */
  form?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      form={form}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center font-extrabold tracking-tight",
        "transition-all active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mint)]",
        SIZES[size],
        VARIANTS[variant],
        full && "w-full",
        className
      )}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ── Form fields ───────────────────────────────────────────────────────────── */

const FIELD =
  "w-full min-h-[48px] px-4 rounded-[var(--r-btn)] border border-[var(--border-strong)] bg-[var(--card)] text-[13.5px] font-semibold text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none transition-colors focus:border-[var(--mint)]";

export function MintInput({
  className,
  textarea,
  rows = 3,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  textarea?: boolean;
  rows?: number;
}) {
  const cls = cx(FIELD, textarea && "py-3 resize-none", className);
  if (textarea) {
    const { textarea: _t, rows: _r, ...ta } = rest as any;
    return <textarea rows={rows} className={cls} {...ta} />;
  }
  return <input className={cls} {...rest} />;
}

export function MintLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "block text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2",
        className
      )}
    >
      {children}
    </span>
  );
}

/* ── Status pill ───────────────────────────────────────────────────────────── */

type Tone = "mint" | "clay" | "alert" | "info" | "neutral";

const TONE: Record<Tone, { bg: string; fg: string; dot: string }> = {
  mint: { bg: "var(--mint-soft)", fg: "var(--mint-strong)", dot: "var(--mint)" },
  clay: { bg: "var(--clay-soft)", fg: "var(--clay-ink)", dot: "var(--clay)" },
  alert: { bg: "var(--alert-soft)", fg: "var(--alert-ink)", dot: "var(--alert)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)", dot: "var(--info)" },
  neutral: { bg: "var(--bg)", fg: "var(--text-muted)", dot: "var(--text-faint)" },
};

export function MintPill({
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

export { TONE as MINT_TONE };
export type { Tone as MintTone };

/* ── Card ──────────────────────────────────────────────────────────────────── */

export function MintCard({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cx(
        "bg-[var(--card)] border border-[var(--border)] rounded-[var(--r-card-lg)] shadow-[var(--sh-card)]",
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/* ── Helpful hint ──────────────────────────────────────────────────────────── */

export function MintHint({
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

/* ── Dialog scaffold ───────────────────────────────────────────────────────── */

/**
 * Standard Mint dialog body. Every dialog in components/ uses this so the
 * header gradient, radius, and typography stay consistent.
 */
export function MintDialogHeader({
  title,
  subtitle,
  onClose,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="px-6 pt-5 pb-6 flex-shrink-0"
      style={{ background: "linear-gradient(180deg, var(--mint-gradient) 0%, var(--card) 100%)" }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 transition-colors"
          style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
        >
          <span aria-hidden>←</span>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-black text-[var(--text)] leading-tight">{title}</h2>
          {subtitle && (
            <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Container that gives a dialog the Mint background + Nunito font. */
export function MintBody({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={cx("flex-1 overflow-y-auto mint-scroll", padded && "p-5", className)}
      style={{ background: "var(--bg)" }}
    >
      {children}
    </div>
  );
}

/* ── Bottom drawer ─────────────────────────────────────────────────────────── */

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/**
 * Mint bottom drawer. Built on the repo's Radix Sheet so we inherit focus
 * trapping, Escape-to-close, scroll lock and the portal — none of which the
 * hand-rolled animated versions had.
 */
export function MintDrawer({
  open,
  onOpenChange,
  title,
  description,
  onClose,
  header,
  children,
  footer,
  maxHeight = "92vh",
  className,
  bodyClassName,
  tone = "mint",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rendered as a visually-hidden label unless `header` replaces it. */
  title: string;
  description?: string;
  onClose: () => void;
  /** Optional custom header (most callers pass their own gradient header). */
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Sticky footer, e.g. a primary submit button. */
  footer?: React.ReactNode;
  maxHeight?: string;
  className?: string;
  /** Override the scroll container — e.g. to let a dropdown overflow. */
  bodyClassName?: string;
  tone?: "mint" | "clay";
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Soft scrim instead of the default bg-black/80 */}
      <SheetContent
        side="bottom"
        className={cx(
          // reset the shadcn defaults we don't want
          "p-0 gap-0 border-0 bg-transparent shadow-none",
          // hide the built-in X — callers render their own back button
          "[&>button]:hidden",
          className
        )}
        style={{
          // A bottom sheet with only a max-height and no height sizes to its
          // CONTENT, so the flex-1 body below never gets a bounded box to
          // scroll inside — the sticky footer is then pushed past the viewport
          // and clipped instead. Pinning height to the cap makes the body the
          // scrolling region and keeps the footer on screen, which is what a
          // sticky footer is for.
          height: `min(${maxHeight}, 100dvh)`,
          maxHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--card)",
          borderTopLeftRadius: "var(--r-sheet)",
          borderTopRightRadius: "var(--r-sheet)",
          boxShadow: "var(--sh-sheet)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {description && <span className="sr-only">{description}</span>}

        <div className="mint-ui flex flex-col min-h-0 flex-1">
          {/* Drag handle — signals it can be swiped, per the design brief */}
          <div className="pt-2.5 pb-1 flex justify-center shrink-0">
            <div className="mint-drag-handle" />
          </div>

          {header}

          {/* min-h-0 is required on a flex child that scrolls — without it the
              item refuses to shrink below its content height, which is what let
              the body grow past the drawer and hide the footer. */}
          <div className={cx("flex-1 min-h-0 overflow-y-auto overscroll-contain mint-scroll", bodyClassName)}>
            {children}
          </div>

          {/* Wrapped so a footer passed as a bare element still cannot be
              squashed by a tall body. */}
          {footer && <div className="shrink-0">{footer}</div>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
