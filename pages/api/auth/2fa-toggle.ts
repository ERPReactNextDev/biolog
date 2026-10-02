import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { parse } from "cookie";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkRateLimit(req, res, LIMITS.twoFactor)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const cookies = parse(req.headers.cookie || "");
  const sessionToken = cookies.session;

  if (!sessionToken) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  try {
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .select("userId")
      .eq("token", sessionToken)
      .single();

    if (sessionError || !session) {
      return res.status(401).json({ message: "Invalid session" });
    }

    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "Enabled (boolean) is required" });
    }

    const { error: updateError } = await supabase
      .from("users")
      .update({ twoFactorEnabled: enabled })
      .eq("id", session.userId);

    if (updateError) throw updateError;

    return res.status(200).json({ message: `2FA ${enabled ? "enabled" : "disabled"} successfully` });
  } catch (error: any) {
    console.error("[2fa-toggle] error:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
}
