import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcrypt";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET request for this setup script
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const email = "superadmin@biolog.com";
    const password = "pass";
    const role = "Super Admin";
    const department = "IT";
    const firstname = "Super";
    const lastname = "Admin";
    const referenceID = "ADMIN-001";

    // Check if the admin already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .or(`Email.eq.${email},ReferenceID.eq.${referenceID}`)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ 
        message: "Super Admin na account ay exist na.",
        user: {
          Email: existingUser.Email,
          Role: existingUser.Role,
          ReferenceID: existingUser.ReferenceID
        }
      });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      Email: email,
      Password: hashedPassword,
      Role: role,
      Department: department,
      Firstname: firstname,
      Lastname: lastname,
      ReferenceID: referenceID,
      Status: "Active",
      createdAt: new Date().toISOString(),
      LoginAttempts: 0,
      Connection: "Offline",
      pin: "123456" // Default pin
    };

    const { error } = await supabase.from("users").insert(newUser);
    if (error) throw error;

    return res.status(201).json({ 
      message: "Super Admin account successfully created!",
      credentials: {
        Email: email,
        Password: password,
        Role: role,
        ReferenceID: referenceID
      }
    });
  } catch (error) {
    console.error("setup-admin error:", error);
    return res.status(500).json({ error: "Failed to create super admin" });
  }
}
