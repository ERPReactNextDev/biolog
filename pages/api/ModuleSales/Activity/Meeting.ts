import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabase) {
    console.error("[Meeting] Supabase client not initialized.");
    return res.status(500).json({ error: "Database connection error" });
  }

  if (req.method === "POST") {
    try {
      const { 
        ReferenceID, 
        Title, 
        StartDate, 
        EndDate, 
        Remarks, 
        TSM,
        Manager,
        CompanyName
      } = req.body;

      if (!ReferenceID || !StartDate || !EndDate || !Title) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const start = new Date(StartDate);
      const end = new Date(EndDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ error: "Invalid StartDate or EndDate format" });
      }

      const newMeeting = {
        referenceid:   ReferenceID,
        tsm:           TSM || "",
        manager:       Manager || "",
        type_activity: Title,
        remarks:       Remarks || "",
        start_date:    start.toISOString(),
        end_date:      end.toISOString(),
        company_name:  CompanyName || "",
        // date_created has a default value in DB
      };

      const { data, error } = await supabase.from("meetings").insert(newMeeting).select().maybeSingle();
      if (error) throw error;
      
      return res.status(201).json({ 
        message: "Meeting created successfully", 
        id: data?.id,
        _id: data?.id // for compatibility
      });
    } catch (error) {
      console.error("create meeting error:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  if (req.method === "GET") {
    try {
      const { referenceID, startDate, endDate, role } = req.query;
      
      let query = supabase.from("meetings").select("*");

      if (role !== "SuperAdmin" && role !== "Human Resources" && referenceID) {
        query = query.eq("referenceid", referenceID);
      }

      if (startDate && endDate) {
        const start = new Date(startDate as string);
        const end = new Date(endDate as string);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          query = query.gte("start_date", start.toISOString())
                       .lte("start_date", end.toISOString());
        }
      }

      const { data: rawMeetings, error } = await query.order("start_date", { ascending: true });
      if (error) throw error;

      // Map back to expected frontend fields for compatibility
      const meetings = (rawMeetings || []).map((m: any) => ({
        ...m,
        _id:         m.id,
        ReferenceID: m.referenceid,
        TSM:         m.tsm,
        Title:       m.type_activity,
        StartDate:   m.start_date,
        EndDate:     m.end_date,
        Remarks:     m.remarks,
        CreatedAt:   m.date_created,
        Manager:     m.manager,
        CompanyName: m.company_name
      }));

      return res.status(200).json(meetings);
    } catch (error) {
      console.error("fetch meetings error:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}