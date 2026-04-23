// pages/api/push/register.ts
// Saves a user's FCM push token to MongoDB so we can send targeted notifications.

import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId, token } = req.body;
  if (!userId || !token) {
    return res.status(400).json({ error: "userId and token are required" });
  }

  try {
    const db = await connectToDatabase();
    await db.collection("push_tokens").updateOne(
      { userId },
      {
        $set: {
          userId,
          token,
          updatedAt: new Date(),
          platform: req.headers["user-agent"]?.includes("Mobile") ? "mobile" : "desktop",
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("[push/register]", err);
    return res.status(500).json({ error: "Failed to save push token" });
  }
}
