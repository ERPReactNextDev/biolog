/* ============================================================================
   /api/admin/website-inquiries  ·  the demo-request pipeline
   ----------------------------------------------------------------------------
   GET    list, filter by status / unread only
   PATCH  change status, assign an owner, save a note, mark read
   DELETE remove one

   PERMISSION
   Super Admin ONLY, on every method including DELETE — requireSuperAdmin() in
   lib/rbac.ts, not can_manage_settings.

   These rows hold a stranger's name, email, company and the contents of their
   message. `can_manage_settings` also passes for a delegated Admin, which is
   the wrong door for third-party PII, and a plain permission flag would mean a
   mis-clicked edit in the Users screen could expose every demo request on file.
   Nothing in the app needs this data day to day; it is read when someone
   actually calls a lead.

   The POST side is public by necessity (pages/api/public/website-inquiry.ts) —
   this one is not.

   WHY SELECT * IS NOT USED
   submitted_ip and user_agent are deliberately never returned. They identify
   the visitor, the pipeline does not need them to do its job, and putting them
   in an API response means they end up in browser devtools and any screenshot
   taken of the page.
   ========================================================================== */

import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { requireSuperAdmin } from "@/lib/rbac";

/* The omission is the point: see the header. */
const COLUMNS =
  "id, name, email, company, message, user_range, status, assigned_to, " +
  "notes, source_page, is_read, read_at, created_at, updated_at";

const STATUSES = ["new", "contacted", "closed", "spam"] as const;
type Status = (typeof STATUSES)[number];

const NOT_MIGRATED = new Set(["42P01", "42703", "PGRST204"]);

function notMigrated(res: NextApiResponse) {
  return res.status(200).json({
    success: true,
    rows: [],
    stats: null,
    reason: "not_configured",
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabase) {
    return res.status(500).json({ error: "Database connection error" });
  }

  /* ── GET ─────────────────────────────────────────────────────────────── */
  if (req.method === "GET") {
    const user = await requireSuperAdmin(req, res);
    if (!user) return;

    const statusQ = typeof req.query.status === "string" ? req.query.status : null;
    const unreadOnly = req.query.unread === "1";

    try {
      let q = supabase.from("website_inquiries").select(COLUMNS);

      /* An unknown status is ignored rather than 400'd: the value came from a
         URL, and the correct response to a stale bookmark is the full list, not
         an error the user cannot act on. */
      if (statusQ && (STATUSES as readonly string[]).includes(statusQ)) {
        q = q.eq("status", statusQ);
      }
      if (unreadOnly) q = q.eq("is_read", false);

      const { data, error } = await q
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        if (NOT_MIGRATED.has(error.code)) return notMigrated(res);
        throw error;
      }

      /* Counts come from a second, unfiltered read rather than from the rows
         just returned. Counting the current page would report 0 for any status
         the admin has filtered OUT, which is worse than not showing a count. */
      const { data: all, error: countErr } = await supabase
        .from("website_inquiries")
        .select("status, is_read");

      if (countErr && !NOT_MIGRATED.has(countErr.code)) {
        console.error("[website-inquiries] count failed:", countErr);
      }

      const counts: Record<string, number> = { all: 0, unread: 0 };
      STATUSES.forEach((s) => (counts[s] = 0));
      for (const r of all || []) {
        counts.all += 1;
        if (r.status in counts) counts[r.status] += 1;
        if (!r.is_read) counts.unread += 1;
      }

      return res.status(200).json({ success: true, rows: data || [], counts });
    } catch (err: any) {
      console.error("[website-inquiries] GET failed:", err);
      return res.status(500).json({ error: "Could not load inquiries." });
    }
  }

  /* ── PATCH ───────────────────────────────────────────────────────────── */
  if (req.method === "PATCH") {
    const admin = await requireSuperAdmin(req, res);
    if (!admin) return;

    const id = req.query.id;
    if (typeof id !== "string" || !id) {
      return res.status(400).json({ error: "Missing inquiry id." });
    }

    const b = (req.body || {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if ("status" in b) {
      const s = String(b.status);
      if (!(STATUSES as readonly string[]).includes(s)) {
        return res.status(400).json({
          error: `Status must be one of: ${STATUSES.join(", ")}`,
        });
      }
      patch.status = s;
    }

    if ("assigned_to" in b) {
      const v = typeof b.assigned_to === "string" ? b.assigned_to.trim() : "";
      patch.assigned_to = v ? v.slice(0, 120) : null;
    }

    if ("notes" in b) {
      const v = typeof b.notes === "string" ? b.notes : "";
      /* Truncate rather than 400. A note is scratch space; refusing the save
         because someone typed an extra character loses the whole edit. */
      patch.notes = v.trim() ? v.trim().slice(0, 2000) : null;
    }

    if ("is_read" in b) {
      patch.is_read = Boolean(b.is_read);
      patch.read_at = patch.is_read ? new Date().toISOString() : null;
    }

    const { data, error } = await supabase
      .from("website_inquiries")
      .update(patch)
      .eq("id", id)
      .select(COLUMNS)
      .maybeSingle();

    if (error) {
      if (NOT_MIGRATED.has(error.code)) {
        return res.status(200).json({ success: true, reason: "not_configured" });
      }
      throw error;
    }
    if (!data) return res.status(404).json({ error: "That inquiry no longer exists." });

    return res.status(200).json({ success: true, row: data });
  }

  /* ── DELETE ──────────────────────────────────────────────────────────── */
  if (req.method === "DELETE") {
    const admin = await requireSuperAdmin(req, res);
    if (!admin) return;

    const id = req.query.id;
    if (typeof id !== "string" || !id) {
      return res.status(400).json({ error: "Missing inquiry id." });
    }

    const { error } = await supabase.from("website_inquiries").delete().eq("id", id);
    if (error) {
      if (NOT_MIGRATED.has(error.code)) {
        return res.status(200).json({ success: true, reason: "not_configured" });
      }
      throw error;
    }

    return res.status(200).json({ success: true });
  }

  res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}