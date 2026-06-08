import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function fetchAccounts(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { data: logs, error } = await supabase.from('activity_logs').select('*');
    if (error) throw error;

    res.status(200).json({ data: logs });
  } catch (error) {
    console.error("fetch session logs error:", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
}
