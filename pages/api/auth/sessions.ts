import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { parse } from "cookie";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cookies = parse(req.headers.cookie || "");
  const sessionToken = cookies.session;

  if (!sessionToken) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  // Find current session to get userId
  const { data: currentSession, error: currentSessionError } = await supabase
    .from("sessions")
    .select("*")
    .eq("token", sessionToken)
    .single();

  if (currentSessionError || !currentSession) {
    return res.status(401).json({ message: "Invalid session" });
  }

  const userId = currentSession.userId;

  if (req.method === "GET") {
    // List all sessions for this user
    const { data: sessions, error: fetchError } = await supabase
      .from("sessions")
      .select("*")
      .eq("userId", userId)
      .order("lastActive", { ascending: false });

    if (fetchError) throw fetchError;
    return res.status(200).json(sessions);
  }

  if (req.method === "DELETE") {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: "Session ID required" });
    }

    // Don't allow revoking the current session via this endpoint (should use logout)
    if (sessionId.toString() === currentSession.id.toString()) {
        return res.status(400).json({ message: "Cannot revoke current session here. Use logout." });
    }

    const { error: deleteError } = await supabase
      .from("sessions")
      .delete()
      .eq("id", sessionId)
      .eq("userId", userId);

    if (deleteError) throw deleteError;
    return res.status(200).json({ message: "Session revoked" });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
