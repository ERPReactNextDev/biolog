import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { requireSession } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  canJoin,
  deriveStatus,
  isFull,
  loadTeamIndex,
  type GroupVisit,
  type Viewer,
} from "@/lib/group-visits";

/* ============================================================================
   /api/group-visits/join
   body: { visitId, action: "join" | "leave" | "cancel" | "checkin" }

   THE ENFORCEMENT POINT.

   The disabled JOIN button in the UI is a convenience; this is the boundary.
   A team-only group visit rejects an outsider here with the reason from
   lib/group-visits.canJoin — the same function that built the feed — so what an
   agent is told and what the server does cannot drift apart.

   Cancel is creator-only. Leave is member-only. Check-in is member-only and
   only once the visit is Underway.
   ========================================================================== */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  if (!supabase) return res.status(500).json({ error: "Database is not configured." });
  if (!checkRateLimit(req, res, { limit: 90, windowMs: 60_000, scope: "group-join" })) return;

  const user = await requireSession(req, res);
  if (!user) return;

  const { visitId, action } = (req.body || {}) as Record<string, unknown>;
  const act = String(action || "").trim().toLowerCase();

  if (!visitId || !/^\d+$/.test(String(visitId))) {
    return res.status(400).json({ error: "A valid visitId is required." });
  }
  if (!["join", "leave", "cancel", "checkin"].includes(act)) {
    return res.status(400).json({ error: "Unknown action." });
  }

  const { data: visit, error: readErr } = await supabase
    .from("group_visitations")
    .select("*")
    .eq("id", visitId)
    .maybeSingle();

  if (readErr) {
    console.error("[group-join] read error:", readErr);
    return res.status(500).json({ error: "Could not load the group visit." });
  }
  if (!visit) return res.status(404).json({ error: "Group visit not found." });

  const gv = visit as GroupVisit;
  const viewer: Viewer = { referenceId: user.referenceId, role: user.role, email: user.email };
  const idx = await loadTeamIndex();

  const isCreator = gv.ReferenceID_creator === user.referenceId;
  const { data: membership } = await supabase
    .from("group_visit_members")
    .select("id, checked_in")
    .eq("group_visit_id", visitId)
    .eq("ReferenceID", user.referenceId)
    .maybeSingle();

  const isMember = Boolean(membership);
  const { count: memberCount } = await supabase
    .from("group_visit_members")
    .select("id", { count: "exact", head: true })
    .eq("group_visit_id", visitId);

  const count = memberCount || 0;

  /* ── JOIN ─────────────────────────────────────────────────────────────── */

  if (act === "join") {
    if (isMember) {
      return res.status(200).json({ ok: true, alreadyMember: true, members: count });
    }

    // The restriction check. Same function the feed used to render the button.
    const check = canJoin(idx, gv, viewer);
    if (!check.ok) {
      return res.status(403).json({ error: check.reason, restricted: true });
    }

    const status = deriveStatus(gv);
    if (status === "Completed") {
      return res.status(400).json({ error: "This group visit has already finished." });
    }
    if (isFull(gv, count)) {
      return res.status(400).json({ error: "This group visit is already full." });
    }

    // onConflict doNothing makes the UNIQUE(group_visit_id, ReferenceID)
    // constraint the real race-condition guard — two taps cannot double-join.
    const { error: insErr } = await supabase
      .from("group_visit_members")
      .upsert(
        { group_visit_id: gv.id, ReferenceID: user.referenceId },
        { onConflict: "group_visit_id,ReferenceID", ignoreDuplicates: true }
      );

    if (insErr) {
      console.error("[group-join] join error:", insErr);
      return res.status(500).json({ error: "Could not join the group visit." });
    }

    // Tell the organiser someone joined.
    try {
      const { insertNotification } = await import("@/lib/notifications");
      const me = idx.get(user.referenceId);
      const who = `${(me?.Firstname || "").trim()} ${(me?.Lastname || "").trim()}`.trim();
      await insertNotification({
        referenceId: gv.ReferenceID_creator,
        type: "group_visit",
        title: `${who || "Someone"} joined ${gv.CompanyName}`,
        message: gv.MeetingPoint || null,
        linkUrl: "/group-visitation",
        companyId: gv.company_id ?? null,
        meta: { groupVisitId: gv.id, event: "join" },
      });
    } catch (err) {
      console.warn("[group-join] join notification failed:", err);
    }

    return res.status(200).json({ ok: true, joined: true, members: count + 1 });
  }

  /* ── LEAVE ────────────────────────────────────────────────────────────── */

  if (act === "leave") {
    if (!isMember) {
      return res.status(400).json({ error: "You have not joined this group visit." });
    }
    if (isCreator) {
      return res.status(400).json({
        error: "You created this group visit. Cancel it instead of leaving.",
      });
    }

    const { error: delErr } = await supabase
      .from("group_visit_members")
      .delete()
      .eq("group_visit_id", gv.id)
      .eq("ReferenceID", user.referenceId);

    if (delErr) {
      console.error("[group-join] leave error:", delErr);
      return res.status(500).json({ error: "Could not leave the group visit." });
    }

    try {
      const { insertNotification } = await import("@/lib/notifications");
      const me = idx.get(user.referenceId);
      const who = `${(me?.Firstname || "").trim()} ${(me?.Lastname || "").trim()}`.trim();
      await insertNotification({
        referenceId: gv.ReferenceID_creator,
        type: "group_visit",
        title: `${who || "Someone"} left ${gv.CompanyName}`,
        linkUrl: "/group-visitation",
        companyId: gv.company_id ?? null,
        meta: { groupVisitId: gv.id, event: "leave" },
      });
    } catch (err) {
      console.warn("[group-join] leave notification failed:", err);
    }

    return res.status(200).json({ ok: true, left: true, members: Math.max(0, count - 1) });
  }

  /* ── CANCEL (creator only) ─────────────────────────────────────────────── */

  if (act === "cancel") {
    if (!isCreator) {
      return res.status(403).json({ error: "Only the creator can cancel this group visit." });
    }
    if (deriveStatus(gv) === "Completed") {
      return res.status(400).json({ error: "This group visit has already finished." });
    }

    const { error: updErr } = await supabase
      .from("group_visitations")
      .update({ Status: "Cancelled" })
      .eq("id", gv.id);

    if (updErr) {
      console.error("[group-join] cancel error:", updErr);
      return res.status(500).json({ error: "Could not cancel the group visit." });
    }

    return res.status(200).json({ ok: true, cancelled: true });
  }

  /* ── CHECK IN (member only) ────────────────────────────────────────────── */

  if (!isMember) {
    return res.status(403).json({ error: "Join the group visit before checking in." });
  }

  const { error: ciErr } = await supabase
    .from("group_visit_members")
    .update({ checked_in: true, checked_in_at: new Date().toISOString() })
    .eq("group_visit_id", gv.id)
    .eq("ReferenceID", user.referenceId);

  if (ciErr) {
    console.error("[group-join] checkin error:", ciErr);
    return res.status(500).json({ error: "Could not check in." });
  }

  return res.status(200).json({ ok: true, checkedIn: true });
}