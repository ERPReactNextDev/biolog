import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcrypt";
import { recordAuditLog } from "@/utils/audit-logger";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case "GET":
      try {
        const { data: users, error } = await supabase
          .from("users")
          .select("*")
          .order("createdAt", { ascending: false });
        
        if (error) throw error;

        // Remove passwords from response and add _id for compatibility
        const sanitizedUsers = (users || []).map(({ Password, id, ...u }: any) => ({ ...u, id, _id: id }));
        return res.status(200).json(sanitizedUsers);
      } catch (error) {
        return res.status(500).json({ error: "Failed to fetch users" });
      }

    case "POST":
      try {
        const { 
          Email, Password, Role, Department, Firstname, Lastname, ReferenceID, Status, 
          Company, Manager, TSM, ContactNumber, Position, Address,
          adminId, adminName 
        } = req.body;

        if (!Email || !Password || !Role || !Department || !Firstname || !Lastname || !ReferenceID) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        const { data: existingUser } = await supabase
          .from("users")
          .select("id")
          .or(`Email.eq.${Email},ReferenceID.eq.${ReferenceID}`)
          .maybeSingle();

        if (existingUser) {
          return res.status(400).json({ error: "Email or Reference ID already exists" });
        }

        const hashedPassword = await bcrypt.hash(Password, 10);
        const { permissions } = req.body;
        const newUser = {
          Email,
          Password: hashedPassword,
          Role,
          Department,
          Firstname,
          Lastname,
          ReferenceID,
          Status: Status || "Active",
          Company: Company || "",
          Manager: Manager || "",
          TSM: TSM || "",
          ContactNumber: ContactNumber || "",
          Position: Position || "",
          Address: Address || "",
          createdAt: new Date().toISOString(),
          LoginAttempts: 0,
          Connection: "Offline",
          permissions: permissions ?? { canCreateAttendance: true, canCreateSiteVisit: true },
        };

        const { error: insertError } = await supabase.from("users").insert(newUser);
        if (insertError) throw insertError;
        
        if (adminId && adminName) {
            await recordAuditLog(adminId, adminName, "CREATE_USER", ReferenceID, `${Firstname} ${Lastname}`, `Created new ${Role} user in ${Department}`);
        }

        return res.status(201).json({ message: "User created successfully" });
      } catch (error) {
        console.error("Create user error:", error);
        return res.status(500).json({ error: "Failed to create user" });
      }

    case "PUT":
      try {
        const { userId, adminId, adminName, ...updateData } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID is required" });

        const { data: oldUser, error: fetchError } = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .single();

        if (fetchError || !oldUser) return res.status(404).json({ error: "User not found" });

        if (updateData.Password) {
          updateData.Password = await bcrypt.hash(updateData.Password, 10);
        }

        const { error: updateError } = await supabase
          .from("users")
          .update({ ...updateData })
          .eq("id", userId);

        if (updateError) throw updateError;

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
        console.error("Update user error:", error);
        return res.status(500).json({ error: "Failed to update user" });
      }

    case "DELETE":
      try {
        const { userId, adminId, adminName } = req.body;
        if (!userId) return res.status(400).json({ error: "User ID is required" });

        const { data: oldUser, error: fetchError } = await supabase
          .from("users")
          .select("*")
          .eq("id", userId)
          .single();

        if (fetchError || !oldUser) return res.status(404).json({ error: "User not found" });

        const { error: deleteError } = await supabase.from("users").delete().eq("id", userId);
        if (deleteError) throw deleteError;
        
        // Also delete sessions for this user
        await supabase.from("sessions").delete().eq("userId", userId);

        if (adminId && adminName) {
            await recordAuditLog(adminId, adminName, "DELETE_USER", oldUser.ReferenceID, `${oldUser.Firstname} ${oldUser.Lastname}`, `Permanently deleted user account`);
        }

        return res.status(200).json({ message: "User deleted successfully" });
      } catch (error) {
        console.error("Delete user error:", error);
        return res.status(500).json({ error: "Failed to delete user" });
      }

    default:
      res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
      return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
