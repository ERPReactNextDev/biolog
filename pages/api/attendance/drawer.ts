import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import {
  guard,
  attendanceDrawerFor,
  canLookupClientsFor,
  isTsaRole,
  hasPermission,
} from "@/lib/rbac";

/**
 * GET /api/attendance/drawer
 *
 * Tells the client which attendance drawer this role is allowed to open:
 *
 *   Territory Sales Associate -> "sales"  (Client/Account, Target Quota,
 *                                       Type of Sales, Sales Remarks)
 *   anyone else               -> "basic" (Attendance Type, Location, Remarks)
 *
 * The client uses this to pick the form, but it is NOT the security boundary —
 * pages/api/ModuleSales/Activity/AddLog re-checks the role before writing a
 * sales-attendance row. This exists so the UI never has to guess, and so a
 * guess can't leak a form the user isn't entitled to.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const user = await guard(req, res, "can_create_attendance");
  if (!user) return;

  const drawer = attendanceDrawerFor(user);

  // The sales drawer reads TargetQuota, so hand it over for prefill.
  let targetQuota: string | number | null = null;
  if (drawer === "sales" && supabase) {
    const { data } = await supabase
      .from("users")
      .select('"TargetQuota"')
      .eq("id", user.id)
      .maybeSingle();
    targetQuota = (data as { TargetQuota?: string | number } | null)?.TargetQuota ?? null;
  }

  return res.status(200).json({
    success: true,
    drawer,
    role: user.role,
    isTsa: isTsaRole(user.role),
    canCreateSales: hasPermission(user, "can_create_sales_attendance"),
    /* Whether the sales drawer should show the New/Existing client picker at
       all. Set per-user in Admin -> Users. Forced off for the basic drawer,
       which has no client field, so the client never has to second-guess it. */
    canLookupClients: drawer === "sales" && canLookupClientsFor(user),
    targetQuota,
  });
}