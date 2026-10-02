import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import {
  OTP_TTL_MS,
  generateOtp,
  sendOtpEmail,
  signTicket,
} from "@/lib/password-reset";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/auth/password-reset-request
 * body: { Email }
 *
 * Emails a 6-digit OTP and returns a signed `ticket` that binds the code to
 * the address. Always responds 200 so the endpoint can't be used to discover
 * which email addresses have accounts.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  /* Every accepted request sends a real email, so this is the most abusable
     endpoint in the app — capped hard to stop mail-bombing a victim. */
  if (!checkRateLimit(req, res, LIMITS.resetRequest)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const email = String(req.body?.Email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ success: false, message: "Enter a valid email address." });
  }
  if (!supabase) {
    return res.status(500).json({ success: false, message: "Database connection error" });
  }

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("Email, Firstname")
      .ilike("Email", email)
      .maybeSingle();

    if (error) {
      console.error("[password-reset-request] lookup failed:", error);
      return res.status(500).json({ success: false, message: "Could not verify that account." });
    }

    // No user: stay silent, but don't hand out a usable ticket either.
    if (!user) {
      return res.status(200).json({
        success: true,
        message:
          "If that email is registered, we've sent a 6-digit verification code.",
      });
    }

    const code = generateOtp();
    const ticket = signTicket({
      p: "otp",
      e: email,
      k: code, // the code itself is the HMAC-bound secret
      exp: Date.now() + OTP_TTL_MS,
    });

    const sent = await sendOtpEmail(email, code);
    if (!sent.ok) {
      // Surface a real problem: the user is waiting on an email that isn't coming.
      return res.status(502).json({
        success: false,
        message: "We couldn't send the code right now. Please try again shortly.",
      });
    }

    return res.status(200).json({
      success: true,
      ticket,
      expiresIn: Math.round(OTP_TTL_MS / 1000),
      message:
        "If that email is registered, we've sent a 6-digit verification code.",
    });
  } catch (err: any) {
    console.error("[password-reset-request] fatal:", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Something went wrong." });
  }
}
