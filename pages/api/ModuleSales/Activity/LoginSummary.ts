import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

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

    /* ── DB ── */
    let db;
    try {
      db = await connectToDatabase();
    } catch (dbErr) {
      return res.status(503).json({
        error: "Database connection failed. Please try again.",
      });
    }

    const collection = db.collection("TaskLog");

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
    const last = await collection.findOne(
      {
        ReferenceID: ref,
        date_created: { $gte: startUTC, $lte: endUTC },
      },
      {
        sort: { date_created: -1 },
        projection: { Status: 1, date_created: 1 },
      }
    );

    const response = {
      lastStatus: last?.Status ?? null,
      lastTime: last?.date_created ?? null,
      // ❌ removed loginCount (heavy)
    };

    /* ── SAVE TO CACHE ── */
    cache.set(ref, { data: response, ts: Date.now() });

    return res.status(200).json(response);

  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch login summary" });
  }
}