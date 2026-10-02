"use client";

/* ============================================================================
   Group Visitation — shared presentation
   ----------------------------------------------------------------------------
   Company name is the headline of every card, so it gets the strongest type in
   the whole feature. Visibility badges read at a glance: mint for a restricted
   team visit, blue for open to all.
   ========================================================================== */

import React from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock,
  Globe,
  MapPin,
  Timer,
  UserPlus,
  Users,
} from "lucide-react";
import { cx, SectionLabel } from "@/app/activity-planner/mint/ui";
import type { GroupStatus, GroupVisit, Member, Visibility } from "@/lib/group-visits";

/* ── A group visit card as returned by /api/group-visits ─────────────────── */

export type GroupVisitCard = GroupVisit & {
  creatorName: string;
  creatorRole: string | null;
  members: number;
  /** Names + avatars for the stack, resolved server-side from the team index. */
  memberList: Member[];
  isMember: boolean;
  isCreator: boolean;
  canJoin: boolean;
  joinBlockedReason: string | null;
  seatsLeft: number | null;
  /** Set by the server when the visit is today, for the "Today" filter. */
  relativeDay?: string;
  Status: GroupStatus;
};

/* ── Visibility badge ────────────────────────────────────────────────────── */

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const teamOnly = visibility === "team_only";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold whitespace-nowrap"
      style={
        teamOnly
          ? { background: "var(--mint-soft)", color: "var(--mint-strong)" }
          : { background: "var(--info-soft)", color: "var(--info)" }
      }
    >
      {teamOnly ? <Users size={11} strokeWidth={2.6} /> : <Globe size={11} strokeWidth={2.6} />}
      {teamOnly ? "Team only" : "Open to all"}
    </span>
  );
}

/* ── Status pill ─────────────────────────────────────────────────────────── */

export function GroupStatusPill({ status }: { status: GroupStatus }) {
  const map: Record<GroupStatus, { bg: string; fg: string; dot?: boolean }> = {
    Upcoming: { bg: "var(--info-soft)", fg: "var(--info)" },
    Ongoing: { bg: "var(--mint-soft)", fg: "var(--mint-strong)", dot: true },
    Completed: { bg: "var(--bg)", fg: "var(--text-muted)" },
    Cancelled: { bg: "var(--alert-soft)", fg: "var(--alert-ink)" },
  };
  const t = map[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-extrabold whitespace-nowrap"
      style={{ background: t.bg, color: t.fg }}
    >
      {t.dot && <span className="w-1.5 h-1.5 rounded-full animate-pulse-soft" style={{ background: "var(--mint)" }} />}
      {status}
    </span>
  );
}

/* ── Avatar stack ────────────────────────────────────────────────────────── */

function initialsOf(m: Member) {
  return `${(m.Firstname || "")[0] ?? ""}${(m.Lastname || "")[0] ?? ""}`.toUpperCase() || "?";
}

export function MemberStack({ members, total }: { members: Member[]; total: number }) {
  const shown = members.slice(0, 4);
  const extra = Math.max(0, total - shown.length);

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center -space-x-2">
        {shown.map((m, i) => (
          <span
            key={`${m.ReferenceID}-${i}`}
            title={[m.Firstname, m.Lastname].filter(Boolean).join(" ") || m.ReferenceID}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[9.5px] font-black text-white shrink-0"
            style={{ background: "var(--mint-btn)", border: "2px solid var(--card)" }}
          >
            {initialsOf(m)}
          </span>
        ))}
        {extra > 0 && (
          <span
            className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black shrink-0"
            style={{
              background: "var(--mint-soft)",
              color: "var(--mint-strong)",
              border: "2px solid var(--card)",
            }}
          >
            +{extra}
          </span>
        )}
      </div>
      <span className="text-[11.5px] font-bold text-[var(--text-muted)]">
        {total} joined{total === 1 ? "" : ""}
      </span>
    </div>
  );
}

/* ── Meta row ────────────────────────────────────────────────────────────── */

