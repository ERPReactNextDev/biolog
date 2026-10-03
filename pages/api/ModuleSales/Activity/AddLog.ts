import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { sql } from "@/lib/neon";
import { distanceMeters, normalizeSiteName } from "@/lib/geofence";

/* Geofence thresholds. These MUST match lib/geo.ts on the client — the client
   value is what the agent sees as a warning, this one is what is recorded, and
   a disagreement would mean the sheet says "Poor" while the row says nothing.
   Keeping the numbers in both places is a deliberate trade: the client cannot
   import a server module, and duplicating two constants is cheaper than
   shipping the whole threshold table to the browser. */
const WARN_M = 50;

/* Flag vocabulary — mirrors the CHECK constraint in migration
   20260106_location_accuracy.sql. Kept as a const so a typo is a compile
   error rather than a CHECK violation at 2am. */
const GEO_FLAGS = [
  "low_accuracy",
  "outside_geofence",
  "manual_override",
  "offline_stale",
  "network_fix",
] as const;
type GeoFlag = (typeof GEO_FLAGS)[number];

const generateAccountRef = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 20; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Resolves the fence for the client site being visited and reports how far off
 * it is.
 *
 * WHY THE SERVER DOES THIS INSTEAD OF TRUSTING THE SHEET
 * Every geo field the browser sends is attacker-controlled. If the client
 * decided GeoFlag, an agent could simply omit it — or set "gps" with an
 * accuracy of 3 — and the admin review queue would show a clean log. So the
 * accuracy value is taken as a *measurement* but the flag is always derived
 * here, from our own numbers.
 *
 * Returns null when there is no fence for this site, which is the normal case
 * on an install that has not populated client_sites. That is not an error: the
 * office-level fence in system_settings still applies, and the row simply
 * carries no site data.
 */
