import { NextApiRequest, NextApiResponse } from "next";
import { RESET_TTL_MS, signTicket, verifyTicket, type SignedPayload } from "@/lib/password-reset";

/**
 * POST /api/auth/password-reset-verify
 * body: { Email, code, ticket }
 *
 * Checks the typed code against the signed OTP ticket and, when it matches,
 * returns a short-lived `resetToken` that authorises the actual reset.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const email = String(req.body?.Email ?? "").trim().toLowerCase();
  const code = String(req.body?.code ?? "").trim();
  const ticket = String(req.body?.ticket ?? "");

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: "Enter the 6-digit code." });
  }

  const payload = verifyTicket<SignedPayload>(ticket, "otp");
  if (!payload) {
    return res.status(400).json({
      success: false,
      message: "That code has expired. Tap Resend to get a new one.",
      expired: true,
    });
  }
  if (payload.e !== email) {
    return res
      .status(400)
      .json({ success: false, message: "That code doesn't match this email." });
  }
  if (payload.k !== code) {
    return res.status(400).json({ success: false, message: "Incorrect code. Please try again." });
  }

  // Email proven — mint the ticket that allows the password change.
  const resetToken = signTicket({
    p: "reset",
    e: email,
    k: "confirmed",
    exp: Date.now() + RESET_TTL_MS,
  });

  return res.status(200).json({
    success: true,
    resetToken,
    expiresIn: Math.round(RESET_TTL_MS / 1000),
  });
}
