import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";
import { ObjectId } from "mongodb";

export default async function updateActivityLog(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", ["PUT"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { _id, Remarks } = req.body ?? {};

    if (!_id || typeof _id !== "string" || !_id.trim()) {
      return res.status(400).json({ error: "_id is required" });
    }

    if (Remarks === undefined || Remarks === null) {
      return res.status(400).json({ error: "Remarks field is required" });
    }

    // Validate ObjectId format before hitting the DB
    if (!ObjectId.isValid(_id.trim())) {
      return res.status(400).json({ error: "Invalid _id format" });
    }

    let db;
    try {
      db = await connectToDatabase();
    } catch (dbErr) {
      return res.status(503).json({ error: "Database connection failed. Please try again." });
    }

    const collection = db.collection("TaskLog");

    const result = await collection.updateOne(
      { _id: new ObjectId(_id.trim()) },
      {
        $set: {
          Remarks:   typeof Remarks === "string" ? Remarks.trim() : String(Remarks),
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Activity log not found" });
    }

    return res.status(200).json({ message: "Activity log updated successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update activity log" });
  }
}