import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { reportId, status, reviewedBy, reviewNotes } = req.body ?? {};

    // Validation
    if (!reportId) {
      return res.status(400).json({ error: "Report ID is required" });
    }

    if (!status || !["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
    }

    // Update the report
    const { error } = await supabase
      .from("gps_reports")
      .update({
        reviewStatus: status,
        reviewedBy: reviewedBy || "",
        reviewNotes: reviewNotes || "",
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .eq("id", reportId);

    if (error) {
      console.error("Supabase update error:", error);
      return res.status(404).json({ error: "Report not found" });
    }

    return res.status(200).json({
      message: `Report ${status} successfully`,
      reportId,
      status,
    });
  } catch (error) {
    console.error("[gps-report/update] error:", error);
    return res.status(500).json({
      error: "Failed to update report status. Please try again.",
    });
  }
}
