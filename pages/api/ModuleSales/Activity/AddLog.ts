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

    /* ── DB connection ───────────────────── */
    let db;
    try {
      db = await connectToDatabase();
    } catch (dbErr) {
      console.error("DB connection error:", dbErr);
      return res.status(503).json({
        error: "Database connection failed. Please try again.",
      });
    }

    const collection = db.collection("TaskLog");
    const settingsCollection = db.collection("system_settings");

    // Fetch dynamic work day start
    const settings = await settingsCollection.findOne({ type: "global" });
    const officeStartTime = settings?.officeStartTime || "08:00";
    const [startH, startM] = officeStartTime.split(":").map(Number);

    /* ── Day window (Dynamic start → Dynamic start) ─────────── */
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(startH, startM, 0, 0);
    if (now < startOfDay) {
      startOfDay.setDate(startOfDay.getDate() - 1);
    }

    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    endOfDay.setMilliseconds(-1);

    /* ── Duplicate check (KEEP THIS) ───── */
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
        error: `You are already ${Status.toLowerCase()} for ${Type}.`,
      });
    }

    /* ── Build document ─────────────────── */
    const newLog: Record<string, unknown> = {
      ReferenceID: ReferenceID.trim(),
      Email: Email.trim(),
      Type: Type.trim(),
      Status: Status.trim(),
      Remarks: typeof Remarks === "string" ? Remarks.trim() : "",
      TSM: typeof TSM === "string" ? TSM.trim() : "",
      date_created: new Date(),
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
      message: `${Status} recorded successfully`,
      id: result.insertedId.toString(),
    });

  } catch (error) {
    console.error("Error adding activity log:", error);
    return res.status(500).json({
      error: "Failed to add activity log. Please try again.",
    });
  }
}