import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function updateActivityLog(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { id, Remarks } = req.body ?? {};

    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }

    if (Remarks === undefined || Remarks === null) {
      return res.status(400).json({ error: "Remarks field is required" });
    }

    const { error } = await supabase
      .from("tasklog")
      .update({
        Remarks:   typeof Remarks === "string" ? Remarks.trim() : String(Remarks),
      })
      .eq("id", id);

    if (error) {
      console.error("Supabase update error:", error);
      return res.status(404).json({ error: "Activity log not found" });
    }

    return res.status(200).json({ message: "Activity log updated successfully" });
  } catch (error) {
    console.error("[UpdateLog] error:", error);
    return res.status(500).json({ error: "Failed to update activity log" });
  }
}