import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { sql } from "@/lib/neon";

const generateAccountRef = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export default async function addActivityLog(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (!supabase) {
      console.error("[AddLog] Supabase client not initialized. Check your environment variables.");
      return res.status(500).json({ error: "Database connection error" });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", ["POST"]);
      return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

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
      company_name,
      contact_person,
      contact_number,
      email_address,
      address,
      manager, // Assuming manager is passed for Neon
      type_client, // Client type (New Client or Existing Client)
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

    const validStatuses = ["Login", "Logout", "For Approval"];
    if (!validStatuses.includes(Status)) {
      return res.status(400).json({
        error: `Invalid Status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    let resolvedDate: Date;
    if (clientDateCreated) {
      const parsed = new Date(clientDateCreated);
      resolvedDate = isNaN(parsed.getTime()) ? new Date() : parsed;
    } else {
      resolvedDate = new Date();
    }

    // Fetch dynamic work-day start
    const { data: settings, error: settingsError } = await supabase
      .from("system_settings")
      .select("officeStartTime")
      .eq("type", "global")
      .maybeSingle();

    if (settingsError) {
      console.error("[AddLog] Settings fetch error:", settingsError);
    }

    const officeStartTime = settings?.officeStartTime || "08:00";
    let [startH, startM] = officeStartTime.split(":").map(Number);
    
    // Robust validation for startH and startM
    if (isNaN(startH) || startH < 0 || startH > 23) startH = 8;
    if (isNaN(startM) || startM < 0 || startM > 59) startM = 0;

    const startOfDay = new Date(resolvedDate);
    startOfDay.setHours(startH, startM, 0, 0);
    if (resolvedDate < startOfDay) {
      startOfDay.setDate(startOfDay.getDate() - 1);
    }

    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    endOfDay.setMilliseconds(-1);

    /* ── Duplicate check ────────────────────────────────────────────────── */
    const { data: lastActivityToday, error: dupError } = await supabase
      .from("tasklog")
      .select("Status, Type")
      .eq("ReferenceID", ReferenceID)
      .gte("date_created", startOfDay.toISOString())
      .lte("date_created", endOfDay.toISOString())
      .order("date_created", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dupError) {
      console.error("[AddLog] Duplicate check error:", dupError);
    }

    // Determine the actual status we're checking for (never For Approval)
    const actualStatus = Status.trim() === "For Approval" ? (lastActivityToday?.Status === "Login" ? "Logout" : "Login") : Status.trim();

    if (
      lastActivityToday?.Status === actualStatus &&
      lastActivityToday?.Type === Type
    ) {
      return res.status(409).json({
        error: `Duplicate: already ${actualStatus.toLowerCase()} for ${Type} on this work day.`,
      });
    }

    /* ── Build document for Supabase ─────────────────── */
    // Never use "For Approval" in tasklog - always use Login/Logout!
    // If it's a New Client, we map company_name to SiteVisitAccount for the tasklog
    const effectiveSiteVisitAccount = (type_client === "New Client" || Status === "For Approval") ? (company_name || SiteVisitAccount) : SiteVisitAccount;

    const newLog: any = {
      ReferenceID:  ReferenceID.trim(),
      Email:        Email.trim(),
      Type:         Type.trim(),
      Status:       actualStatus,
      Remarks:      typeof Remarks === "string" ? Remarks.trim() : "",
      TSM:          typeof TSM === "string" ? TSM.trim() : "",
      date_created: resolvedDate.toISOString(),
      SiteVisitAccount: typeof effectiveSiteVisitAccount === "string" ? effectiveSiteVisitAccount.trim() : "",
    };

    if (typeof Location === "string" && Location.trim())
      newLog.Location = Location.trim();

    if (typeof Latitude === "number" && isFinite(Latitude))
      newLog.Latitude = Latitude.toString();

    if (typeof Longitude === "number" && isFinite(Longitude))
      newLog.Longitude = Longitude.toString();

    if (typeof PhotoURL === "string" && PhotoURL.trim())
      newLog.PhotoURL = PhotoURL.trim();

    if (typeof manager === "string" && manager.trim())
      newLog.Manager = manager.trim();

    /* ── Insert to Supabase ─────────────────────────── */
    const { data: supabaseData, error: insertError } = await supabase
      .from("tasklog")
      .insert(newLog)
      .select()
      .maybeSingle();

    if (insertError) {
      console.error("[AddLog] Supabase insert error:", insertError);
      return res.status(500).json({
        error: "Supabase insert failed",
        details: insertError.message,
      });
    }

    /* ── Insert to Neon (TASKFLOW_DB) if it's a New Client ── */
    if (Status === "For Approval" && sql) {
      try {
        const accountRef = generateAccountRef();
        await sql`
          INSERT INTO accounts (
            referenceid, 
            tsm, 
            manager, 
            company_name, 
            contact_person, 
            contact_number, 
            email_address, 
            address, 
            remarks, 
            status,
            type,
            type_client,
            account_reference_number,
            date_created
          ) VALUES (
            ${ReferenceID}, 
            ${TSM || ""}, 
            ${manager || ""}, 
            ${company_name || ""}, 
            ${contact_person || ""}, 
            ${contact_number || ""}, 
            ${email_address || ""}, 
            ${address || ""}, 
            ${Remarks || ""}, 
            'For Approval',
            'Client Visit',
            ${type_client || 'New Client'},
            ${accountRef},
            ${resolvedDate.toISOString()}
          )
        `;
        console.log("[AddLog] Successfully inserted into Neon accounts table");
      } catch (neonErr) {
        console.error("[AddLog] Neon insert error:", neonErr);
      }
    }

    return res.status(201).json({
      message:      `${Status} recorded successfully`,
      id:           supabaseData?.id?.toString() || "",
      date_created: resolvedDate.toISOString(),
    });

  } catch (error: any) {
    console.error("[AddLog] Fatal Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error?.message || "Unknown error",
    });
  }
}
