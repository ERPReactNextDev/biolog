import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";
import { ObjectId } from "mongodb";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { reportId, status, reviewedBy, reviewNotes } = req.body ?? {};

    // Validation
    if (!reportId || typeof reportId !== "string") {
      return res.status(400).json({ error: "Report ID is required" });
    }

    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
    }

    // Connect to database
    const db = await connectToDatabase();
    const collection = db.collection("GPSReports");

    // Update the report
    const result = await collection.updateOne(
      { _id: new ObjectId(reportId) },
      {
        $set: {
          reviewStatus: status,
          reviewedBy: reviewedBy || "",
          reviewNotes: reviewNotes || "",
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Report not found" });
    }

    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: "Report was not updated" });
    }

    console.log(`[GPS Report] Report ${reportId} updated to ${status} by ${reviewedBy}`);

    return res.status(200).json({
      message: `Report ${status} successfully`,
      reportId,
      status,
    });
  } catch (error) {
    console.error("[GPS Report Update] Error:", error);
    return res.status(500).json({
      error: "Failed to update report status. Please try again.",
    });
  }
}
