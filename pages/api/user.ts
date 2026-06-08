import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const userId = req.query.id as string;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    try {
      // Find the user by ID
      const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (user && !error) {
        // Respond with all user fields except the password, add _id for compatibility
        const { Password, id, ...userData } = user;
        res.status(200).json({ ...userData, id, _id: id });
      } else {
        res.status(404).json({ error: "User not found" });
      }
    } catch (error) {
      console.error("fetch user error:", error);
      res.status(500).json({ error: "Server error" });
    }
  } else {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}
