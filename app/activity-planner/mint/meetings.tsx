"use client";

/* ============================================================================
   MEETINGS — detail dialog + create sheet (re-skinned from the old inline
   dialogs, which were solid purple)
   ========================================================================== */

import React, { useEffect, useState } from "react";
import {
  Building2,
  CalendarDays,
  Clock,
  MapPin,
  Send,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Card, Pill, SectionLabel, cx } from "./ui";
import { MintDrawer } from "@/components/mint";
import { useResolvedLocation, type Meeting, type UserDetails, type UserInfo } from "./data";
import { formatPHDate, formatPHTimeStr } from "@/lib/ph-time";

// ── Meeting details ──────────────────────────────────────────────────────────

export function MeetingDetailsSheet({
  open,
  onClose,
  meeting,
  usersMap,
}: {
  open: boolean;
  onClose: () => void;
  meeting: Meeting | null;
  usersMap: Record<string, UserInfo>;
}) {
  const { displayLocation, isResolving, isCoords, originalCoords } = useResolvedLocation(
    meeting?.Location,
    meeting?.Latitude,
    meeting?.Longitude
  );

  if (!meeting) return null;
  const user = usersMap[meeting.ReferenceID];

  return (
    <MintDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      onClose={onClose}
      title="Meeting details"
      header={
        <>
            {/* Header — info blue, not purple */}
            <div
              className="px-5 pb-6 flex-shrink-0"
              style={{ background: "var(--info-soft)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Pill tone="info" dot pulse>
                      {meeting.Status}
                    </Pill>
                  </div>
                  <h2 className="text-[20px] font-black text-[var(--text)] leading-tight">
                    {meeting.Title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--card)", color: "var(--text-muted)" }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
        </>
      }
    >
            <div className="px-5 py-5" style={{ background: "var(--card)" }}>
              <div className="space-y-4">
                <DetailBlock
                  icon={<User size={17} />}
                  label="Organizer / Manager"
                  value={
                    user
                      ? `${user.Firstname} ${user.Lastname}`
                      : meeting.Email
                  }
                  sub={meeting.Manager ? `Manager: ${meeting.Manager}` : undefined}
                />
                {meeting.CompanyName && (
                  <DetailBlock
                    icon={<Building2 size={17} />}
                    label="Company"
                    value={meeting.CompanyName}
                  />
                )}
                <DetailBlock
                  icon={<CalendarDays size={17} />}
                  label="Schedule"
                  value={formatPHDate(meeting.StartDate, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                  sub={`${formatPHTimeStr(meeting.StartDate)} – ${formatPHTimeStr(meeting.EndDate)}`}
                />
                <DetailBlock
                  icon={<Clock size={17} />}
                  label="Duration"
                  value={`${meeting.Duration} minutes`}
                />
                <div className="flex items-start gap-3.5">
                  <div
                    className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
                    style={{ background: "var(--info-soft)", color: "var(--info)" }}
                  >
                    <MapPin size={17} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <SectionLabel>Location</SectionLabel>
                    {isResolving ? (
                      <p className="text-[13.5px] font-bold text-[var(--text-muted)] mt-1 flex items-center gap-1.5">
                        <Clock size={12} className="animate-pulse" /> Resolving address…
                      </p>
                    ) : (
                      <p className="text-[13.5px] font-bold text-[var(--text)] mt-1 leading-snug">
                        {displayLocation}
                      </p>
                    )}
                    {isCoords && originalCoords && (
                      <p className="text-[10.5px] font-semibold text-[var(--text-faint)] mt-0.5">
                        Coordinates: {originalCoords}
                      </p>
                    )}
                  </div>
                </div>

                <div className="pt-1">
                  <SectionLabel className="mb-2">Remarks</SectionLabel>
                  <Card className="p-3.5" style={{ background: "var(--bg)" }}>
                    <p className="text-[12.5px] font-semibold text-[var(--text-muted)] italic leading-relaxed">
                      {meeting.Remarks && meeting.Remarks !== "No remarks"
                        ? `"${meeting.Remarks}"`
                        : "No remarks added for this meeting."}
                    </p>
                  </Card>
                </div>
              </div>

              <Button full size="lg" className="mt-5" onClick={onClose}>
                Close Details
              </Button>
            </div>
    </MintDrawer>
  );
}

function DetailBlock({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start gap-3.5">
      <div
        className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0"
        style={{ background: "var(--info-soft)", color: "var(--info)" }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <SectionLabel>{label}</SectionLabel>
        <p className="text-[13.5px] font-bold text-[var(--text)] mt-1 leading-snug">{value}</p>
        {sub && <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Create meeting ───────────────────────────────────────────────────────────

const EMPTY = {
  Title: "",
  StartDate: "",
  EndDate: "",
  Location: "",
  Remarks: "",
  Manager: "",
  CompanyName: "",
};

export function CreateMeetingSheet({
  open,
  onClose,
  userDetails,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  userDetails: UserDetails | null;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setDuration(0);
  }, [open]);

  useEffect(() => {
    if (form.StartDate && form.EndDate) {
      const start = new Date(form.StartDate);
      const end = new Date(form.EndDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
        setDuration(Math.round((end.getTime() - start.getTime()) / 60000));
      } else {
        setDuration(0);
      }
    }
  }, [form.StartDate, form.EndDate]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDetails) return;
    if (!form.Title || !form.StartDate || !form.EndDate) {
      toast.error("Fill in the title and both dates.");
      return;
    }
    if (new Date(form.EndDate) <= new Date(form.StartDate)) {
      toast.error("End date must be after the start date.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/ModuleSales/Activity/Meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ReferenceID: userDetails.ReferenceID,
          Email: userDetails.Email,
          TSM: userDetails.TSM,
        }),
      });
      if (res.ok) {
        toast.success("Meeting created successfully.");
        onSuccess();
        onClose();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || "Failed to create the meeting.");
      }
    } catch {
      toast.error("Couldn't reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full min-h-[48px] px-4 rounded-[var(--r-btn)] border border-[var(--border-strong)] bg-[var(--card)] text-[13.5px] font-semibold text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none focus:border-[var(--mint)] transition-colors";

  return (
    <MintDrawer
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      onClose={onClose}
      title="Create Meeting"
      description="Schedule a new activity"
      header={
        <>
            <div className="px-5 pb-3.5 flex items-start justify-between gap-3 shrink-0 border-b border-[var(--border)]">
              <div className="min-w-0">
                <h2 className="text-[19px] font-black text-[var(--text)] leading-tight">
                  Create Meeting
                </h2>
                <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-0.5">
                  Schedule a new activity
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
          className="px-5 pt-3.5 pb-4 border-t border-[var(--border)] shrink-0"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <Button
            type="submit"
            form="create-meeting-form"
            full
            size="lg"
            icon={<Send size={19} />}
            loading={loading}
          >
            {loading ? "Scheduling…" : "Schedule Meeting"}
          </Button>
        </div>
      }
    >
            <form
              id="create-meeting-form"
              onSubmit={submit}
              className="px-5 py-4 flex flex-col gap-4"
            >
              <Field label="Meeting Title">
                <input
                  required
                  value={form.Title}
                  onChange={set("Title")}
                  placeholder="Project Sync / Client Presentation"
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Start">
                  <input
                    required
                    type="datetime-local"
                    value={form.StartDate}
                    onChange={set("StartDate")}
                    className={cx(inputCls, "px-3 text-[12px]")}
                  />
                </Field>
                <Field label="End">
                  <input
                    required
                    type="datetime-local"
                    value={form.EndDate}
                    onChange={set("EndDate")}
                    className={cx(inputCls, "px-3 text-[12px]")}
                  />
                </Field>
              </div>

              {duration > 0 && (
                <div
                  className="rounded-[14px] px-3.5 py-2.5 flex items-center justify-between"
                  style={{ background: "var(--mint-soft)" }}
                >
                  <span className="text-[11px] font-black uppercase tracking-wider text-[var(--mint-strong)]">
                    Auto Duration
                  </span>
                  <span className="mint-num text-[13px] font-black text-[var(--mint-strong)]">
                    {duration} minutes
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Manager">
                  <input
                    value={form.Manager}
                    onChange={set("Manager")}
                    placeholder="Manager Name"
                    className={cx(inputCls, "px-3 text-[12.5px]")}
                  />
                </Field>
                <Field label="Company">
                  <input
                    value={form.CompanyName}
                    onChange={set("CompanyName")}
                    placeholder="Company Name"
                    className={cx(inputCls, "px-3 text-[12.5px]")}
                  />
                </Field>
              </div>

              <Field label="Location">
                <input
                  value={form.Location}
                  onChange={set("Location")}
                  placeholder="Office / Zoom / Client Site"
                  className={inputCls}
                />
              </Field>

              <Field label="Remarks">
                <textarea
                  value={form.Remarks}
                  onChange={set("Remarks")}
                  placeholder="Add any additional notes here…"
                  rows={3}
                  className={cx(inputCls, "py-3 resize-none")}
                />
              </Field>
            </form>
    </MintDrawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </label>
  );
}
