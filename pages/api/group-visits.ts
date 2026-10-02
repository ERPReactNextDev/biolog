import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { requireSession, hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  canJoin,
  canSee,
  deriveStatus,
  isTeamLeaderRole,
  loadTeamIndex,
  scopeToCompany,
  seatsLeft,
  teamOf,
  type GroupVisit,
  type Member,
  type Visibility,
  type Viewer,
} from "@/lib/group-visits";

/* ============================================================================
   /api/group-visits

   GET  → the feed this viewer is ALLOWED to see, plus each card's join state
   POST → create (creator is auto-joined, eligible team is notified)

   Every restriction decision is made HERE from the team index. The UI hides
   things for convenience; a crafted request cannot widen access.
   ========================================================================== */

/** Company the caller belongs to, used for tenant scoping. */
async function companyIdFor(userId: number | string): Promise<number | string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  return (data?.company_id as number | string | null) ?? null;
}

/** Memberships for the given visits, in one query rather than one per card. */
async function membersFor(visitIds: (number | string)[]): Promise<Map<string, Member[]>> {
  const byVisit = new Map<string, Member[]>();
  if (!visitIds.length || !supabase) return byVisit;

  const { data } = await supabase
    .from("group_visit_members")
    .select('group_visit_id, "ReferenceID", joined_at, checked_in')
    .in("group_visit_id", visitIds as number[]);

  for (const m of (data || []) as Array<Member & { group_visit_id: number }>) {
    const key = String(m.group_visit_id);
    if (!byVisit.has(key)) byVisit.set(key, []);
    byVisit.get(key)!.push(m);
  }
  return byVisit;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  if (!supabase) return res.status(500).json({ error: "Database is not configured." });
  if (!checkRateLimit(req, res, { limit: 90, windowMs: 60_000, scope: "group-visits" })) return;

  const user = await requireSession(req, res);
  if (!user) return;

  const viewer: Viewer = { referenceId: user.referenceId, role: user.role, email: user.email };
  const idx = await loadTeamIndex();

  /* ── GET · the feed ─────────────────────────────────────────────────────── */

  if (req.method === "GET") {
    const scope = String(req.query.scope || "feed").toLowerCase();

    let query = supabase.from("group_visitations").select("*");

    // A single visit: still filtered through canSee, so a team-only visit can't
    // be read by guessing its id.
    if (scope === "one") {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: "id is required" });
      query = query.eq("id", id);
    }

    const { data, error } = await query.order("VisitDate", { ascending: true }).limit(300);
    if (error) {
      console.error("[group-visits] GET error:", error);
      return res.status(500).json({ error: "Could not load group visits." });
    }

    const companyId = await companyIdFor(user.id);
    const all = scopeToCompany((data || []) as GroupVisit[], companyId);

    // Visibility gate — the whole point of the feature.
    const visible = all.filter((gv) => canSee(idx, gv, viewer));

    const membersBy = await membersFor(visible.map((g) => g.id));

    const cards = visible.map((gv) => {
      const members = membersBy.get(String(gv.id)) || [];
      const check = canJoin(idx, gv, viewer);
      const isMember = members.some((m) => m.ReferenceID === viewer.referenceId);
      const isCreator = gv.ReferenceID_creator === viewer.referenceId;
      const seats = seatsLeft(gv, members.length);

      // Keep creator identity resolved from the index when the snapshot is thin.
      const creatorPerson = idx.get(gv.ReferenceID_creator);
      const creatorName =
        gv.CreatorName?.trim() || fullName(creatorPerson) || gv.ReferenceID_creator;

      // Names + avatars for the stack, resolved from the index we already hold
      // rather than a second query per member.
      const memberList: Member[] = members.map((m) => {
        const p = idx.get(m.ReferenceID);
        return {
          ReferenceID: m.ReferenceID,
          joined_at: m.joined_at,
          checked_in: m.checked_in,
          Firstname: p?.Firstname ?? null,
          Lastname: p?.Lastname ?? null,
          profilePicture: p?.profilePicture ?? null,
        };
      });

      return {
        ...gv,
        Status: deriveStatus(gv),
        relativeDay: String(gv.VisitDate).slice(0, 10) === phToday() ? "Today" : undefined,
        creatorName,
        creatorRole: gv.CreatorRole || creatorPerson?.Role || null,
        members: members.length,
        memberList,
        isMember,
        isCreator,
        canJoin: check.ok && !isMember && (seats === null || seats > 0),
        joinBlockedReason: check.ok
          ? seats === 0
            ? "This group visit is already full."
            : null
          : check.reason,
        seatsLeft: seats,
      };
    });

    return res.status(200).json({
      visits: cards,
      members: cards.map((c) => [String(c.id), c.memberList]),
      viewer: {
        referenceId: viewer.referenceId,
        role: viewer.role,
        // How many agents a team-only visit would reach, so the create form can
        // say "you and N agents" without a second round trip.
        teamSize: teamOf(idx, viewer.referenceId).size,
        isTeamLeader: isTeamLeaderRole(viewer.role),
      },
      counts: {
        all: cards.length,
        today: cards.filter((c) => c.relativeDay === "Today").length,
        joined: cards.filter((c) => c.isMember).length,
        mine: cards.filter((c) => c.isCreator).length,
      },
    });
  }

  /* ── POST · create ──────────────────────────────────────────────────────── */

  const {
    companyName,
    companyAddress,
    visitDate,
    meetupTime,
    meetingPoint,
    purpose,
    maxMembers,
    visibility,
  } = (req.body || {}) as Record<string, unknown>;

  const name = String(companyName || "").trim();
  if (!name) {
    return res.status(400).json({ error: "Company name is required." });
  }
  if (name.length > 160) {
    return res.status(400).json({ error: "Company name is too long." });
  }

  let visitDay = String(visitDate || "").trim();
  if (visitDay && !/^\d{4}-\d{2}-\d{2}$/.test(visitDay)) {
    return res.status(400).json({ error: "Visit date must be a YYYY-MM-DD date." });
  }
  if (!visitDay) visitDay = phToday();

  let meetup: string | null = null;
  const rawMeetup = String(meetupTime || "").trim();
  if (rawMeetup) {
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(rawMeetup)) {
      return res.status(400).json({ error: "Meet-up time must be HH:MM." });
    }
    meetup = rawMeetup.length === 5 ? `${rawMeetup}:00` : rawMeetup;
  }

  // Any agent may create a group visit; only the DEFAULT visibility depends on
  // the creator's role, and an explicit choice always wins.
  const leader = isTeamLeaderRole(user.role);
  const requested = String(visibility || "").trim().toLowerCase();
  let vis: Visibility;
  if (requested === "team_only" || requested === "open_to_all") {
    vis = requested as Visibility;
  } else {
    vis = leader ? "team_only" : "open_to_all";
  }

  const cap =
    maxMembers === "" || maxMembers === null || maxMembers === undefined
      ? null
      : Number(maxMembers);
  if (cap !== null && (!Number.isInteger(cap) || cap < 1)) {
    return res.status(400).json({ error: "Max members must be a whole number of 1 or more." });
  }

  const companyId = await companyIdFor(user.id);
  const creatorPerson = idx.get(user.referenceId);
  const creatorName =
    fullName(creatorPerson) || user.email || user.referenceId || "Unknown organiser";

  const row = {
    ReferenceID_creator: user.referenceId,
    CreatorRole: user.role,
    CreatorName: creatorName,
    CompanyName: name,
    CompanyAddress: String(companyAddress || "").trim() || null,
    VisitDate: visitDay,
    MeetupTime: meetup,
    MeetingPoint: String(meetingPoint || "").trim() || null,
    Purpose: String(purpose || "").trim() || null,
    MaxMembers: cap,
    Visibility: vis,
    Status: "Upcoming" as const,
    date_created: new Date().toISOString(),
    company_id: companyId,
  };

  const { data: created, error: insErr } = await supabase
    .from("group_visitations")
    .insert(row)
    .select("*")
    .single();

  if (insErr) {
    console.error("[group-visits] insert error:", insErr);
    return res.status(500).json({ error: "Could not create the group visit." });
  }

  const visit = created as GroupVisit;

  // Creator is always a member.
  await supabase
    .from("group_visit_members")
    .insert({ group_visit_id: visit.id, ReferenceID: user.referenceId });

  /* Notify the people who can actually join it. For a team-only visit that is
     the team; for an open one it is everyone in the tenant. Best effort — a
     failed bell must not undo the visit. */
  let notified = 0;
  try {
    const recipients = new Set<string>();
    if (vis === "team_only") {
      for (const ref of teamOf(idx, user.referenceId)) {
        if (ref !== user.referenceId) recipients.add(ref);
      }
    } else {
      for (const [ref, person] of idx) {
        if (ref === user.referenceId) continue;
        if (String(person.company_id ?? "") === String(companyId ?? "")) recipients.add(ref);
      }
    }

    const { insertNotification } = await import("@/lib/notifications");
    for (const ref of recipients) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await insertNotification({
        referenceId: ref,
        // Its own type, not ob_submitted — see migration STEP 4.
        type: "group_visit",
        title: `New group visit — ${name}`,
        message: `${creatorName} · ${meetingPoint || "Meeting point not set"}`,
        linkUrl: "/group-visitation",
        companyId,
        meta: { groupVisitId: visit.id, visitDate: visitDay, visibility: vis },
      });
      if (ok) notified += 1;
    }
  } catch (err) {
    console.warn("[group-visits] notification fan-out failed:", err);
  }

  return res.status(201).json({
    visit: { ...visit, Status: deriveStatus(visit), members: 1, isMember: true, isCreator: true },
    notified,
    visibility: vis,
  });
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function fullName(p?: { Firstname?: string | null; Lastname?: string | null } | null): string {
  return `${(p?.Firstname || "").trim()} ${(p?.Lastname || "").trim()}`.trim();
}

function phToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}