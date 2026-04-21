import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

interface ActivityLog {
  _id: string;
  ReferenceID: string;
  Email: string;
  Type: string;
  Status: string;
  Location: string;
  Latitude: number;
  Longitude: number;
  date_created: Date | string;
  PhotoURL?: string;
  Remarks: string;
  SiteVisitAccount?: string;
}

export default async function fetchLogs(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // ── Pagination ────────────────────────────────────────────────────────────
    const page  = Math.max(1, parseInt((req.query.page  as string) || "1",  10));
    const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) || "100", 10)));
    const skip  = (page - 1) * limit;

    // ── Role-based filter ─────────────────────────────────────────────────────
    const role            = typeof req.query.role        === "string" ? req.query.role        : "";
    const userReferenceID = typeof req.query.referenceID === "string" ? req.query.referenceID : "";

    const query: Record<string, unknown> = {};

    const isAdmin = role === "SuperAdmin" || role === "Human Resources";
    if (!isAdmin) {
      if (!userReferenceID) {
        return res.status(400).json({ error: "referenceID is required for non-admin roles" });
      }
      query.ReferenceID = userReferenceID;
    }

    // ── Date filter ───────────────────────────────────────────────────────────
    const startDate = req.query.startDate as string | undefined;
    const endDate   = req.query.endDate   as string | undefined;

    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};

      if (startDate) {
        const parsed = new Date(startDate);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "Invalid startDate format" });
        }
        dateFilter.$gte = parsed;
      }

      if (endDate) {
        const parsed = new Date(endDate);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ error: "Invalid endDate format" });
        }
        dateFilter.$lte = parsed;
      }

      query.date_created = dateFilter;
    }

    // ── DB ────────────────────────────────────────────────────────────────────
    let db;
    try {
      db = await connectToDatabase();
    } catch (dbErr) {
      console.error("DB connection error:", dbErr);
      return res.status(503).json({ error: "Database connection failed. Please try again." });
    }

    const collection = db.collection("TaskLog");

    const [rawLogs, totalLogs] = await Promise.all([
      collection
        .find(query, {
          projection: {
            ReferenceID:      1,
            Email:            1,
            Type:             1,
            Status:           1,
            Location:         1,
            Latitude:         1,
            Longitude:        1,
            date_created:     1,
            PhotoURL:         1,
            Remarks:          1,
            SiteVisitAccount: 1,
          },
        })
        .sort({ date_created: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      collection.countDocuments(query),
    ]);

    const logs: ActivityLog[] = rawLogs.map((doc) => ({
      _id:              doc._id.toString(),
      ReferenceID:      doc.ReferenceID      ?? "",
      Email:            doc.Email            ?? "",
      Type:             doc.Type             ?? "",
      Status:           doc.Status           ?? "",
      Location:         doc.Location         ?? "",
      Latitude:         doc.Latitude         ?? 0,
      Longitude:        doc.Longitude        ?? 0,
      date_created:     doc.date_created,
      PhotoURL:         doc.PhotoURL,
      Remarks:          doc.Remarks          ?? "",
      SiteVisitAccount: doc.SiteVisitAccount,
    }));

    return res.status(200).json({
      data: logs,
      pagination: {
        page,
        limit,
        total: totalLogs,
        totalPages: Math.ceil(totalLogs / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    return res.status(500).json({ error: "Failed to fetch logs" });
  }
}