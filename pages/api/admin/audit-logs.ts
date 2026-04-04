import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === "GET") {
        try {
            const db = await connectToDatabase();
            const collection = db.collection("audit_logs");
            
            const logs = await collection.find({}).sort({ date_created: -1 }).limit(100).toArray();
            res.status(200).json(logs);
        } catch (error) {
            res.status(500).json({ error: "Failed to fetch audit logs" });
        }
    } else {
        res.setHeader("Allow", ["GET"]);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
