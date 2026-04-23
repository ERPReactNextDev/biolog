import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const db = await connectToDatabase();

    const refIDsParam = req.query.referenceIDs as string | undefined;

    if (!refIDsParam) {
      return res.status(400).json({ error: "referenceIDs query parameter is required" });
    }

    // Split comma-separated string into array and trim spaces
    const referenceIDs = refIDsParam.split(",").map((id) => id.trim()).filter(Boolean);

    if (referenceIDs.length === 0) {
      return res.status(400).json({ error: "No valid referenceIDs provided" });
    }

    // Query users collection where ReferenceID is in the array
    const users = await db
      .collection("users")
      .find({ ReferenceID: { $in: referenceIDs } })
      .project({ password: 0 }) // exclude password
      .toArray();

    // Return user data array
    return res.status(200).json(users);
  } catch (error) {
    return res.status(500).json({ error: "Server error fetching users" });
  }
}
