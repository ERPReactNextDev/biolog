import { NextApiRequest, NextApiResponse } from "next";
import { createHash, randomBytes } from "crypto";
import { supabase } from "@/lib/supabase";
import { guard } from "@/lib/rbac";
import { recordAuditLog } from "@/utils/audit-logger";

/**
 * GET  /api/admin/api-keys          — list all (non-revoked first)
 * POST /api/admin/api-keys          — create new key  → returns plaintext ONCE
 * DELETE /api/admin/api-keys?id=X   — revoke key
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await guard(req, res, "can_manage_settings");
  if (!admin) return;

  if (!supabase)
    return res.status(500).json({ success: false, message: "Database connection error" });

  /* ── GET ──────────────────────────────────────────────────────────────── */
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("api_keys")
      .select(
        "id, key_name, key_prefix, scopes, rate_limit, revoked, revoked_at, revoked_by, last_used, last_used_ip, created_by, created_at"
      )
      .order("revoked", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[api-keys] GET error:", error);
      return res.status(500).json({ success: false, message: "Could not load API keys." });
    }
    return res.status(200).json({ success: true, keys: data ?? [] });
  }

  /* ── POST — create ────────────────────────────────────────────────────── */
  if (req.method === "POST") {
    const { key_name, scopes, rate_limit } = req.body ?? {};

    if (!key_name?.trim()) {
      return res.status(400).json({ success: false, message: "Key name is required." });
    }

    // blg_live_<24 random hex chars>
    const rawSecret = randomBytes(18).toString("hex"); // 36 hex chars
    const plaintext = `blg_live_${rawSecret}`;
    const hash = createHash("sha256").update(plaintext).digest("hex");
    const prefix = plaintext.slice(0, 18) + "…"; // safe display prefix

    const { error: insertErr } = await supabase.from("api_keys").insert({
      key_name: key_name.trim(),
      key_hash: hash,
      key_prefix: prefix,
      scopes: Array.isArray(scopes) ? scopes : [],
      rate_limit: Number(rate_limit) || 100,
      created_by: admin.email,
    });

    if (insertErr) {
      console.error("[api-keys] POST error:", insertErr);
      return res.status(500).json({ success: false, message: "Could not create key." });
    }

    await recordAuditLog(
      String(admin.id),
      admin.email,
      "CREATE_API_KEY",
      prefix,
      key_name.trim(),
      `Scopes: ${(scopes ?? []).join(", ")} · Rate limit: ${rate_limit ?? 100}/min`
    ).catch(() => {});

    // Return the plaintext ONCE — it is not stored.
    return res.status(201).json({ success: true, plaintext });
  }

  /* ── DELETE — revoke ──────────────────────────────────────────────────── */
  if (req.method === "DELETE") {
    const id = req.query.id ?? req.body?.id;
    if (!id) return res.status(400).json({ success: false, message: "Key id required." });

    const { data: existing } = await supabase
      .from("api_keys")
      .select("id, key_name, key_prefix")
      .eq("id", Number(id))
      .maybeSingle();

    if (!existing)
      return res.status(404).json({ success: false, message: "Key not found." });

    const { error } = await supabase
      .from("api_keys")
      .update({ revoked: true, revoked_at: new Date().toISOString(), revoked_by: admin.email })
      .eq("id", Number(id));

    if (error) {
      console.error("[api-keys] DELETE error:", error);
      return res.status(500).json({ success: false, message: "Could not revoke key." });
    }

    await recordAuditLog(
      String(admin.id),
      admin.email,
      "REVOKE_API_KEY",
      String(id),
      existing.key_name,
      `Prefix: ${existing.key_prefix}`
    ).catch(() => {});

    return res.status(200).json({ success: true });
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).json({ success: false, message: "Method not allowed." });
}
