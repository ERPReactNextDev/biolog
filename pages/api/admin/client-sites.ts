/* ============================================================================
   /api/admin/client-sites  ·  CRUD for the per-client geofence directory
   ----------------------------------------------------------------------------
   `client_sites` holds CONFIG: "Robinsons Mandaue is at these coordinates and
   the boundary is 100 m". It records no visits — `tasklog` does that.

   Permissions
     GET    any signed-in user. Agents need it to render the fence in the sheet.
     POST   can_manage_settings
     PATCH  can_manage_settings
     DELETE can_manage_settings

   WHY GET IS OPEN TO EVERYONE
   An agent is told "you are 40 m outside Robinsons" only if the app can read
   the fence, and the sheet has no admin permission. Restricting GET would mean
   either a second code path for agents or no client-site warnings at all. The
   data returned is a name, a radius and a coordinate — the same information
   the agent is about to be shown on a map anyway.

   name_key IS NEVER WRITTEN
   It is a GENERATED column (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))),
   computed by the database. Sending it would 409 with "cannot insert into a
   generated column", so it is stripped from every write payload rather than
   trusting the client to omit it.
   ========================================================================== */

import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard, requireSession, SessionUser } from "@/lib/rbac";

/* NOTE WHAT IS NOT HERE
   No company_name, no account_reference_number, no address. The client master
   lives in Neon (`accounts.company_name`) and this app reads it from
   /api/fetch-account. Duplicating those columns here would create a second
   copy of client data that could drift from the real one and would have to be
   kept in sync by hand. This route manages fences only. */

type Row = {
  id: number | string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  company_id: number | null;
};

const SELECT_COLUMNS =
  "id, name, latitude, longitude, radius_meters, is_active, created_at, updated_at, company_id";

/* The migration may not have been applied. Rather than 500, every route here
   degrades to "no sites configured", which is exactly the pre-feature state. */
const NOT_MIGRATED = new Set(["42P01", "42703", "PGRST204"]);

function notMigrated(res: NextApiResponse): boolean {
  res.status(200).json({
    success: true,
    sites: [],
    reason: "not_configured",
  });
  return true;
}

/**
 * Tenant scoping. Deliberately CONDITIONAL, like every other query in this app:
 * company_id is nullable and was only back-filled for part of the install
 * (migration 20260104), so filtering unconditionally returns nothing for the
 * many users whose company_id is still NULL — and that reads as "no data
 * configured" rather than as the scoping bug it is.
 */
function tenantFilter(query: any, user: SessionUser) {
  return user.companyId != null ? query.eq("company_id", user.companyId) : query;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabase) {
    return res.status(500).json({ error: "Database connection error" });
  }

  if (req.method === "GET") {
    const user = await requireSession(req, res);
    if (!user) return;

    try {
      const q = tenantFilter(
        supabase.from("client_sites").select(SELECT_COLUMNS),
        user
      );
      const { data, error } = await q.order("name", { ascending: true });

      if (error) {
        if (NOT_MIGRATED.has(error.code)) return notMigrated(res);
        throw error;
      }

      return res.status(200).json({ success: true, sites: data || [] });
    } catch (err: any) {
      console.error("[client-sites] GET failed:", err);
      return res.status(500).json({ error: "Could not load client sites." });
    }
  }

  /* ── Writes need can_manage_settings ─────────────────────────────────── */
  if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
    const admin = await guard(req, res, "can_manage_settings");
    if (!admin) return;

    try {
      if (req.method === "POST") return await create(req, res, admin);
      if (req.method === "PATCH") return await update(req, res, admin);
      return await remove(req, res, admin);
    } catch (err: any) {
      console.error("[client-sites] write failed:", err);
      return res.status(500).json({ error: "Could not save the client site." });
    }
  }

  res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
  return res.status(405).json({ error: `Method ${req.method} not allowed` });
}

/* ── Create ───────────────────────────────────────────────────────────────── */

