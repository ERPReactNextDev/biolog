import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function siteVisitCountToday(
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

    let db;
    try {
      db = await connectToDatabase();
    } catch (dbErr) {
      return res.status(503).json({ error: "Database connection failed. Please try again." });
    }

    const collection = db.collection("TaskLog");

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Count completed site visits (Type = "Client Visit", any Status)
    const count = await collection.countDocuments({
      ReferenceID: referenceId.trim(),
      Type: "Client Visit",
      date_created: { $gte: startOfToday, $lte: endOfToday },
    });

    return res.status(200).json({ count });
  } catch (error) {
    return res.status(500).json({ error: "Failed to count site visits" });
  }
}