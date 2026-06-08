import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  if (!supabase) {
    return res.status(500).json({ error: "Supabase client is not initialized. Check environment variables." });
  }

  try {
    const refIDsParam = req.query.referenceIDs as string | undefined;

    if (!refIDsParam) {
      return res.status(400).json({ error: "referenceIDs query parameter is required" });
    }

    // Split comma-separated string into array and trim spaces
    const referenceIDs = refIDsParam.split(",").map((id) => id.trim()).filter(Boolean);

    if (referenceIDs.length === 0) {
      return res.status(400).json({ error: "No valid referenceIDs provided" });
    }

    // Query users table where ReferenceID is in the array
    const { data: users, error } = await supabase
      .from("users")
      .select("*")
      .in("ReferenceID", referenceIDs);

    if (error) throw error;

    // Remove passwords from response
    const sanitizedUsers = (users || []).map(({ Password, ...u }: any) => u);

    // Return user data array
    return res.status(200).json(sanitizedUsers);
  } catch (error) {
    console.error("users api error:", error);
    return res.status(500).json({ error: "Server error fetching users" });
  }
}
