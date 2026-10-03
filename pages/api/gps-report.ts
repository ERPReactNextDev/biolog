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

    /* Location quality, stored but NOT derived from a client-sent flag.
       gps_reports has no geofence of its own — these are the raw measurements
       only, so the numbers are kept as sent and the reviewer sees them. A
       tampered accuracy is not a security boundary here; it is context on a
       report a human already reads. */
    const acc =
      typeof gpsLocation.accuracyM === "number" && Number.isFinite(gpsLocation.accuracyM)
        ? Math.max(0, Math.round(gpsLocation.accuracyM))
        : null;
    newReport.GeoAccuracyM = acc;
    if (gpsLocation.stale === true) newReport.GeoSource = "cached";
    else if (gpsLocation.source === "manual") newReport.GeoSource = "manual";
    else if (gpsLocation.source === "fallback") newReport.GeoSource = "fallback";
    if (acc !== null && acc > 50) newReport.GeoFlag = "low_accuracy";

    /* ── Insert ─────────────────────────── */
    const { data, error: insertError } = await supabase
      .from("gps_reports")
      .insert(newReport)
      .select()
      .single();

    if (insertError) {
      /* 42703 = the geo columns do not exist yet (migration 20260106 not run).
         The report itself is valid and the agent has already uploaded photos,
         so losing it over three optional columns is the wrong trade: retry once
         without them rather than returning 500 and making them resubmit. */
      if (insertError.code === "42703" || insertError.code === "PGRST204") {
        delete newReport.GeoAccuracyM;
        delete newReport.GeoSource;
        delete newReport.GeoFlag;
        console.warn(
          "[gps-report] Geo columns unavailable (run 20260106_location_accuracy.sql); " +
            "saved the report without location quality."
        );

        const retry = await supabase
          .from("gps_reports")
          .insert(newReport)
          .select()
          .single();

        if (retry.error) {
          console.error("Supabase insert error:", retry.error);
          throw retry.error;
        }

        return res.status(201).json({
          message: "GPS Report submitted successfully",
          id: retry.data.id.toString(),
          collection: "gps_reports",
          geo: null,
        });
      }

      console.error("Supabase insert error:", insertError);
      throw insertError;
    }

    return res.status(201).json({
      message: "GPS Report submitted successfully",
      id: data.id.toString(),
      collection: "gps_reports",
      geo: newReport.GeoFlag ?? null,
    });

  } catch (error) {
    console.error("[gps-report] error:", error);
    return res.status(500).json({
      error: "Failed to submit GPS report. Please try again.",
    });
  }
}
