import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function lastStatus(
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
    const settingsCollection = db.collection("system_settings");

    // Fetch dynamic work day start
    const settings = await settingsCollection.findOne({ type: "global" });
    const officeStartTime = settings?.officeStartTime || "08:00";
    const [startH, startM] = officeStartTime.split(":").map(Number);

    // Work Day window (Dynamic start to Dynamic start next day)
    const now = new Date();
    const startOfWorkDay = new Date(now);
    startOfWorkDay.setHours(startH, startM, 0, 0);
    if (now < startOfWorkDay) {
      startOfWorkDay.setDate(startOfWorkDay.getDate() - 1);
    }

    const endOfWorkDay = new Date(startOfWorkDay);
    endOfWorkDay.setDate(endOfWorkDay.getDate() + 1);
    endOfWorkDay.setMilliseconds(-1);

    const lastActivityToday = await collection.findOne(
      {
        ReferenceID: referenceId.trim(),
        date_created: { $gte: startOfWorkDay, $lte: endOfWorkDay },
      },
      {
        sort: { date_created: -1 },
        projection: { Status: 1, date_created: 1 },
      }
    );

    if (!lastActivityToday) {
      // Return explicit null — never 404 so the client can handle cleanly
      return res.status(200).json(null);
    }

    return res.status(200).json({
      Status:       lastActivityToday.Status       ?? null,
      date_created: lastActivityToday.date_created ?? null,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch last status" });
  }
}