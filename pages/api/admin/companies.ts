import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard } from "@/lib/rbac";
import { recordAuditLog } from "@/utils/audit-logger";

/**
 * GET    /api/admin/companies           — list all companies with user count
 * POST   /api/admin/companies           — create company
 * PUT    /api/admin/companies           — update company (body: { id, ...fields })
 * DELETE /api/admin/companies?id=X      — delete company
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await guard(req, res, "can_manage_settings");
  if (!admin) return;

  if (!supabase)
    return res.status(500).json({ success: false, message: "Database connection error" });

  /* ── GET ──────────────────────────────────────────────────────────────── */
  if (req.method === "GET") {
    const { data: companies, error } = await supabase
      .from("companies")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[companies] GET error:", error);
      return res.status(500).json({ success: false, message: "Could not load companies." });
    }

    // Attach user counts — one extra query, kept fast by the idx_users_company index.
    const { data: userRows } = await supabase
      .from("users")
      .select("company_id");

    const countMap: Record<number, number> = {};
    for (const u of userRows ?? []) {
      if (u.company_id) countMap[u.company_id] = (countMap[u.company_id] ?? 0) + 1;
    }

    const result = (companies ?? []).map((c: any) => ({
      ...c,
      user_count: countMap[c.id] ?? 0,
    }));

    return res.status(200).json({ success: true, companies: result });
  }

  /* ── POST — create ────────────────────────────────────────────────────── */
  if (req.method === "POST") {
    const { name, plan, status, admin_email, settings } = req.body ?? {};

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Company name is required." });
    }

    const { data: created, error } = await supabase
      .from("companies")
      .insert({
        name: name.trim(),
        plan: plan || "Starter",
        status: status || "Active",
        admin_email: admin_email || null,
        settings: settings || {},
      })
      .select("id, name")
      .maybeSingle();

    if (error) {
      const isDupe = error.code === "23505";
      return res.status(isDupe ? 409 : 500).json({
        success: false,
        message: isDupe ? "A company with that name already exists." : "Could not create company.",
      });
    }

    await recordAuditLog(
      String(admin.id),
      admin.email,
      "CREATE_COMPANY",
      String(created?.id ?? ""),
      name.trim(),
      `Plan: ${plan || "Starter"} · Status: ${status || "Active"}`
    ).catch(() => {});

    return res.status(201).json({ success: true, company: created });
  }

  /* ── PUT — update ─────────────────────────────────────────────────────── */
  if (req.method === "PUT") {
    const { id, name, plan, status, admin_email, settings } = req.body ?? {};
    if (!id) return res.status(400).json({ success: false, message: "id is required." });

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name.trim();
    if (plan !== undefined) patch.plan = plan;
    if (status !== undefined) patch.status = status;
    if (admin_email !== undefined) patch.admin_email = admin_email;
    if (settings !== undefined) patch.settings = settings;

    const { error } = await supabase
      .from("companies")
      .update(patch)
      .eq("id", Number(id));

    if (error) {
      console.error("[companies] PUT error:", error);
      return res.status(500).json({ success: false, message: "Could not update company." });
    }

    await recordAuditLog(
      String(admin.id),
      admin.email,
      "UPDATE_COMPANY",
      String(id),
      name?.trim() ?? String(id),
      `Plan: ${plan} · Status: ${status}`
    ).catch(() => {});

    return res.status(200).json({ success: true });
  }

  /* ── DELETE ───────────────────────────────────────────────────────────── */
  if (req.method === "DELETE") {
    const id = req.query.id ?? req.body?.id;
    if (!id) return res.status(400).json({ success: false, message: "id required." });

    const { data: existing } = await supabase
      .from("companies")
      .select("name")
      .eq("id", Number(id))
      .maybeSingle();

    const { error } = await supabase
      .from("companies")
      .delete()
      .eq("id", Number(id));

    if (error) {
      console.error("[companies] DELETE error:", error);
      return res.status(500).json({ success: false, message: "Could not delete company." });
    }

    await recordAuditLog(
      String(admin.id),
      admin.email,
      "DELETE_COMPANY",
      String(id),
      existing?.name ?? String(id),
      "Company deleted"
    ).catch(() => {});

    return res.status(200).json({ success: true });
  }

  res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
  return res.status(405).json({ success: false, message: "Method not allowed." });
}
