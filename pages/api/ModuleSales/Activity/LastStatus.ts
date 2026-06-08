import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function lastStatus(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { referenceId, type } = req.query;

    if (!referenceId || typeof referenceId !== "string" || !referenceId.trim()) {
      return res.status(400).json({ error: "referenceId is required" });
    }
    if (!type || typeof type !== "string" || !type.trim()) {
      return res.status(400).json({ error: "type is required" });
    }

    const ref = referenceId.trim();
    const actType = type.trim();

    /* ── Manila Time (UTC+8) ── */
    const offset = 8 * 60 * 60 * 1000;
    const now = new Date(Date.now() + offset);

    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    const startUTC = new Date(start.getTime() - offset);
    const endUTC = new Date(end.getTime() - offset);

    const { data: last, error } = await supabase
      .from("tasklog")
      .select("Status, date_created")
      .eq("ReferenceID", ref)
      .eq("Type", actType)
      .gte("date_created", startUTC.toISOString())
      .lte("date_created", endUTC.toISOString())
      .order("date_created", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Supabase lastStatus error:", error);
      throw error;
    }

    return res.status(200).json({
      lastStatus: last?.Status ?? null,
      lastTime: last?.date_created ?? null,
    });

  } catch (error) {
    console.error("[LastStatus] error:", error);
    return res.status(500).json({ error: "Failed to fetch last status" });
  }
}