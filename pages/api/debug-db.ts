import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const db = await connectToDatabase();
    
    // Get all collections
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    
    // Check if GPSReports exists and count documents
    let gpsReportsInfo = null;
    if (collectionNames.includes("GPSReports")) {
      const count = await db.collection("GPSReports").countDocuments();
      const sample = await db.collection("GPSReports").find().limit(2).toArray();
      gpsReportsInfo = { exists: true, count, sample };
    } else {
      gpsReportsInfo = { exists: false, count: 0 };
    }
    
    return res.status(200).json({
      database: db.databaseName,
      collections: collectionNames,
      gpsReports: gpsReportsInfo,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
}
