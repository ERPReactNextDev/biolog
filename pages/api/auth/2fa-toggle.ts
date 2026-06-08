import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { parse } from "cookie";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

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
}
