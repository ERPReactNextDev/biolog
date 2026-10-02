import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard } from "@/lib/rbac";
import { recordAuditLog } from "@/utils/audit-logger";

/**
 * GET    /api/admin/backup          — list backup history
 * POST   /api/admin/backup          — record a manual backup entry
 * DELETE /api/admin/backup?id=X     — delete a backup record
 *
 * NOTE: Actual file compression / storage lives client-side (the browser
 * triggers a JSON export).  This route manages the public.backups metadata
 * table so the history list is persistent.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await guard(req, res, "can_manage_settings");
  if (!admin) return;

  if (!supabase)
    return res.status(500).json({ success: false, message: "Database connection error" });

  /* ── GET ──────────────────────────────────────────────────────────────── */
  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("backups")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[backup] GET error:", error);
      return res.status(500).json({ success: false, message: "Could not load backup history." });
    }
    return res.status(200).json({ success: true, backups: data ?? [] });
  }

  /* ── POST — record a completed backup ────────────────────────────────── */
  if (req.method === "POST") {
    const { filename, size_bytes, type = "Manual", schedule } = req.body ?? {};

    if (!filename) {
      return res.status(400).json({ success: false, message: "filename is required." });
    }

    const { error } = await supabase.from("backups").insert({
      filename,
      size_bytes: size_bytes ?? null,
      type,
      schedule: schedule ?? null,
      created_by: admin.email,
    });

    if (error) {
      console.error("[backup] POST error:", error);
      return res.status(500).json({ success: false, message: "Could not save backup record." });
    }

    await recordAuditLog(
      String(admin.id),
      admin.email,
      "CREATE_BACKUP",
      filename,
      filename,
      `Type: ${type} · Size: ${size_bytes ? Math.round(size_bytes / 1024) + " KB" : "unknown"}`
    ).catch(() => {});

    return res.status(201).json({ success: true });
  }

  /* ── DELETE — remove backup record ───────────────────────────────────── */
  if (req.method === "DELETE") {
    const id = req.query.id ?? req.body?.id;
    if (!id) return res.status(400).json({ success: false, message: "id required." });

    const { error } = await supabase
      .from("backups")
      .delete()
      .eq("id", Number(id));

    if (error) {
      console.error("[backup] DELETE error:", error);
      return res.status(500).json({ success: false, message: "Could not delete backup." });
    }

    return res.status(200).json({ success: true });
  }

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  return res.status(405).json({ success: false, message: "Method not allowed." });
}
