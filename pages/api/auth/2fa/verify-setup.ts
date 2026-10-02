import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { parse } from "cookie";
import { verify } from "otplib";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkRateLimit(req, res, LIMITS.twoFactor)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const cookies = parse(req.headers.cookie || "");
    const sessionToken = cookies.session;
    const { token } = req.body;

    if (!sessionToken) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!token) {
      return res.status(400).json({ message: "Verification token is required" });
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
      .select("tempTwoFactorSecret")
      .eq("id", session.userId)
      .single();

    if (userError || !user || !user.tempTwoFactorSecret) {
      return res.status(400).json({ message: "No 2FA setup in progress" });
    }

    const result = await verify({
      token,
      secret: user.tempTwoFactorSecret,
    });

    if (!result.valid) {
      return res.status(401).json({ message: "Invalid verification token" });
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({
        twoFactorSecret: user.tempTwoFactorSecret,
        tempTwoFactorSecret: null,
        twoFactorEnabled: true,
      })
      .eq("id", session.userId);

    if (updateError) throw updateError;

    return res.status(200).json({ message: "2FA setup successfully completed" });
  } catch (error: any) {
    console.error("[2FA Verify Setup error:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
}
