// pages/api/check-session.ts

import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { parse } from "cookie";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
    const sessionToken = cookies.session;

    if (!sessionToken) {
        return res.status(401).json({ message: "No session token" });
    }

    // 1. Find the session in the DB
    const { data: sessionDoc, error: sessionError } = await supabase
        .from("sessions")
        .select("*")
        .eq("token", sessionToken)
        .single();

    if (sessionError || !sessionDoc) {
        return res.status(401).json({ message: "Invalid or expired session" });
    }

    // 2. Check deviceId match (extra security)
    const deviceId = req.headers["x-device-id"];
    if (sessionDoc.deviceId && deviceId && sessionDoc.deviceId !== deviceId) {
        return res.status(401).json({ message: "Device mismatch. Please login again." });
    }

    // 3. Find the user associated with the session
    const { data: user, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("id", sessionDoc.userId)
        .single();

    if (userError || !user) {
        return res.status(401).json({ message: "User not found" });
    }

    // 4. Update last active
    await supabase
        .from("sessions")
        .update({ lastActive: new Date().toISOString() })
        .eq("id", sessionDoc.id);

    return res.status(200).json({ 
        message: "Session valid", 
        user: { ...user, _id: user.id } 
    });
}
