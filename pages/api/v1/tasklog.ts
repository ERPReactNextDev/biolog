import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { requireApiKey } from "@/lib/api-key-auth";

/**
 * GET  /api/v1/tasklog
 *   Auth : Authorization: Bearer blg_live_...
 *   Scope: read:tasklog
 *   Query: ReferenceID, date_from (ISO), date_to (ISO), type, status,
 *          limit (max 500, default 100), offset
 *
 * POST /api/v1/tasklog
 *   Auth : Authorization: Bearer blg_live_...
 *   Scope: write:tasklog
 *   Body : { ReferenceID, Email, Type, Status, Remarks, TSM, Location,
 *             Latitude, Longitude, PhotoURL, SiteVisitAccount, Manager }
 *
 * Response shape (GET):
 *   { success, count, data: TasklogRow[], meta: { limit, offset, range } }
 *
 * Response shape (POST):
 *   { success, id }
 */

const READ_COLS = [
  "id",
  '"ReferenceID"',
  '"Email"',
  '"Type"',
  '"Status"',
  '"Remarks"',
  '"TSM"',
  '"SiteVisitAccount"',
  '"Location"',
  '"Latitude"',
  '"Longitude"',
  '"PhotoURL"',
  '"Manager"',
  "date_created",
  "account_reference_number",
  "company_id",
].join(", ");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // CORS — allow any origin for 3rd-party callers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (!supabase) {
    return res.status(500).json({ success: false, error: "Database connection error" });
  }

  /* ── GET ──────────────────────────────────────────────────────────────── */
  if (req.method === "GET") {
    const key = await requireApiKey(req, res, "read:tasklog");
    if (!key) return;

    const {
      ReferenceID,
      date_from,
      date_to,
      type,
      status,
      limit: limitQ,
      offset: offsetQ,
    } = req.query as Record<string, string>;

    const limit = Math.min(Number(limitQ) || 100, 500);
    const offset = Number(offsetQ) || 0;

    let query = supabase
      .from("tasklog")
      .select(READ_COLS)
      .order("date_created", { ascending: false })
      .range(offset, offset + limit - 1);

    if (ReferenceID) query = query.eq("ReferenceID", ReferenceID);
    if (type)        query = query.eq("Type", type);
    if (status)      query = query.eq("Status", status);
    if (date_from)   query = query.gte("date_created", new Date(date_from).toISOString());
    if (date_to)     query = query.lte("date_created", new Date(date_to).toISOString());

    const { data, error, count } = await query;

    if (error) {
      console.error("[v1/tasklog GET]", error);
      return res.status(500).json({ success: false, error: "Query failed." });
    }

    return res.status(200).json({
      success: true,
      count: count ?? (data?.length ?? 0),
      data: data ?? [],
      meta: {
        limit,
        offset,
        range: { from: date_from ?? null, to: date_to ?? null },
      },
    });
  }

  /* ── POST ─────────────────────────────────────────────────────────────── */
  if (req.method === "POST") {
    const key = await requireApiKey(req, res, "write:tasklog");
    if (!key) return;

    const {
      ReferenceID,
      Email,
      Type,
      Status,
      Remarks,
      TSM,
      SiteVisitAccount,
      Location,
      Latitude,
      Longitude,
      PhotoURL,
      Manager,
      account_reference_number,
      company_id,
    } = req.body ?? {};

    if (!ReferenceID || !Type || !Status) {
      return res.status(400).json({
        success: false,
        error: "Required fields: ReferenceID, Type, Status",
      });
    }

    const { data: inserted, error } = await supabase
      .from("tasklog")
      .insert({
        ReferenceID,
        Email: Email ?? null,
        Type,
        Status,
        Remarks: Remarks ?? null,
        TSM: TSM ?? null,
        SiteVisitAccount: SiteVisitAccount ?? null,
        Location: Location ?? null,
        Latitude: Latitude ?? null,
        Longitude: Longitude ?? null,
        PhotoURL: PhotoURL ?? null,
        Manager: Manager ?? null,
        account_reference_number: account_reference_number ?? null,
        company_id: company_id ?? null,
        date_created: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[v1/tasklog POST]", error);
      return res.status(500).json({ success: false, error: "Insert failed." });
    }

    return res.status(201).json({ success: true, id: inserted?.id ?? null });
  }

  res.setHeader("Allow", ["GET", "POST", "OPTIONS"]);
  return res.status(405).json({ success: false, error: `Method ${req.method} not allowed.` });
}
