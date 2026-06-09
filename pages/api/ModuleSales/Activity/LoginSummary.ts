import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

/* ── Simple in-memory cache (per server instance) ── */
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5000; // 5 seconds

export default async function loginSummary(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    if (!supabase) {
      console.error("[LoginSummary] Supabase client not initialized.");
      return res.status(500).json({ error: "Database connection error" });
    }

    const { referenceId } = req.query;

    if (!referenceId || typeof referenceId !== "string" || !referenceId.trim()) {
      return res.status(400).json({ error: "referenceId query param is required" });
    }

    const ref = referenceId.trim();

    /* ── CACHE CHECK ── */
    const cached = cache.get(ref);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return res.status(200).json(cached.data);
    }

    /* ── Manila Time (UTC+8) ── */
    const offset = 8 * 60 * 60 * 1000;
    const now = new Date(Date.now() + offset);

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    const startUTC = new Date(start.getTime() - offset);
    const endUTC = new Date(end.getTime() - offset);

    /* ── SINGLE QUERY ONLY ── */
    const { data: last, error } = await supabase
      .from("tasklog")
      .select("Status, date_created")
      .eq("ReferenceID", ref)
      .gte("date_created", startUTC.toISOString())
      .lte("date_created", endUTC.toISOString())
      .order("date_created", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Supabase login summary error:", error);
      return res.status(503).json({ error: "Database error" });
    }

    const response = {
      lastStatus: last?.Status ?? null,
      lastTime: last?.date_created ?? null,
    };

    /* ── SAVE TO CACHE ── */
    cache.set(ref, { data: response, ts: Date.now() });

    return res.status(200).json(response);

  } catch (error) {
    console.error("[LoginSummary] error:", error);
    return res.status(500).json({ error: "Failed to fetch login summary" });
  }
}