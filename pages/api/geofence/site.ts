/* ============================================================================
   GET /api/geofence/site?site=<name>
   ----------------------------------------------------------------------------
   Resolves the client-site fence for the company an agent is visiting, so the
   attendance sheet can draw it and warn BEFORE the agent submits.

   WHY THIS IS A SEPARATE ROUTE
   The fences live in `client_sites` — configuration, not history — while the
   attendance itself is a row in `tasklog`. This route only ever reads config.

   WHY IT REQUIRES A SESSION
   Fence coordinates describe where a company's premises are. That is not
   public information: an unauthenticated caller must not be able to enumerate
   client locations by guessing names. So no session, no 401 — same rule as
   every other /api route in this app.

   IT IS A HINT, NOT A GATE
   The authoritative check is in AddLog.ts, which recomputes the fence from its
   own lookup. If this route is bypassed, tampered with, or offline, the
   submission still gets the correct GeoFlag. A client-side fence check is only
   ever allowed to be a convenience.
   ========================================================================== */

import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { requireSession } from "@/lib/rbac";
import { normalizeSiteName } from "@/lib/geofence";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  if (!supabase) {
    return res.status(500).json({ error: "Database connection error" });
  }

  const user = await requireSession(req, res);
  if (!user) return; // 401 already written

  const raw = req.query.site;
  const name = typeof raw === "string" ? raw : "";
  const q = normalizeSiteName(name);

  // An empty name is a normal state, not an error: an agent who has not picked
  // a company yet has no site to fence against. Returning 200 with no site
  // keeps the caller from treating "nothing configured" as a failure.
  if (!q) {
    return res.status(200).json({ success: true, site: null });
  }

  try {
    /* `.eq("name_key", q)` hits idx_client_sites_name_key. The obvious
       alternative — `.ilike("name", ...)` — generates `name ILIKE $1`, which
       cannot use an index at all and degrades to a scan of every fence on
       every attendance submission. */
    const { data, error } = await supabase
      .from("client_sites")
      .select("id, name, latitude, longitude, radius_meters, address, company_id")
      .eq("name_key", q)
      .eq("is_active", true)
      .limit(10);

    if (error) {
      // 42P01 = relation missing, 42703 = the generated column missing. Either
      // way the migration has not been run. That is NOT an error the agent
      // needs to see — an install without client_sites simply has no
      // per-client fences, which is how the app behaved before this feature.
      if (error.code === "42703" || error.code === "42P01") {
        return res.status(200).json({ success: true, site: null, reason: "not_configured" });
      }
      console.error("[geofence/site] lookup failed:", error);
      return res.status(200).json({ success: true, site: null });
    }

    const rows = (data || []) as any[];
    if (!rows.length) {
      return res.status(200).json({ success: true, site: null });
    }

    /* Same client name may be fenced independently under two tenants. Prefer
       the caller's own company, then the shared default (company_id NULL),
       then anything. The result set is at most 10 rows of a single name, so
       this is a trivial sort — and it avoids the alternative of writing a
       tenant filter that silently returns nothing for the many users whose
       company_id is still unassigned. */
    const rank = (r: any) =>
      user.companyId != null && r.company_id === user.companyId
        ? 0
        : r.company_id == null
          ? 1
          : 2;
    const match = [...rows].sort((a, b) => rank(a) - rank(b))[0];

    return res.status(200).json({
      success: true,
      site: {
        siteName: match.name,
        centerLat: Number(match.latitude),
        centerLng: Number(match.longitude),
        radiusMeters: Number(match.radius_meters) || 100,
        address: match.address ?? null,
      },
    });
  } catch (err: any) {
    console.error("[geofence/site] unexpected:", err);
    // Never 500 the attendance sheet over a fence lookup.
    return res.status(200).json({ success: true, site: null });
  }
}