import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkRateLimit(req, res, LIMITS.register)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  try {
    if (!supabase) {
      console.error("[Register] Supabase client not initialized.");
      return res.status(500).json({ success: false, message: "Database connection error" });
    }

    const { Email, Password, Role, Department, Firstname, Lastname, ReferenceID } = req.body;

    if (!Email || !Password || !Role || !Department || !Firstname || !Lastname || !ReferenceID) {
      return res.status(400).json({ success: false, message: "All fields are required" });
    }

    /* ── Duplicate check ── */
    const { data: existing, error: fetchError } = await supabase
      .from("users")
      .select("Email, ReferenceID")
      .or(`Email.ilike.${Email},ReferenceID.eq.${ReferenceID}`)
      .maybeSingle();

    if (existing) {
      const field = existing.Email?.toLowerCase() === Email.toLowerCase()
        ? "email address"
        : "Reference ID";
      return res.status(409).json({ success: false, message: `This ${field} is already registered.` });
    }

    /* ── Hash password ── */
    const hashedPassword = await bcrypt.hash(Password, 10);

    /* ── Insert ── */
    const { error: insertError } = await supabase.from("users").insert({
      Firstname,
      Lastname,
      Email,
      Password: hashedPassword,
      Role,
      Department,
      ReferenceID,
      Status: "Revoked", // Default to Revoked until admin approves
      createdAt: new Date().toISOString(),
      registrationMethod: "legacy-register-api",
    });

    if (insertError) {
      console.error("[Register] Insert error:", insertError);
      return res.status(500).json({ success: false, message: "Failed to register user" });
    }

    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error("[Register] Fatal Error:", error);
    return res.status(500).json({ success: false, message: error?.message || "An error occurred while registering!" });
  }
}