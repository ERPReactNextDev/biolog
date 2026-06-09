import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle GET - List all GPS Reports
  if (req.method === "GET") {
    try {
      const { data: reports, count, error } = await supabase
        .from("gps_reports")
        .select("*", { count: "exact" })
        .order("date_created", { ascending: false })
        .limit(10);
      
      if (error) throw error;
      
      return res.status(200).json({
        collection: "gps_reports",
        totalCount: count,
        reports: reports,
      });
    } catch (error) {
      console.error("fetch gps-report error:", error);
      return res.status(500).json({ error: "Failed to fetch reports" });
    }
  }

  // Handle POST - Submit GPS Report
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST", "GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const {
      ReferenceID,
      Email,
      TSM,
      photos,
      loginDate,
      logoutDate,
      remarks,
      gpsLocation,
    } = req.body ?? {};

    /* ── Validation ───────────────────────── */
    if (
      !ReferenceID || typeof ReferenceID !== "string" ||
      !Email       || typeof Email !== "string"
    ) {
      return res.status(400).json({
        error: "Missing or invalid required fields: ReferenceID, Email",
      });
    }

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({
        error: "At least one photo is required",
      });
    }

    if (!loginDate || !logoutDate) {
      return res.status(400).json({
        error: "Login and logout dates are required",
      });
    }

    if (!remarks || typeof remarks !== "string" || remarks.trim().length === 0) {
      return res.status(400).json({
        error: "Remarks are required",
      });
    }

    if (!gpsLocation || typeof gpsLocation.lat !== "number" || typeof gpsLocation.lng !== "number") {
      return res.status(400).json({
        error: "GPS location with valid latitude and longitude is required",
      });
    }

    /* ── Build document ─────────────────── */
    const loginD = new Date(loginDate);
    const logoutD = new Date(logoutDate);

    if (isNaN(loginD.getTime()) || isNaN(logoutD.getTime())) {
      return res.status(400).json({ error: "Invalid loginDate or logoutDate format" });
    }

    const newReport: any = {
      ReferenceID: ReferenceID.trim(),
      Email: Email.trim(),
      Type: "GPS Report",
      Status: "Submitted",
      Remarks: remarks.trim(),
      TSM: typeof TSM === "string" ? TSM.trim() : "",
      PhotoURL: photos,
      loginDate: loginD.toISOString(),
      logoutDate: logoutD.toISOString(),
      Latitude: gpsLocation.lat.toString(),
      Longitude: gpsLocation.lng.toString(),
      Location: gpsLocation.address || "",
      reviewStatus: "pending",
      date_created: new Date().toISOString(),
    };

    /* ── Insert ─────────────────────────── */
    const { data, error: insertError } = await supabase
      .from("gps_reports")
      .insert(newReport)
      .select()
      .single();

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      throw insertError;
    }

    return res.status(201).json({
      message: "GPS Report submitted successfully",
      id: data.id.toString(),
      collection: "gps_reports",
    });

  } catch (error) {
    console.error("[gps-report] error:", error);
    return res.status(500).json({
      error: "Failed to submit GPS report. Please try again.",
    });
  }
}
