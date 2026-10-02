import { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { supabase } from "@/lib/supabase";
import { sendPasswordChangedEmail, verifyTicket, type SignedPayload } from "@/lib/password-reset";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/auth/password-reset-complete
 * body: { resetToken, newPassword }
 *
 * Verifies the reset token, then rehashes the password into `users`.
 * A confirmation email is sent afterwards (best effort).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkRateLimit(req, res, LIMITS.resetComplete)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const resetToken = String(req.body?.resetToken ?? "");
  const newPassword = String(req.body?.newPassword ?? "");

  const payload = verifyTicket<SignedPayload>(resetToken, "reset");
  if (!payload) {
    return res.status(400).json({
      success: false,
      message: "This reset session expired. Please start again.",
    });
  }

  if (newPassword.length < 6) {
    return res
      .status(400)
      .json({ success: false, message: "Password must be at least 6 characters." });
  }

  if (!supabase) {
    return res.status(500).json({ success: false, message: "Database connection error" });
  }

  try {
    const hashed = await bcrypt.hash(newPassword, 10);

    const { data, error } = await supabase
      .from("users")
      .update({ Password: hashed })
      .ilike("Email", payload.e)
      .select("Email")
      .maybeSingle();

    if (error) {
      console.error("[password-reset-complete] update failed:", error);
      return res.status(500).json({ success: false, message: "Could not update your password." });
    }
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "That account no longer exists." });
    }

    // Best effort — the password is already changed either way.
    await sendPasswordChangedEmail(payload.e);

    return res.status(200).json({
      success: true,
      email: payload.e,
      message: "Password updated.",
    });
  } catch (err: any) {
    console.error("[password-reset-complete] fatal:", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Something went wrong." });
  }
}
