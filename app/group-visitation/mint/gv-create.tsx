"use client";

/* ============================================================================
   Group Visitation · Tab B — create form
   ----------------------------------------------------------------------------
   Any agent may create a group visit. What their ROLE decides is only the
   DEFAULT visibility: a Manager/TSM gets a team-only group, an ordinary agent
   gets one open to everyone. Both defaults carry an override, and the override
   is what's saved.

   The subtext tells the creator exactly how many people the restriction will
   reach, so "Team only" is never a guess.
   ========================================================================== */

import { useMemo, useRef, useState } from "react";
import { CalendarDays, Globe, MapPin, Timer, Users } from "lucide-react";
import { toast } from "sonner";
import { Button, Hint } from "@/app/activity-planner/mint/ui";
import { isTeamLeaderRole, type Visibility } from "@/lib/group-visits";
import {
  GvCard,
  GvCardHeader,
  GvInput,
  GvTextarea,
  GvToggle,
  formatVisitDate,
  formatTime,
} from "./gv-shared";

function phToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

export function GroupVisitCreate({
  role,
  teamSize,
  clientNames,
  busy,
  onSubmit,
  onCancel,
}: {
  role?: string | null;
  /** How many agents are reachable if this stays team-only. */
  teamSize: number;
  /** Existing client/company names for the datalist. */
  clientNames: string[];
  busy: boolean;
  onSubmit: (payload: CreatePayload) => Promise<void>;
  onCancel: () => void;
}) {
  const leader = isTeamLeaderRole(role);

  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [visitDate, setVisitDate] = useState(phToday());
  const [meetupTime, setMeetupTime] = useState("");
  const [meetingPoint, setMeetingPoint] = useState("");
  const [purpose, setPurpose] = useState("");
  const [maxMembers, setMaxMembers] = useState("");
  // Seeded from the role; the toggle is then free to change it.
  const [visibility, setVisibility] = useState<Visibility>(
    leader ? "team_only" : "open_to_all"
  );

  const listId = useRef(`gv-clients-${Math.random().toString(36).slice(2, 8)}`).current;
  const teamOnly = visibility === "team_only";

  const canSubmit = companyName.trim().length > 0 && !busy;

  const summary = useMemo(() => {
    if (teamOnly) {
      return teamSize === 0
        ? "Only you can see this right now — nobody is linked to you as TSM or Manager."
        : `Visible to you and ${teamSize} agent${teamSize === 1 ? "" : "s"} under you.`;
    }
    return "Anyone in the company can see this and join.";
  }, [teamOnly, teamSize]);

  const submit = async () => {
    if (!companyName.trim()) {
      toast.error("Enter the company you are visiting.");
      return;
    }
    await onSubmit({
      companyName: companyName.trim(),
      companyAddress: address.trim(),
      visitDate,
      meetupTime: meetupTime.trim(),
      meetingPoint: meetingPoint.trim(),
      purpose: purpose.trim(),
      maxMembers: maxMembers.trim(),
      visibility,
    });
  };

  return (
    <div className="space-y-4">
      {/* Where */}
      <GvCard>
        <GvCardHeader
          icon={<MapPin size={18} />}
          title="Where are you going?"
          subtitle="The company name is the headline your team sees"
          tone="clay"
        />

        <div className="space-y-3.5">
          <GvInput
            label="Company name"
            value={companyName}
            onChange={setCompanyName}
            placeholder="ECOSHIFT HQ"
            required
            icon={<MapPin size={14} />}
            list={listId}
            hint={clientNames.length ? "Tap to reuse a client" : undefined}
          />
          <datalist id={listId}>
            {clientNames.slice(0, 200).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          <GvInput
            label="Company address"
            value={address}
            onChange={setAddress}
            placeholder="12 KM Northpoint, Baguio"
            icon={<MapPin size={14} />}
          />
        </div>
      </GvCard>

      {/* When */}
      <GvCard>
        <GvCardHeader
          icon={<CalendarDays size={18} />}
          title="When?"
          subtitle="Meet-up time flips the visit to Ongoing automatically"
        />

        <div className="space-y-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <GvInput
              label="Date of visit"
              value={visitDate}
              onChange={setVisitDate}
              type="date"
              icon={<CalendarDays size={14} />}
            />
            <GvInput
              label="Meet-up time"
              value={meetupTime}
              onChange={setMeetupTime}
              type="time"
              icon={<Timer size={14} />}
            />
          </div>

          <GvInput
            label="Meeting point"
            value={meetingPoint}
            onChange={setMeetingPoint}
            placeholder="Company lobby, 8:00 AM"
            icon={<MapPin size={14} />}
          />

          <GvTextarea
            label="Purpose / agenda"
            value={purpose}
            onChange={setPurpose}
            placeholder="e.g. System training for the new line, walkthrough with the plant supervisor."
            rows={3}
            maxLength={400}
          />

          <GvInput
            label="Max members"
            value={maxMembers}
            onChange={setMaxMembers}
            placeholder="Unlimited"
            type="number"
            icon={<Users size={14} />}
            hint="Leave blank for unlimited"
          />
        </div>
      </GvCard>

      {/* Who can see it */}
      <GvCard>
        <GvCardHeader
          icon={teamOnly ? <Users size={18} /> : <Globe size={18} />}
          title="Who can see this?"
          subtitle={
            leader
              ? "You're a team lead, so this starts restricted to your team"
              : "You created this, so it starts open to everyone"
          }
          tone={teamOnly ? "mint" : "info"}
        />

        <div
          className="rounded-[var(--r-card)] p-3.5 flex items-center justify-between gap-3"
          style={{
            background: teamOnly ? "var(--mint-soft)" : "var(--info-soft)",
          }}
        >
          <div className="min-w-0">
            <p
              className="text-[13px] font-extrabold flex items-center gap-1.5"
              style={{ color: teamOnly ? "var(--mint-strong)" : "var(--info)" }}
            >
              {teamOnly ? <Users size={14} /> : <Globe size={14} />}
              {teamOnly ? "My team only" : "Open to all"}
            </p>
            <p
              className="text-[11px] font-semibold mt-0.5 leading-snug"
              style={{ color: teamOnly ? "var(--mint-strong)" : "var(--info)" }}
            >
              {summary}
            </p>
          </div>

          <GvToggle
            checked={teamOnly}
            onChange={(v) => setVisibility(v ? "team_only" : "open_to_all")}
            label="Restrict to my team"
          />
        </div>

        {/* Say the toggle's meaning out loud, because the two directions read
            differently and a mis-set toggle silently hides the visit. */}
        <p className="text-[11px] font-semibold text-[var(--text-faint)] mt-2 leading-relaxed">
          {leader
            ? 'Turn this off to "Allow other teams to join" — the visit becomes visible company-wide.'
            : 'Turn this on to "Team only" — nobody outside your team will be able to find or join it.'}
        </p>

        {teamOnly && teamSize === 0 && (
          <div className="mt-3">
            <Hint icon={<Timer size={14} />}>
              Nobody is linked to you as their TSM or Manager, so a team-only visit would be
              visible to nobody but you. Link your agents first, or switch it to open.
            </Hint>
          </div>
        )}
      </GvCard>

      {/* Submit */}
      <div className="sticky bottom-0 -mx-4 px-4 pb-3 pt-2" style={{ background: "var(--bg)" }}>
        <Button full size="lg" loading={busy} disabled={!canSubmit} onClick={submit}>
          Create Group Visit
        </Button>

        <div className="flex items-center gap-2 mt-2">
          <Button variant="ghost" size="sm" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
        </div>

        <p className="text-[11px] font-semibold text-[var(--text-muted)] text-center mt-1 leading-relaxed">
          {visitDate ? `${formatVisitDate(visitDate)}` : "Pick a date"}
          {meetupTime ? ` · ${formatTime(meetupTime)}` : ""} ·{" "}
          {teamOnly ? `${teamSize} team member${teamSize === 1 ? "" : "s"} notified` : "Everyone notified"}
        </p>
      </div>
    </div>
  );
}

export type CreatePayload = {
  companyName: string;
  companyAddress: string;
  visitDate: string;
  meetupTime: string;
  meetingPoint: string;
  purpose: string;
  maxMembers: string;
  visibility: Visibility;
};