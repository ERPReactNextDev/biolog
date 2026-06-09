import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function siteVisitCountToday(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    if (!supabase) {
      console.error("[SiteVisitCountToday] Supabase client not initialized.");
      return res.status(500).json({ error: "Database connection error" });
    }

    const { referenceId } = req.query;

    if (!referenceId || typeof referenceId !== "string" || !referenceId.trim()) {
      return res.status(400).json({ error: "referenceId is required" });
    }

    const ref = referenceId.trim();

    /* ── Manila Time (UTC+8) ── */
    const offset = 8 * 60 * 60 * 1000;
    const now = new Date(Date.now() + offset);

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    const startUTC = new Date(start.getTime() - offset);
    const endUTC = new Date(end.getTime() - offset);

    const { count, error } = await supabase
      .from("tasklog")
      .select("*", { count: "exact", head: true })
      .eq("ReferenceID", ref)
      .eq("Type", "Site Visit")
      .gte("date_created", startUTC.toISOString())
      .lte("date_created", endUTC.toISOString());

    if (error) {
      console.error("Supabase count error:", error);
      throw error;
    }

    return res.status(200).json({ count: count || 0 });

  } catch (error) {
    console.error("[SiteVisitCountToday] error:", error);
    return res.status(500).json({ error: "Failed to fetch site visit count" });
  }
}