async function create(req: NextApiRequest, res: NextApiResponse, admin: SessionUser) {
  const parsed = parseBody(req.body);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  const body = parsed.value;

  const { data, error } = await supabase
    .from("client_sites")
    .insert({
      name: body.name,
      latitude: body.latitude,
      longitude: body.longitude,
      radius_meters: body.radius_meters,
      is_active: body.is_active,
      company_id: admin.companyId,
    })
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    if (NOT_MIGRATED.has(error.code)) return notMigrated(res);
    // 23505 = the unique index. Surfaced as a readable message because the raw
    // PostgREST text names the index expression, not the field the admin typed.
    if (error.code === "23505") {
      return res.status(409).json({
        error: `There is already a fence for "${body.name}". Edit that one instead.`,
      });
    }
    throw error;
  }

  return res.status(201).json({ success: true, site: data });
}

/* ── Update ───────────────────────────────────────────────────────────────── */

async function update(req: NextApiRequest, res: NextApiResponse, admin: SessionUser) {
  const id = req.query.id;
  if (typeof id !== "string" || !id) {
    return res.status(400).json({ error: "Missing site id." });
  }

  const parsed = parseBody(req.body, true);
  if ("error" in parsed) return res.status(400).json({ error: parsed.error });
  const body = parsed.value as Record<string, unknown>;

  /* Only the columns the form owns. company_id is intentionally NOT patchable:
     moving a fence between tenants would silently re-scope another company's
     client, and no admin has a reason to want that. */
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ["name", "latitude", "longitude", "radius_meters", "is_active"]) {
    if (k in body) patch[k] = (body as any)[k];
  }

  const { data, error } = await supabase
    .from("client_sites")
    .update(patch)
    .eq("id", id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    if (NOT_MIGRATED.has(error.code)) return notMigrated(res);
    if (error.code === "23505") {
      return res.status(409).json({
        error: "Another fence already uses that name.",
      });
    }
    throw error;
  }
  if (!data) return res.status(404).json({ error: "That client site no longer exists." });

  return res.status(200).json({ success: true, site: data });
}

/* ── Delete ───────────────────────────────────────────────────────────────── */

async function remove(req: NextApiRequest, res: NextApiResponse, admin: SessionUser) {
  const id = req.query.id;
  if (typeof id !== "string" || !id) {
    return res.status(400).json({ error: "Missing site id." });
  }

  const { error } = await supabase.from("client_sites").delete().eq("id", id);
  if (error) {
    if (NOT_MIGRATED.has(error.code)) return notMigrated(res);
    throw error;
  }

  return res.status(200).json({ success: true });
}

/* ── Body validation ──────────────────────────────────────────────────────── */

type Parsed =
  | { error: string }
  | {
      value: {
        name: string;
        latitude: number;
        longitude: number;
        radius_meters: number;
        is_active: boolean;
      };
    };

function parseBody(raw: unknown, partial = false): Parsed {
  const b = (raw || {}) as Record<string, unknown>;

  /* name_key is generated by the database. Stripped unconditionally rather than
     relying on the caller to know that. */
  delete b.name_key;

  const out: any = {};

  if (!partial || "name" in b) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) return { error: "A client name is required." };
    if (name.length > 200) return { error: "That client name is too long." };
    out.name = name;
  }

  if (!partial || "latitude" in b || "longitude" in b) {
    const lat = Number(b.latitude);
    const lng = Number(b.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { error: "Latitude must be between -90 and 90." };
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { error: "Longitude must be between -180 and 180." };
    }
    out.latitude = lat;
    out.longitude = lng;
  }

  if (!partial || "radius_meters" in b) {
    const r = Number(b.radius_meters ?? 100);
    if (!Number.isFinite(r) || r <= 0 || r > 5000) {
      return { error: "The boundary must be between 1 m and 5000 m." };
    }
    /* The spec default is 100 m; an admin who typed nothing gets it. */
    out.radius_meters = Math.round(r);
  }

  if (!partial || "is_active" in b) {
    out.is_active = b.is_active === undefined ? true : Boolean(b.is_active);
  }

  return { value: out };
}