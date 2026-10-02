/**
 * Bearer-token authentication for the public /api/v1/* endpoints.
 *
 * Flow:
 *   1. Extract "Authorization: Bearer blg_live_..." header
 *   2. SHA-256 hash the raw key
 *   3. Look up the hash in public.api_keys
 *   4. Reject if revoked, check scopes, then update last_used + log the call
 *
 * Usage:
 *   const key = await requireApiKey(req, res, "read:tasklog");
 *   if (!key) return;   // response already written
 */

import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export type ApiKeyRow = {
  id: number;
  key_name: string;
  scopes: string[];
  rate_limit: number;
};

/**
 * Authenticates the request via Bearer token and checks that `requiredScope`
 * is in the key's scope list.
 *
 * Returns the api_keys row on success, null after writing the error response.
 */
export async function requireApiKey(
  req: NextApiRequest,
  res: NextApiResponse,
  requiredScope: string
): Promise<ApiKeyRow | null> {
  if (!supabase) {
    res.status(500).json({ success: false, error: "Database connection error" });
    return null;
  }

  // ── Extract token ──────────────────────────────────────────────────────
  const authHeader = req.headers["authorization"] ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader as string);
  if (!match) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="Biolog API"');
    res.status(401).json({
      success: false,
      error: "Missing or malformed Authorization header. Expected: Bearer blg_live_...",
    });
    return null;
  }

  const rawKey = match[1];
  const hash = createHash("sha256").update(rawKey).digest("hex");

  // ── Look up hash ───────────────────────────────────────────────────────
  const { data: keyRow, error: lookupErr } = await supabase
    .from("api_keys")
    .select("id, key_name, scopes, rate_limit, revoked")
    .eq("key_hash", hash)
    .maybeSingle();

  if (lookupErr || !keyRow) {
    await logCall(null, req, res.statusCode || 401, true);
    res.status(401).json({ success: false, error: "Invalid API key." });
    return null;
  }

  if (keyRow.revoked) {
    await logCall(keyRow.id, req, 401, true);
    res.status(401).json({ success: false, error: "This API key has been revoked." });
    return null;
  }

  // ── Scope check ────────────────────────────────────────────────────────
  const scopes: string[] = keyRow.scopes ?? [];
  const hasScope = scopes.includes(requiredScope) || scopes.includes("admin:full");
  if (!hasScope) {
    await logCall(keyRow.id, req, 403, true);
    res.status(403).json({
      success: false,
      error: `Insufficient scope. Required: "${requiredScope}". Key has: [${scopes.join(", ")}]`,
    });
    return null;
  }

  // ── Update last_used (fire-and-forget) ────────────────────────────────
  const ip = getIp(req);
  supabase
    .from("api_keys")
    .update({ last_used: new Date().toISOString(), last_used_ip: ip })
    .eq("id", keyRow.id)
    .then(() => {})
    .catch(() => {});

  // ── Audit log ──────────────────────────────────────────────────────────
  await logCall(keyRow.id, req, 200, false);

  return { id: keyRow.id, key_name: keyRow.key_name, scopes, rate_limit: keyRow.rate_limit };
}

async function logCall(
  keyId: number | null,
  req: NextApiRequest,
  statusCode: number,
  denied: boolean
) {
  if (!supabase) return;
  await supabase
    .from("api_call_log")
    .insert({
      key_id: keyId,
      endpoint: req.url ?? "",
      method: req.method ?? "",
      ip: getIp(req),
      status_code: statusCode,
      denied,
    })
    .then(() => {})
    .catch(() => {});
}

function getIp(req: NextApiRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "";
}
