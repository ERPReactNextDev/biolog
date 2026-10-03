/* ============================================================================
   /api/admin/geo-flags  ·  the attendance review queue
   ----------------------------------------------------------------------------
   Lists tasklog rows carrying a location-quality flag, so a manager can look
   at the ones that need a human: an out-of-fence visit, a low-accuracy fix, a
   log that was filled in offline.

   WHAT COUNTS AS FLAGGED
   Exactly one row per attendance record, not one row per problem. A visit that
   is both outside the fence AND low-accuracy is stored as outside_geofence —
   the higher-priority flag wins — so this list never shows the same visit
   twice under two headings, and the manager is not asked to triage duplicates.

   WHY IT READS `tasklog` AND NOT THE VIEW
   v_attendance_geo_flags in migration 20260106 gives the same shape including
   the agent's name. A PostgREST view cannot be joined back to users, so
   reviewing (marking as seen) needs a second round trip. Reading the table
   directly keeps this to one request and lets PATCH address a row by id.

   company_id IS FILTERED ONLY WHEN THE CALLER HAS ONE
   See the note in tenantFilter below — this is an app-wide convention, not a
   per-file decision.
   ========================================================================== */

import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard, SessionUser } from "@/lib/rbac";

/* NO POSTGREST EMBED HERE, DELIBERATELY

   The obvious query is
       select(..., users("Firstname","Lastname"))
   and it fails with PGRST200 "Could not find a relationship between 'tasklog'
   and 'users'" — verified against the live database, not assumed.

   PostgREST only allows an embed when it can see a FOREIGN KEY in its schema
   cache. tasklog."ReferenceID" -> users."ReferenceID" is not one, and adding it
   would be wrong anyway: users."ReferenceID" is not UNIQUE on this install
   (the same reason group_visitations deliberately has no FK to it), so a real
   FK cannot be created without deduplicating live data.

   So the name is resolved in a SECOND query. The cost is one extra round trip
   on a page a manager opens occasionally; the benefit is that it works today
   with no schema change and no risk of an FK failing to be added. */
const COLUMNS =
  'id, "ReferenceID", "Type", "Status", "SiteVisitAccount", "Location", "Latitude", ' +
  '"Longitude", "PhotoURL", "Remarks", "GeoAccuracyM", "GeoSource", "GeoFlag", ' +
  '"GeoDistanceM", "GeoSiteName", "GeoReviewed", "GeoReviewedBy", "GeoReviewedAt", ' +
  'date_created, "Manager", "TSM"';

const NOT_MIGRATED = new Set(["42P01", "42703", "PGRST204"]);

function tenantFilter(query: any, user: SessionUser) {
  return user.companyId != null ? query.eq("company_id", user.companyId) : query;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabase) {
    return res.status(500).json({ error: "Database connection error" });
  }

  if (req.method === "GET") {
    /* can_view_reports, not can_manage_settings: looking at where your team
       clocked in is a reporting act, and a supervisor who cannot open
       Reports should not be locked out of attendance review either. */
    const user = await guard(req, res, "can_view_reports");
    if (!user) return;

    const showReviewed = req.query.reviewed === "1";
    const flag = typeof req.query.flag === "string" ? req.query.flag : null;

    try {
      let q = supabase
        .from("tasklog")
        .select(COLUMNS)
        .not("GeoFlag", "is", null);

      q = showReviewed ? q.eq("GeoReviewed", true) : q.eq("GeoReviewed", false);
      if (flag) q = q.eq("GeoFlag", flag);

      q = tenantFilter(q, user);

      const { data, error } = await q
        .order("date_created", { ascending: false })
        .limit(200);

      if (error) {
        if (NOT_MIGRATED.has(error.code)) {
          return res.status(200).json({
            success: true,
            rows: [],
            reason: "not_configured",
          });
        }
        throw error;
      }

      const flagged = data || [];

      /* Second query for the agent names — see the note on COLUMNS. Keyed by
         ReferenceID in a Map so a duplicate (which is possible, see above)
         resolves to one name instead of blanking every row that shares it.

         A failure here is not fatal: the rows are what matter, and a manager
         looking at a flagged visit needs the measurements far more than the
         name. The UI already falls back to showing the ReferenceID. */
      const refIds = [...new Set(flagged.map((r: any) => r.ReferenceID).filter(Boolean))];
      const names = new Map<string, string>();

      if (refIds.length) {
        const { data: people } = await supabase
          .from("users")
          .select('"ReferenceID", "Firstname", "Lastname"')
          .in("ReferenceID", refIds);
        for (const u of people || []) {
          if (!u.ReferenceID) continue;
          names.set(
            u.ReferenceID,
            `${u.Firstname || ""} ${u.Lastname || ""}`.trim() || u.ReferenceID
          );
        }
      }

      const rows = flagged.map((r: any) => ({
        id: r.id,
        referenceId: r.ReferenceID,
        type: r.Type,
        status: r.Status,
        siteVisitAccount: r.SiteVisitAccount,
        location: r.Location,
        latitude: r.Latitude,
        longitude: r.Longitude,
        photoUrl: r.PhotoURL,
        remarks: r.Remarks,
        accuracyM: r.GeoAccuracyM,
        source: r.GeoSource,
        flag: r.GeoFlag,
        distanceM: r.GeoDistanceM,
        siteName: r.GeoSiteName,
        reviewed: r.GeoReviewed,
        reviewedBy: r.GeoReviewedBy,
        reviewedAt: r.GeoReviewedAt,
        dateCreated: r.date_created,
        agentName: names.get(r.ReferenceID) || null,
        manager: r.Manager,
        tsm: r.TSM,
      }));

      return res.status(200).json({ success: true, rows });
    } catch (err: any) {
      console.error("[geo-flags] GET failed:", err);
      return res.status(500).json({ error: "Could not load flagged records." });
    }
  }

  if (req.method === "PATCH") {
    const user = await guard(req, res, "can_view_reports");
    if (!user) return;

    const id = req.query.id;
    if (typeof id !== "string" || !id) {
      return res.status(400).json({ error: "Missing record id." });
    }

    const { data, error } = await supabase
      .from("tasklog")
      .update({
        GeoReviewed: true,
        GeoReviewedBy: user.referenceId || String(user.id),
        GeoReviewedAt: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, GeoReviewed, GeoReviewedBy, GeoReviewedAt")
      .maybeSingle();

    if (error) {
      if (NOT_MIGRATED.has(error.code)) {
        return res.status(200).json({ success: true, reason: "not_configured" });
      }
      throw error;
    }
    if (!data) return res.status(404).json({ error: "That record no longer exists." });

    return res.status(200).json({ success: true, record: data });
  }

  res.setHeader("Allow", ["GET", "PATCH"]);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}