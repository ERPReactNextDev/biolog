import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { parse } from "cookie";
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

    // Get user from session
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("userId")
      .eq("token", sessionToken)
      .single();

    if (sessionError || !session) {
      return res.status(401).json({ message: "Invalid session" });
    }

    // Disable 2FA
    const { error: updateError } = await supabase
      .from("users")
      .update({ 
        twoFactorEnabled: false, 
        twoFactorSecret: null,
        tempTwoFactorSecret: null 
      })
      .eq("id", session.userId);

    if (updateError) throw updateError;

    return res.status(200).json({ message: "2FA disabled successfully" });

  } catch (error: any) {
    console.error("[2FA Disable error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
