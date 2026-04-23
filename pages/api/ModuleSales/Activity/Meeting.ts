import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";
import { ObjectId } from "mongodb";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = await connectToDatabase();
  const meetingsCollection = db.collection("meetings");

  if (req.method === "POST") {
    try {
      const { 
        ReferenceID, 
        Email, 
        Title, 
        StartDate, 
        EndDate, 
        Location, 
        Remarks, 
        TSM 
      } = req.body;

      if (!ReferenceID || !StartDate || !EndDate || !Title) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // FIX: Parse dates without timezone conversion
      const start = new Date(StartDate);
      const end = new Date(EndDate);
      
      // Store as ISO strings to preserve the local time
      const startDateISO = new Date(StartDate).toISOString();
      const endDateISO = new Date(EndDate).toISOString();
      
      const durationMs = end.getTime() - start.getTime();
      const durationMin = Math.round(durationMs / (1000 * 60));

      const newMeeting = {
        ReferenceID,
        Email,
        Title,
        StartDate: startDateISO,  // Store as ISO string
        EndDate: endDateISO,      // Store as ISO string
        Duration: durationMin,
        Location,
        Remarks,
        TSM,
        Status: "Scheduled",
        CreatedAt: new Date(),
      };

      const result = await meetingsCollection.insertOne(newMeeting);
      return res.status(201).json({ message: "Meeting created successfully", id: result.insertedId });
    } catch (error) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  if (req.method === "GET") {
    try {
      const { referenceID, startDate, endDate, role } = req.query;
      const query: any = {};

      if (role !== "SuperAdmin" && role !== "Human Resources" && referenceID) {
        query.ReferenceID = referenceID;
      }

      if (startDate && endDate) {
        query.StartDate = {
          $gte: new Date(startDate as string),
          $lte: new Date(endDate as string),
        };
      }

      const meetings = await meetingsCollection.find(query).sort({ StartDate: 1 }).toArray();
      return res.status(200).json(meetings);
    } catch (error) {
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}