import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  if (!supabase) {
    return res.status(500).json({ error: "Supabase client not initialized. Check env vars." });
  }

  try {
    const { data: users, error } = await supabase
      .from("users")
      .select("Firstname, Lastname, ReferenceID, Status, Company, Department");

    if (error) throw error;

    res.status(200).json(users);
  } catch (error) {
    console.error("getUsers error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
