import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { parse } from "cookie";
import { generateSecret, generateURI } from "otplib";
import QRCode from "qrcode";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkRateLimit(req, res, LIMITS.twoFactor)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const cookies = parse(req.headers.cookie || "");
    const sessionToken = cookies.session;

    if (!sessionToken) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("userId")
      .eq("token", sessionToken)
      .single();

    if (sessionError || !session) {
      return res.status(401).json({ message: "Invalid session" });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("Email, Firstname, Lastname")
      .eq("id", session.userId)
      .single();

    if (userError || !user) {
      return res.status(401).json({ message: "User not found" });
    }

    const secret = generateSecret();
    const otpAuth = generateURI({
      issuer: "Acculog",
      label: `${user.Firstname || "User"} ${user.Lastname || ""} (Acculog)`,
      secret,
    });
    const qrCodeUrl = await QRCode.toDataURL(otpAuth);

    const { error: updateError } = await supabase
      .from("users")
      .update({ tempTwoFactorSecret: secret })
      .eq("id", session.userId);

    if (updateError) throw updateError;

    return res.status(200).json({ secret, qrCodeUrl, otpAuth });
  } catch (error: any) {
    console.error("[2FA Generate Secret error:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
}
