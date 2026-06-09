import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

interface ActivityLog {
  id: string;
  ReferenceID: string;
  Email: string;
  Type: string;
  Status: string;
  Location: string;
  Latitude: string;
  Longitude: string;
  date_created: string;
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
    if (!supabase) {
      console.error("[FetchLog] Supabase client not initialized.");
      return res.status(500).json({ error: "Database connection error" });
    }

    // ── Pagination ────────────────────────────────────────────────────────────
    const page  = Math.max(1, parseInt((req.query.page  as string) || "1",  10));
    const limit = Math.min(500, Math.max(1, parseInt((req.query.limit as string) || "100", 10)));
    const skip  = (page - 1) * limit;

    // ── Role-based filter ─────────────────────────────────────────────────────
    const role            = typeof req.query.role        === "string" ? req.query.role        : "";
    const userReferenceID = typeof req.query.referenceID === "string" ? req.query.referenceID : "";

    let supabaseQuery = supabase
      .from("tasklog")
      .select("*", { count: "exact" });

    const isAdmin = role === "SuperAdmin" || role === "Human Resources";
    if (!isAdmin) {
      if (!userReferenceID) {
        return res.status(400).json({ error: "referenceID is required for non-admin roles" });
      }
      supabaseQuery = supabaseQuery.eq("ReferenceID", userReferenceID);
    }

    // ── Date filter ───────────────────────────────────────────────────────────
    const startDate = req.query.startDate as string | undefined;
    const endDate   = req.query.endDate   as string | undefined;

    if (startDate) {
      const parsed = new Date(startDate);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "Invalid startDate format" });
      }
      supabaseQuery = supabaseQuery.gte("date_created", parsed.toISOString());
    }

    if (endDate) {
      const parsed = new Date(endDate);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: "Invalid endDate format" });
      }
      supabaseQuery = supabaseQuery.lte("date_created", parsed.toISOString());
    }

    // ── DB ────────────────────────────────────────────────────────────────────
    const { data: rawLogs, count, error } = await supabaseQuery
      .order("date_created", { ascending: false })
      .range(skip, skip + limit - 1);

    if (error) {
      console.error("Supabase fetch error:", error);
      return res.status(503).json({ error: "Failed to fetch logs from database." });
    }

    const logs: ActivityLog[] = (rawLogs || []).map((doc: any) => ({
      id:               doc.id?.toString() || "",
      _id:              doc.id?.toString() || "", // for compatibility
      ReferenceID:      doc.ReferenceID      ?? "",
      Email:            doc.Email            ?? "",
      Type:             doc.Type             ?? "",
      Status:           doc.Status           ?? "",
      Location:         doc.Location         ?? "",
      Latitude:         doc.Latitude         ?? "0",
      Longitude:        doc.Longitude        ?? "0",
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
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error("[FetchLog] Unhandled error:", error);
    return res.status(500).json({ error: "Failed to fetch logs" });
  }
}