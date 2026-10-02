import { NextApiRequest, NextApiResponse } from "next";
import { requireSession } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { markRead } from "@/lib/notifications";

/* ============================================================================
   POST /api/notifications/read   body: { id }  — mark one read
   POST /api/notifications/read   body: {}       — mark all read

   Always scoped to the session's ReferenceID, so passing someone else's id can
   only ever match nothing.
   ========================================================================== */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  if (!checkRateLimit(req, res, { limit: 240, windowMs: 60_000, scope: "notif-read" })) return;

  const user = await requireSession(req, res);
  if (!user) return;

  if (!user.referenceId) {
    return res.status(200).json({ ok: true, updated: 0 });
  }

  const raw = (req.body || {}).id;
  const id = raw === undefined || raw === null || raw === "" ? null : raw;

  // Only numeric ids reach the query builder; anything else is ignored rather
  // than interpolated into a filter.
  if (id !== null && !/^\d+$/.test(String(id))) {
    return res.status(400).json({ error: "Invalid notification id." });
  }

  try {
    const updated = await markRead(user.referenceId, id);
    return res.status(200).json({ ok: true, updated });
  } catch (err) {
    console.error("[notifications] markRead error:", err);
    return res.status(500).json({ error: "Could not update notifications." });
  }
}