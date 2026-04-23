import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function fetchAccounts(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const db = await connectToDatabase();
    const collection = db.collection("activityLogs");

    const logs = await collection.find({}).toArray();

    res.status(200).json({ data: logs });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch logs" });
  }
}
