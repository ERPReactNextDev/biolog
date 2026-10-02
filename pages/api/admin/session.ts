import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { requireSession, hasPermission, isSuperAdminRole, isAdminRole, isManagerRole } from "@/lib/rbac";

/**
 * GET /api/admin/session
 *
 * Who is signed in, and what are they allowed to open in the admin console.
 * The layout uses this to decide whether to show Users / Approvals, but every
 * /api/admin/* route checks the same permissions independently.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const user = await requireSession(req, res);
  if (!user) return;

  let firstname = "";
  let lastname = "";

  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select('"Firstname", "Lastname", "profilePicture"')
      .eq("id", user.id)
      .maybeSingle();
    firstname = (data as { Firstname?: string } | null)?.Firstname || "";
    lastname = (data as { Lastname?: string } | null)?.Lastname || "";
  }

  return res.status(200).json({
    success: true,
    email: user.email,
    name: [firstname, lastname].filter(Boolean).join(" ").trim() || user.email,
    role: user.role,
    referenceId: user.referenceId,
    department: user.department,
    isSuperAdmin: isSuperAdminRole(user.role),
    isAdmin: isAdminRole(user.role),
    isManager: isManagerRole(user.role),
    canManageUsers: hasPermission(user, "can_manage_users"),
    canReviewGps: hasPermission(user, "can_review_gps"),
    canViewReports: hasPermission(user, "can_view_reports"),
    canManageSettings: hasPermission(user, "can_manage_settings"),
    /** Gates Site Visits / Reports / Timesheet — team-wide visibility. */
    canViewAll: hasPermission(user, "can_view_all"),
  });
}