async function resolveFence(
  siteName: string | null | undefined,
  lat: number,
  lng: number,
  companyId: number | null
): Promise<{ siteName: string; distanceM: number; radiusM: number; outside: boolean } | null> {
  const key = normalizeSiteName(siteName || "");
  if (!key) return null;

  const { data, error } = await supabase
    .from("client_sites")
    .select("name, latitude, longitude, radius_meters, company_id")
    .eq("name_key", key)
    .eq("is_active", true)
    .limit(10);

  // 42P01 / 42703 = the migration has not been applied. Fall through to "no
  // fence" rather than failing the whole clock-in: losing an attendance record
  // because a fence table is absent is a far worse outcome than an unfenced
  // one.
  if (error || !data || !data.length) return null;

  const rows = data as any[];
  const rank = (r: any) =>
    companyId != null && r.company_id === companyId ? 0 : r.company_id == null ? 1 : 2;
  const row = [...rows].sort((a, b) => rank(a) - rank(b))[0];

  const sLat = Number(row.latitude);
  const sLng = Number(row.longitude);
  if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) return null;

  const radiusM = Number.isFinite(Number(row.radius_meters)) && Number(row.radius_meters) > 0
    ? Number(row.radius_meters)
    : 100;

  const distanceM = distanceMeters(sLat, sLng, lat, lng);

  return {
    siteName: String(row.name ?? siteName),
    distanceM: Math.round(distanceM),
    radiusM,
    outside: distanceM > radiusM,
  };
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

      /* ── Location quality ──────────────────────────────────────────────
         Taken as measurements, never as decisions. GeoFlag is NOT read from
         the body at all — it is derived below from these numbers and from our
         own fence lookup, so a tampered client cannot mark its own log clean.
         GeoSource is read because there is nothing to independently verify it
         against, but it is constrained to the same four values the database
         CHECK allows. */
      GeoAccuracyM,
      GeoSource,
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

    /* ── Location quality: derived, never accepted ──────────────────────────
       Everything below runs AFTER the coordinates are validated so a null
       Latitude cannot reach distanceMeters(). Note the columns are added to
       newLog only — if 20260106_location_accuracy.sql has not been applied the
       insert 42703s and the agent loses their attendance record, so the geo
       columns are attempted separately and a failure there is non-fatal. */

    const lat = typeof Latitude === "number" && isFinite(Latitude) ? Latitude : null;
    const lng = typeof Longitude === "number" && isFinite(Longitude) ? Longitude : null;

    /* Written in a separate UPDATE, so kept out of newLog — see the insert
       below for why. */
    const geoFields: Record<string, unknown> = {};

    /* Used only to rank which tenant's fence applies when two companies have
       registered the same client name. This is a lookup convenience, not an
       authorisation check: it reads the body-supplied ReferenceID, exactly as
       the rest of this route already does. */
    const { data: callerRow } = await supabase
      .from("users")
      .select("company_id")
      .eq("ReferenceID", ReferenceID.trim())
      .maybeSingle();
    const companyId =
      typeof callerRow?.company_id === "number" && Number.isFinite(callerRow.company_id)
        ? callerRow.company_id
        : null;

    const accuracyM =
      typeof GeoAccuracyM === "number" && isFinite(GeoAccuracyM) && GeoAccuracyM >= 0
        ? Math.round(GeoAccuracyM)
        : null;

    const source =
      typeof GeoSource === "string" &&
      (["gps", "fallback", "cached", "manual"] as const).includes(GeoSource as any)
        ? GeoSource
        : null;

    if (lat !== null && lng !== null) {
      // The fence is only looked up for client visits. A Clock In has no
      // SiteVisitAccount, so there is nothing to be "outside of" — the
      // office-level fence in system_settings is enforced in the sheet.
      const fence = await resolveFence(effectiveSiteVisitAccount, lat, lng, companyId);

      /* Priority order, highest first. Being outside the fence outranks every
         accuracy concern: it is the only one an admin must act on, and burying
         it under "low_accuracy" would hide it from the review queue's default
         sort. */
      let flag: GeoFlag | null = null;
      if (fence?.outside) flag = "outside_geofence";
      else if (source === "cached") flag = "offline_stale";
      else if (source === "fallback") flag = "network_fix";
      else if (source === "manual") flag = "manual_override";
      else if (accuracyM !== null && accuracyM > WARN_M) flag = "low_accuracy";

      /* The spec requires a photo AND remarks for an out-of-fence visit. This
         is enforced HERE rather than only in the sheet, because the sheet is
         exactly the thing an agent can bypass. Without this the flag column
         would fill with entries that carry no evidence at all. */
      if (fence?.outside) {
        if (typeof PhotoURL !== "string" || !PhotoURL.trim()) {
          return res.status(400).json({
            error:
              "outside_geofence_photo",
            message: `This location is ${fence.distanceM} m from ${fence.siteName} — outside the ${fence.radiusM} m boundary. A photo is required.`,
          });
        }
        const remarks = typeof Remarks === "string" ? Remarks.trim() : "";
        if (!remarks) {
          return res.status(400).json({
            error: "outside_geofence_remarks",
            message: `This location is ${fence.distanceM} m from ${fence.siteName} — outside the ${fence.radiusM} m boundary. Please describe why in Remarks.`,
          });
        }
      }

      geoFields.GeoAccuracyM = accuracyM;
      geoFields.GeoSource = source;
      geoFields.GeoFlag = flag;
      geoFields.GeoDistanceM = fence?.distanceM ?? null;
      geoFields.GeoSiteName = fence?.siteName ?? null;
    }

    /* ── Insert to Supabase ─────────────────────────── */

    // The geo columns are written in a SECOND insert attempt rather than the
    // first. A single combined insert would fail with 42703 on any install
    // that has not yet applied 20260106_location_accuracy.sql, and the agent
    // would lose their attendance record over a missing optional column. So:
    // insert the row that always works, then try to attach the geo data and
    // give up quietly if the columns are not there.
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

    /* Attach location quality. Non-fatal by design. */
    let geoSaved = false;
    if (Object.keys(geoFields).length && supabaseData?.id != null) {
      const { error: geoErr } = await supabase
        .from("tasklog")
        .update(geoFields)
        .eq("id", supabaseData.id);

      if (geoErr) {
        if (geoErr.code === "42703" || geoErr.code === "PGRST204") {
          console.warn(
            "[AddLog] Geo columns unavailable (run 20260106_location_accuracy.sql). " +
              "The attendance row was saved without location quality."
          );
        } else {
          console.error("[AddLog] Geo update error:", geoErr);
        }
      } else {
        geoSaved = true;
      }
    }

    /* ── Insert to Neon (TASKFLOW_DB) if it's a New Client ── */
    if (type_client === "New Client" && sql) {
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
            'For Approval of TSM',
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
      /* Echoed so the sheet can confirm what was actually recorded. The server
         derived these — the client must not assume its own values won. */
      geo: geoSaved
        ? {
            flag: geoFields.GeoFlag ?? null,
            accuracyM: geoFields.GeoAccuracyM ?? null,
            source: geoFields.GeoSource ?? null,
            distanceM: geoFields.GeoDistanceM ?? null,
            siteName: geoFields.GeoSiteName ?? null,
          }
        : null,
    });

  } catch (error: any) {
    console.error("[AddLog] Fatal Error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error?.message || "Unknown error",
    });
  }
}
