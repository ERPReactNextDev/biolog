import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") {
        try {
            const { data: logs, error } = await supabase
                .from("audit_logs")
                .select("*")
                .order("date_created", { ascending: false })
                .limit(100);
            
            if (error) throw error;
            res.status(200).json(logs);
        } catch (error) {
            console.error("fetch audit logs error:", error);
            res.status(500).json({ error: "Failed to fetch audit logs" });
        }
    } else {
        res.setHeader("Allow", "GET");
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
