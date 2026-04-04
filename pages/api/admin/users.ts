import { NextApiRequest, NextApiResponse } from "next";
import { connectToDatabase } from "@/lib/MongoDB";
import { ObjectId } from "mongodb";
import bcrypt from "bcrypt";
import { recordAuditLog } from "@/utils/audit-logger";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const db = await connectToDatabase();
  const usersCollection = db.collection("users");

  switch (req.method) {
    case "GET":
      try {
        const users = await usersCollection.find({}).project({ Password: 0 }).toArray();
        return res.status(200).json(users);
      } catch (error) {
        return res.status(500).json({ error: "Failed to fetch users" });
      }

    case "POST":
      try {
        const { Email, Password, Role, Department, Firstname, Lastname, ReferenceID, Status, adminId, adminName } = req.body;

        if (!Email || !Password || !Role || !Department || !Firstname || !Lastname || !ReferenceID) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        const existingUser = await usersCollection.findOne({ 
          $or: [{ Email }, { ReferenceID }] 
        });

        if (existingUser) {
          return res.status(400).json({ error: "Email or Reference ID already exists" });
        }

        const hashedPassword = await bcrypt.hash(Password, 10);
        const newUser = {
          Email,
          Password: hashedPassword,
          Role,
          Department,
          Firstname,
          Lastname,
          ReferenceID,
          Status: Status || "Active",
          createdAt: new Date(),
          LoginAttempts: 0,
          Connection: "Offline"
        };

        await usersCollection.insertOne(newUser);
        
        if (adminId && adminName) {
            await recordAuditLog(adminId, adminName, "CREATE_USER", ReferenceID, `${Firstname} ${Lastname}`, `Created new ${Role} user in ${Department}`);
        }

        return res.status(201).json({ message: "User created successfully" });
      } catch (error) {
        return res.status(500).json({ error: "Failed to create user" });
      }

    case "PUT":
      try {
        const { userId, adminId, adminName, ...updateData } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID is required" });

        const oldUser = await usersCollection.findOne({ _id: new ObjectId(userId) });
        if (!oldUser) return res.status(404).json({ error: "User not found" });

        if (updateData.Password) {
          updateData.Password = await bcrypt.hash(updateData.Password, 10);
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { ...updateData, updatedAt: new Date() } }
        );

        if (adminId && adminName) {
            let action = "UPDATE_USER";
            let details = "Updated user profile";
            
            if (updateData.Status && updateData.Status !== oldUser.Status) {
                action = updateData.Status === "Active" ? "GRANT_ACCESS" : "REVOKE_ACCESS";
                details = `Status changed from ${oldUser.Status} to ${updateData.Status}`;
            }

            await recordAuditLog(adminId, adminName, action, oldUser.ReferenceID, `${oldUser.Firstname} ${oldUser.Lastname}`, details);
        }

        return res.status(200).json({ message: "User updated successfully" });
      } catch (error) {
        return res.status(500).json({ error: "Failed to update user" });
      }

    case "DELETE":
      try {
        const { userId, adminId, adminName } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID is required" });

        const oldUser = await usersCollection.findOne({ _id: new ObjectId(userId) });
        if (!oldUser) return res.status(404).json({ error: "User not found" });

        const result = await usersCollection.deleteOne({ _id: new ObjectId(userId) });
        
        // Also delete sessions for this user
        await db.collection("sessions").deleteMany({ userId });

        if (adminId && adminName) {
            await recordAuditLog(adminId, adminName, "DELETE_USER", oldUser.ReferenceID, `${oldUser.Firstname} ${oldUser.Lastname}`, `Permanently deleted user account`);
        }

        return res.status(200).json({ message: "User deleted successfully" });
      } catch (error) {
        return res.status(500).json({ error: "Failed to delete user" });
      }

    default:
      res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
