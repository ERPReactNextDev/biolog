import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Handle GET - List all GPS Reports
  if (req.method === "GET") {
    try {
      const db = await connectToDatabase();
      const collection = db.collection("GPSReports");
      
      const reports = await collection.find().sort({ date_created: -1 }).limit(10).toArray();
      const count = await collection.countDocuments();
      
      return res.status(200).json({
        database: db.databaseName,
        collection: "GPSReports",
        totalCount: count,
        reports: reports,
      });
    } catch (error) {
      console.error("[GPS Report] GET Error:", error);
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

    /* ── DB connection ───────────────────── */
    let db;
    try {
      db = await connectToDatabase();
      console.log("[GPS Report] Connected to database:", db.databaseName);
    } catch (dbErr) {
      console.error("[GPS Report] DB connection error:", dbErr);
      return res.status(503).json({
        error: "Database connection failed. Please try again.",
      });
    }

    // List all collections before insert
    const collectionsBefore = await db.listCollections().toArray();
    console.log("[GPS Report] Collections before insert:", collectionsBefore.map(c => c.name));

    const collection = db.collection("GPSReports");

    /* ── Build document ─────────────────── */
    const newReport: Record<string, unknown> = {
      ReferenceID: ReferenceID.trim(),
      Email: Email.trim(),
      Type: "GPS Report",
      Status: "Submitted",
      Remarks: remarks.trim(),
      TSM: typeof TSM === "string" ? TSM.trim() : "",
      PhotoURL: photos,
      loginDate: new Date(loginDate),
      logoutDate: new Date(logoutDate),
      Latitude: gpsLocation.lat,
      Longitude: gpsLocation.lng,
      Location: gpsLocation.address || "",
      reviewStatus: "pending",
      date_created: new Date(),
    };

    /* ── Insert ─────────────────────────── */
    console.log("[GPS Report] Inserting to collection: GPSReports in database:", db.databaseName);
    console.log("[GPS Report] Document:", { ReferenceID, Email, Type: newReport.Type, Status: newReport.Status });
    
    let result;
    try {
      result = await collection.insertOne(newReport);
      console.log("[GPS Report] Insert result:", {
        acknowledged: result.acknowledged,
        insertedId: result.insertedId?.toString(),
      });
    } catch (insertErr) {
      console.error("[GPS Report] INSERT ERROR:", insertErr);
      throw insertErr;
    }

    if (!result.acknowledged) {
      throw new Error("MongoDB insertOne was not acknowledged");
    }

    // Verify the insert by reading it back
    let verifyDoc;
    try {
      verifyDoc = await collection.findOne({ _id: result.insertedId });
      console.log("[GPS Report] Verified document found:", !!verifyDoc);
      if (verifyDoc) {
        console.log("[GPS Report] Verified doc details:", {
          _id: verifyDoc._id?.toString(),
          ReferenceID: verifyDoc.ReferenceID,
          Type: verifyDoc.Type,
          date_created: verifyDoc.date_created,
        });
      }
    } catch (verifyErr) {
      console.error("[GPS Report] Verification error:", verifyErr);
    }
    
    // List collections after insert to confirm GPSReports exists
    const collectionsAfter = await db.listCollections().toArray();
    console.log("[GPS Report] Collections after insert:", collectionsAfter.map(c => c.name));
    console.log("[GPS Report] GPSReports collection exists:", collectionsAfter.some(c => c.name === "GPSReports"));

    return res.status(201).json({
      message: "GPS Report submitted successfully",
      id: result.insertedId.toString(),
      verified: !!verifyDoc,
      database: db.databaseName,
      collection: "GPSReports",
    });

  } catch (error) {
    console.error("[GPS Report] Error:", error);
    return res.status(500).json({
      error: "Failed to submit GPS report. Please try again.",
    });
  }
}
