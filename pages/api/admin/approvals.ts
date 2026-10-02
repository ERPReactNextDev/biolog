import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard } from "@/lib/rbac";

/**
 * GET /api/admin/approvals
 * query: ?filter=pending|approved|declined|all   (default pending)
 *
 * Reads public.gps_reports for the review queue. Column names are exactly as
 * they exist in the schema — nothing here creates or renames anything.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const admin = await guard(req, res, "can_review_gps");
  if (!admin) return;

  if (!supabase) {
    return res.status(500).json({ success: false, message: "Database connection error" });
  }

  const filter = String(req.query.filter || "pending").toLowerCase();

  let query = supabase
    .from("gps_reports")
    .select(
      'id, "ReferenceID", "Email", "Type", "Status", "Remarks", "TSM", "PhotoURL", loginDate, logoutDate, "Latitude", "Longitude", "Location", reviewStatus, "reviewedBy", "reviewNotes", "reviewedAt", date_created'
    )
    .order("date_created", { ascending: false })
    .limit(200);

  if (filter === "pending" || filter === "approved" || filter === "declined") {
    query = query.eq("reviewStatus", filter);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[approvals] query failed:", error);
    return res.status(500).json({ success: false, message: "Could not load reports." });
  }

  const rows = data || [];

  // Counts for the filter chips come from one extra aggregate rather than N
  // client-side requests.
  const { data: all } = await supabase
    .from("gps_reports")
    .select("reviewStatus")
    .limit(1000);

  const counts = { pending: 0, approved: 0, declined: 0 };
  for (const r of all || []) {
    const s = String(r.reviewStatus || "").toLowerCase();
    if (s === "pending") counts.pending++;
    else if (s === "approved") counts.approved++;
    else if (s === "declined") counts.declined++;
  }

  return res.status(200).json({
    success: true,
    reports: rows,
    counts,
    total: rows.length,
  });
}