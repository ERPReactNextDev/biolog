import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function addActivityLog(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const {
      ReferenceID,
      Email,
      Type,
      Status,
      Location,
      Latitude,
      Longitude,
      PhotoURL,
      Remarks,
      TSM,
      SiteVisitAccount,
      FaceData,
      date_created: clientDateCreated, // offline timestamp from client
    } = req.body ?? {};

    /* ── Validation ───────────────────────── */
    if (
      !ReferenceID || typeof ReferenceID !== "string" ||
      !Email       || typeof Email !== "string" ||
      !Type        || typeof Type !== "string" ||
      !Status      || typeof Status !== "string"
    ) {
      return res.status(400).json({
        error: "Missing or invalid required fields: ReferenceID, Email, Type, Status",
      });
    }

    const validStatuses = ["Login", "Logout"];
    if (!validStatuses.includes(Status)) {
      return res.status(400).json({
        error: `Invalid Status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    /* ── Resolve the actual timestamp ─────────────────────────────────────
     * For offline submissions the client sends the original timestamp so the
     * record lands on the correct work-day. Fall back to now() if absent or
     * invalid (e.g. online submissions that don't send date_created).
     */
    let resolvedDate: Date;
    if (clientDateCreated) {
      const parsed = new Date(clientDateCreated);
      resolvedDate = isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      resolvedDate = new Date();
    }

    /* ── DB connection ───────────────────── */
    let db;
    try {
      db = await connectToDatabase();
    } catch {
      return res.status(503).json({
        error: "Database connection failed. Please try again.",
      });
    }

    const collection         = db.collection("TaskLog");
    const settingsCollection = db.collection("system_settings");

    // Fetch dynamic work-day start
    const settings        = await settingsCollection.findOne({ type: "global" });
    const officeStartTime = settings?.officeStartTime || "08:00";
    const [startH, startM] = officeStartTime.split(":").map(Number);

    /* ── Day window based on the RESOLVED date ──────────────────────────── */
    const startOfDay = new Date(resolvedDate);
    startOfDay.setHours(startH, startM, 0, 0);
    if (resolvedDate < startOfDay) {
      startOfDay.setDate(startOfDay.getDate() - 1);
    }

    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    endOfDay.setMilliseconds(-1);

    /* ── Duplicate check ────────────────────────────────────────────────── */
    const lastActivityToday = await collection.findOne(
      {
        ReferenceID,
        date_created: { $gte: startOfDay, $lte: endOfDay },
      },
      { sort: { date_created: -1 } }
    );

    if (
      lastActivityToday?.Status === Status &&
      lastActivityToday?.Type === Type
    ) {
      return res.status(409).json({
        error: `Duplicate: already ${Status.toLowerCase()} for ${Type} on this work day.`,
      });
    }

    /* ── Build document ─────────────────── */
    const newLog: Record<string, unknown> = {
      ReferenceID:  ReferenceID.trim(),
      Email:        Email.trim(),
      Type:         Type.trim(),
      Status:       Status.trim(),
      Remarks:      typeof Remarks === "string" ? Remarks.trim() : "",
      TSM:          typeof TSM === "string" ? TSM.trim() : "",
      date_created: resolvedDate,   // use original offline time, not server time
    };

    if (typeof Location === "string" && Location.trim())
      newLog.Location = Location.trim();

    if (typeof Latitude === "number" && isFinite(Latitude))
      newLog.Latitude = Latitude;

    if (typeof Longitude === "number" && isFinite(Longitude))
      newLog.Longitude = Longitude;

    if (typeof PhotoURL === "string" && PhotoURL.trim())
      newLog.PhotoURL = PhotoURL.trim();

    if (typeof SiteVisitAccount === "string" && SiteVisitAccount.trim())
      newLog.SiteVisitAccount = SiteVisitAccount.trim();

    if (FaceData && typeof FaceData === "object")
      newLog.FaceData = FaceData;

    /* ── Insert ─────────────────────────── */
    const result = await collection.insertOne(newLog);

    if (!result.acknowledged) {
      throw new Error("MongoDB insertOne was not acknowledged");
    }

    return res.status(201).json({
      message:      `${Status} recorded successfully`,
      id:           result.insertedId.toString(),
      date_created: resolvedDate.toISOString(),
    });

  } catch (error) {
    console.error("[AddLog] Unhandled error:", error);
    return res.status(500).json({
      error: "Failed to add activity log. Please try again.",
    });
  }
}