export function MetaLine({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-start gap-1.5 text-[12px] font-semibold text-[var(--text-muted)]">
      <span className="shrink-0 mt-px" style={{ color: "var(--text-faint)" }}>
        {icon}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/* ── Card ────────────────────────────────────────────────────────────────── */

export function GroupVisitCardView({
  card,
  members,
  onOpen,
  onJoin,
  onLeave,
  busy,
}: {
  card: GroupVisitCard;
  members: Member[];
  onOpen: () => void;
  onJoin: () => void;
  onLeave: () => void;
  busy?: string | null;
}) {
  const closed = card.Status === "Completed" || card.Status === "Cancelled";

  return (
    <div
      className="rounded-[var(--r-card-lg)] border bg-[var(--card)] p-4 shadow-[var(--sh-card)]"
      style={{ borderColor: "var(--border)" }}
    >
      {/* Company name — the headline */}
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <button type="button" onClick={onOpen} className="min-w-0 text-left flex-1">
          <h3
            className="text-[17px] font-black leading-tight truncate"
            style={{ color: "var(--mint-strong)" }}
          >
            {card.CompanyName}
          </h3>
          <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
            Created by {card.creatorName}
            {card.creatorRole ? ` · ${card.creatorRole}` : ""}
          </p>
        </button>
        <GroupStatusPill status={card.Status} />
      </div>

      {/* Visibility */}
      <div className="mb-3">
        <VisibilityBadge visibility={card.Visibility} />
        {card.Visibility === "team_only" && (
          <span className="ml-2 text-[10.5px] font-bold text-[var(--text-faint)]">
            {card.creatorName}&apos;s team
          </span>
        )}
      </div>

      {/* Details */}
      <div className="space-y-1.5">
        <MetaLine icon={<CalendarDays size={13} />}>
          {formatVisitDate(card.VisitDate)}
          {card.MeetupTime ? ` · ${formatTime(card.MeetupTime)}` : ""}
        </MetaLine>
        {card.MeetingPoint && (
          <MetaLine icon={<MapPin size={13} />}>{card.MeetingPoint}</MetaLine>
        )}
        {card.CompanyAddress && !card.MeetingPoint && (
          <MetaLine icon={<MapPin size={13} />}>{card.CompanyAddress}</MetaLine>
        )}
        {card.Purpose && (
          <MetaLine icon={<Timer size={13} />}>{card.Purpose}</MetaLine>
        )}
      </div>

      {/* Members */}
      <div className="mt-3.5 pt-3.5 flex items-center justify-between gap-3 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
        <MemberStack members={members} total={card.members} />

        {/* Actions */}
        <div className="flex items-center gap-2">
          {card.isMember && !card.isCreator && !closed && (
            <button
              type="button"
              onClick={onLeave}
              disabled={busy === "leave"}
              className="min-h-[40px] px-3.5 rounded-full text-[12px] font-extrabold border transition-colors disabled:opacity-45"
              style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
            >
              {busy === "leave" ? "Leaving…" : "Leave"}
            </button>
          )}

          {card.isMember ? (
            <span
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-full text-[12px] font-extrabold"
              style={{ background: "var(--bg)", color: "var(--text-muted)" }}
            >
              <Check size={13} strokeWidth={3} />
              Joined
            </span>
          ) : card.canJoin && !closed ? (
            <button
              type="button"
              onClick={onJoin}
              disabled={busy === "join"}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full text-[12px] font-extrabold text-white transition-all active:scale-[0.98] disabled:opacity-45"
              style={{ background: "var(--mint-btn)" }}
            >
              <UserPlus size={14} strokeWidth={2.6} />
              {busy === "join" ? "Joining…" : "Join"}
            </button>
          ) : (
            /* Restricted / full / closed. The reason comes from the server, so it
               always matches what a crafted request would be told. */
            <span
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-full text-[11.5px] font-extrabold max-w-[190px]"
              style={{ background: "var(--bg)", color: "var(--text-faint)" }}
              title={card.joinBlockedReason || undefined}
            >
              <AlertTriangle size={12} strokeWidth={2.6} className="shrink-0" />
              <span className="truncate">{card.joinBlockedReason || "Not available"}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Section heading ─────────────────────────────────────────────────────── */

export function GvSectionLabel({ children }: { children: React.ReactNode }) {
  return <SectionLabel className="mb-2.5 block">{children}</SectionLabel>;
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

export function formatVisitDate(value?: string | null): string {
  if (!value) return "Date not set";
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(value?: string | null): string {
  if (!value) return "";
  const [h, m] = String(value).split(":").map((n) => parseInt(n, 10) || 0);
  if (Number.isNaN(h)) return "";
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

/** "Today" / "Tomorrow" / a real date — used on filter chips and cards. */
export function relativeDay(value?: string | null): string {
  if (!value) return "";
  const key = String(value).slice(0, 10);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  if (key === today) return "Today";

  const tomorrow = new Date(Date.now() + 86_400_000);
  const tKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(tomorrow);
  if (key === tKey) return "Tomorrow";
  return formatVisitDate(value);
}

/* ── Form field kit (matches the OB form) ────────────────────────────────── */

const FIELD =
  "w-full rounded-[14px] border px-3.5 text-[13px] font-semibold outline-none transition-colors";

export function GvLabel({
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

export function GvInput({
  label,
  value,
  onChange,
  placeholder,
  required,
  hint,
  icon,
  type = "text",
  list,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  icon?: React.ReactNode;
  type?: string;
  list?: string;
}) {
  return (
    <label className="block">
      <GvLabel required={required} hint={hint}>
        {label}
      </GvLabel>
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
          list={list}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cx(FIELD, "min-h-[48px]", icon ? "pl-9" : "")}
          style={{ borderColor: "var(--border-strong)", background: "var(--card)", color: "var(--text)" }}
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

export function GvTextarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <GvLabel hint={maxLength ? `${value.length}/${maxLength}` : undefined}>{label}</GvLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className={cx(FIELD, "py-3 leading-relaxed resize-none")}
        style={{ borderColor: "var(--border-strong)", background: "var(--card)", color: "var(--text)" }}
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

export function GvToggle({
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
      className="w-[52px] h-[30px] rounded-full p-[3px] flex items-center transition-colors shrink-0"
      style={{ background: checked ? "var(--mint-btn)" : "var(--border-strong)" }}
    >
      <span
        className="w-6 h-6 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? "translateX(22px)" : "translateX(0)" }}
      />
    </button>
  );
}

/* ── Card chrome ─────────────────────────────────────────────────────────── */

export function GvCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-[var(--r-card-lg)] border p-4 bg-[var(--card)] border-[var(--border)] shadow-[var(--sh-card)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function GvCardHeader({
  icon,
  title,
  subtitle,
  tone = "mint",
  right,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone?: "mint" | "clay" | "info" | "violet";
  right?: React.ReactNode;
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

export function GvEmptyClock() {
  return <Clock size={28} />;
}