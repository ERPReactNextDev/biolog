"use client";

/* ============================================================================
   Group Visitation — detail view
   ----------------------------------------------------------------------------
   Shows the full visit: who is coming, when, where, and why. The action button
   states WHY it is disabled rather than just greying out, because "restricted"
   is otherwise indistinguishable from "already joined" or "finished".
   ========================================================================== */

import React from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock,
  MapPin,
  ShieldCheck,
  Timer,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/app/activity-planner/mint/ui";
import type { Member } from "@/lib/group-visits";
import {
  GvCard,
  GvCardHeader,
  GroupStatusPill,
  VisibilityBadge,
  formatTime,
  formatVisitDate,
  type GroupVisitCard,
} from "./gv-shared";

function initialsOf(m: Member) {
  return `${(m.Firstname || "")[0] ?? ""}${(m.Lastname || "")[0] ?? ""}`.toUpperCase() || "?";
}

function nameOf(m: Member) {
  return [m.Firstname, m.Lastname].filter(Boolean).join(" ") || m.ReferenceID;
}

export function GroupVisitDetail({
  card,
  members,
  viewerRef,
  busy,
  onJoin,
  onLeave,
  onCancel,
  onCheckIn,
  onBack,
}: {
  card: GroupVisitCard;
  members: Member[];
  viewerRef: string;
  busy: string | null;
  onJoin: () => void;
  onLeave: () => void;
  onCancel: () => void;
  onCheckIn: () => void;
  onBack: () => void;
}) {
  const closed = card.Status === "Completed" || card.Status === "Cancelled";
  const checkedIn = members.find((m) => m.ReferenceID === viewerRef)?.checked_in;

  return (
    <div className="space-y-4">
      {/* Headline */}
      <GvCard>
        <div className="flex items-start justify-between gap-3 mb-2">
          <h2
            className="text-[24px] font-black leading-tight flex-1 min-w-0"
            style={{ color: "var(--mint-strong)" }}
          >
            {card.CompanyName}
          </h2>
          <GroupStatusPill status={card.Status} />
        </div>

        <p className="text-[12.5px] font-semibold text-[var(--text-muted)]">
          Created by {card.creatorName}
          {card.creatorRole ? ` · ${card.creatorRole}` : ""}
        </p>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <VisibilityBadge visibility={card.Visibility} />
          {card.Visibility === "team_only" && (
            <span className="text-[11px] font-bold text-[var(--text-faint)]">
              {card.creatorName}&apos;s team
            </span>
          )}
        </div>
      </GvCard>

      {/* Details */}
      <GvCard>
        <GvCardHeader icon={<CalendarDays size={18} />} title="Visit details" />

        <Row icon={<CalendarDays size={14} />} label="Date">
          {formatVisitDate(card.VisitDate)}
        </Row>
        {card.MeetupTime && (
          <Row icon={<Clock size={14} />} label="Meet-up">
            {formatTime(card.MeetupTime)}
          </Row>
        )}
        {card.MeetingPoint && (
          <Row icon={<MapPin size={14} />} label="Meeting point">
            {card.MeetingPoint}
          </Row>
        )}
        {card.CompanyAddress && (
          <Row icon={<MapPin size={14} />} label="Address">
            {card.CompanyAddress}
          </Row>
        )}
        {card.Purpose && (
          <Row icon={<Timer size={14} />} label="Purpose">
            {card.Purpose}
          </Row>
        )}
        <Row icon={<Users size={14} />} label="Capacity">
          {card.MaxMembers == null
            ? `${members.length} joined · unlimited`
            : `${members.length} of ${card.MaxMembers} joined`}
          {card.seatsLeft != null && card.seatsLeft > 0 && (
            <span className="ml-1.5 text-[11px]" style={{ color: "var(--mint-strong)" }}>
              {card.seatsLeft} seat{card.seatsLeft === 1 ? "" : "s"} left
            </span>
          )}
        </Row>
      </GvCard>

      {/* Members */}
      <GvCard>
        <GvCardHeader
          icon={<Users size={18} />}
          title="Who is coming"
          subtitle={`${members.length} joined`}
          right={
            card.isMember && !closed ? (
              <button
                type="button"
                onClick={onCheckIn}
                disabled={busy === "checkin" || checkedIn === true}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full text-[11.5px] font-extrabold transition-colors disabled:opacity-50"
                style={
                  checkedIn
                    ? { background: "var(--mint-soft)", color: "var(--mint-strong)" }
                    : { background: "var(--mint-btn)", color: "#fff" }
                }
              >
                <Check size={13} strokeWidth={3} />
                {checkedIn ? "Checked in" : busy === "checkin" ? "…" : "Check in"}
              </button>
            ) : null
          }
        />

        {members.length === 0 ? (
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)]">
            Nobody has joined yet.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {members.map((m, i) => {
              const isCreator = m.ReferenceID === card.ReferenceID_creator;
              const isViewer = m.ReferenceID === viewerRef;
              return (
                <li key={`${m.ReferenceID}-${i}`} className="flex items-center gap-3 py-2.5">
                  <span
                    className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-black text-white shrink-0"
                    style={{ background: "var(--mint-btn)" }}
                  >
                    {initialsOf(m)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-extrabold text-[var(--text)] truncate">
                      {nameOf(m)}
                      {isViewer && (
                        <span className="ml-1.5 text-[10.5px] font-bold" style={{ color: "var(--text-faint)" }}>
                          (you)
                        </span>
                      )}
                    </span>
                    {isCreator && (
                      <span className="text-[10.5px] font-extrabold" style={{ color: "var(--mint-strong)" }}>
                        Organiser
                      </span>
                    )}
                  </span>
                  {m.checked_in && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-full"
                      style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
                    >
                      <Check size={10} strokeWidth={3} />
                      In
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </GvCard>

      {/* Actions */}
      <div className="space-y-2.5">
        {card.isMember && !card.isCreator && !closed && (
          <Button variant="secondary" size="md" full loading={busy === "leave"} onClick={onLeave}>
            Leave this visit
          </Button>
        )}

        {card.isMember ? (
          <div
            className="rounded-[var(--r-card)] p-3.5 flex items-center justify-center gap-2"
            style={{ background: "var(--mint-soft)" }}
          >
            <Check size={16} strokeWidth={3} style={{ color: "var(--mint-strong)" }} />
            <span className="text-[13px] font-extrabold" style={{ color: "var(--mint-strong)" }}>
              You&apos;re on this visit
            </span>
          </div>
        ) : card.canJoin && !closed ? (
          <Button full size="lg" loading={busy === "join"} onClick={onJoin} icon={<UserPlus size={18} />}>
            Join this group visit
          </Button>
        ) : (
          <div
            className="rounded-[var(--r-card)] p-3.5 flex items-start gap-2.5"
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >
            <AlertTriangle size={15} style={{ color: "var(--text-faint)" }} className="shrink-0 mt-0.5" />
            <span className="text-[12px] font-bold leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {card.joinBlockedReason || "This visit is not open to you."}
            </span>
          </div>
        )}

        {card.isCreator && !closed && (
          <Button
            variant="ghost"
            size="sm"
            full
            loading={busy === "cancel"}
            onClick={onCancel}
            icon={<X size={15} />}
          >
            Cancel this group visit
          </Button>
        )}

        {card.isCreator && closed && card.Status === "Cancelled" && (
          <p
            className="text-center text-[11.5px] font-bold flex items-center justify-center gap-1.5"
            style={{ color: "var(--alert-ink)" }}
          >
            <ShieldCheck size={13} />
            You cancelled this visit
          </p>
        )}

        <Button variant="ghost" size="md" full onClick={onBack}>
          Back to list
        </Button>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="shrink-0 mt-0.5" style={{ color: "var(--text-faint)" }}>
        {icon}
      </span>
      <span className="w-[104px] shrink-0 text-[11.5px] font-bold text-[var(--text-muted)]">
        {label}
      </span>
      <span className="flex-1 min-w-0 text-[12.5px] font-extrabold text-[var(--text)] leading-snug">
        {children}
      </span>
    </div>
  );
}