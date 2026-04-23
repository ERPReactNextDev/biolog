// pages/api/auth/refresh-session.ts
// Extends the current session by re-issuing the cookie with a fresh expiry.

import { NextApiRequest, NextApiResponse } from "next";
import { parse, serialize } from "cookie";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
  const sessionToken = cookies.session;

  if (!sessionToken) {
    return res.status(401).json({ error: "No session" });
  }

  try {
    const db       = await connectToDatabase();
    const sessions = db.collection("sessions");

    const session = await sessions.findOne({ token: sessionToken });
    if (!session) {
      return res.status(401).json({ error: "Invalid session" });
    }

    // Update lastActive
    await sessions.updateOne(
      { token: sessionToken },
      { $set: { lastActive: new Date() } }
    );

    // Re-issue cookie with fresh 7-day expiry
    res.setHeader(
      "Set-Cookie",
      serialize("session", sessionToken, {
        httpOnly: true,
        secure:   process.env.NODE_ENV !== "development",
        sameSite: "lax",
        maxAge:   60 * 60 * 24 * 7,
        path:     "/",
      })
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[refresh-session]", err);
    return res.status(500).json({ error: "Failed to refresh session" });
  }
}
