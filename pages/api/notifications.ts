import { NextApiRequest, NextApiResponse } from "next";
import { requireSession } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { ADMIN_BELL_TYPES, AGENT_BELL_TYPES, listFor, unreadCount } from "@/lib/notifications";

/* ============================================================================
   GET /api/notifications?bell=admin|agent

   Returns only the caller's own notifications. Which TYPES appear is decided by
   the bell: the admin bell shows OB approvals only, the agent bell shows their
   own OB decisions. An unknown `bell` value falls back to the agent list rather
   than widening anything.
   ========================================================================== */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // The bell polls, so the ceiling is high but still bounded.
  if (!checkRateLimit(req, res, { limit: 120, windowMs: 60_000, scope: "notif-read" })) return;

  const user = await requireSession(req, res);
  if (!user) return;

  const bell = String(req.query.bell || "agent").toLowerCase();
  const types = bell === "admin" ? ADMIN_BELL_TYPES : AGENT_BELL_TYPES;
  const countsOnly = req.query.count === "1";

  const referenceId = user.referenceId;
  if (!referenceId) {
    return res.status(200).json({ items: [], unread: 0 });
  }

  try {
    if (countsOnly) {
      const unread = await unreadCount(referenceId, types);
      return res.status(200).json({ unread });
    }

    const { items, unread } = await listFor(referenceId, types);
    return res.status(200).json({ items, unread });
  } catch (err) {
    console.error("[notifications] list error:", err);
    return res.status(500).json({ error: "Could not load notifications." });
  }
}