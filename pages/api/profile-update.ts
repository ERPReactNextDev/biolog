import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcrypt";

export default async function updateProfile(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const {
    id,
    userId, // fallback if id is not sent
    Firstname,
    Lastname,
    Email,
    Role,
    Department,
    Status,
    ContactNumber,
    Password,
    profilePicture,
    faceDescriptors, // bagong field para sa biometric registration
    credentials, // bagong field para sa WebAuthn biometrics
    SecondaryEmail, // bagong field para sa backup notifications
    pin, // bagong field para sa PIN login
    faceVerificationEnabled, // bagong field para sa face verification toggle
  } = req.body;

  const targetId = id || userId;

  if (!targetId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  try {
    const updatedUser: any = {
      updatedAt: new Date().toISOString(),
    };

    if (Firstname) updatedUser.Firstname = Firstname;
    if (Lastname) updatedUser.Lastname = Lastname;
    if (Email) updatedUser.Email = Email;
    if (Role) updatedUser.Role = Role;
    if (Department) updatedUser.Department = Department;
    if (Status) updatedUser.Status = Status;
    if (ContactNumber) updatedUser.ContactNumber = ContactNumber;
    if (profilePicture) updatedUser.profilePicture = profilePicture;
    if (faceDescriptors) updatedUser.faceDescriptors = faceDescriptors;
    if (credentials) updatedUser.credentials = credentials;
    if (SecondaryEmail !== undefined) updatedUser.SecondaryEmail = SecondaryEmail;
    if (pin !== undefined) updatedUser.pin = pin;
    if (faceVerificationEnabled !== undefined) updatedUser.faceVerificationEnabled = faceVerificationEnabled;

    if (Password && Password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(Password, 10);
      updatedUser.Password = hashedPassword;
    }

    const { error } = await supabase
      .from("users")
      .update(updatedUser)
      .eq("id", targetId);

    if (error) {
      console.error("updateProfile error:", error);
      return res.status(404).json({ error: "User not found or no changes made" });
    }

    return res.status(200).json({ message: "Profile updated successfully" });
  } catch (error) {
    console.error("Internal server error in profile-update:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
