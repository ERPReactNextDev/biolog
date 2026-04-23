import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";
import bcrypt from "bcrypt";

/*
  POST /api/auth/signup
  ─────────────────────
  Creates a new user account with Status: "Revoked".
  Admin must go to User Management → Grant System Access
  before the user can log in.
*/
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const {
      Firstname,
      Lastname,
      Email,
      Password,
      Department,
      Company,
      ReferenceID,
    } = req.body;

    /* ── Basic validation ── */
    if (!Firstname || !Lastname || !Email || !Password || !Department || !ReferenceID) {
      return res.status(400).json({ message: "All required fields must be filled in." });
    }
    if (Password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const db = await connectToDatabase();
    const users = db.collection("users");

    /* ── Duplicate check (email OR referenceID) ── */
    const existing = await users.findOne({
      $or: [
        { Email: { $regex: new RegExp(`^${Email}$`, "i") } },
        { ReferenceID },
      ],
    });

    if (existing) {
      const field = existing.Email?.toLowerCase() === Email.toLowerCase()
        ? "email address"
        : "Reference ID";
      return res.status(409).json({ message: `This ${field} is already registered.` });
    }

    /* ── Hash password ── */
    const hashedPassword = await bcrypt.hash(Password, 10);

    /* ── Insert with Status: "Revoked" ── */
    await users.insertOne({
      Firstname,
      Lastname,
      Email,
      Password: hashedPassword,
      Role: "User",                // Default role — admin can change later
      Department,
      Company: Company || "",
      ReferenceID,
      Status: "Revoked",           // ← Pending admin approval
      LoginAttempts: 0,
      Connection: "Offline",
      createdAt: new Date(),
      registrationMethod: "self-signup",
    });

    return res.status(201).json({
      message: "Account created successfully. Please wait for admin approval before logging in.",
    });

  } catch (error) {
    return res.status(500).json({ message: "An unexpected error occurred. Please try again." });
  }
}