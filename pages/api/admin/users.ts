import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcryptjs";
import { recordAuditLog } from "@/utils/audit-logger";
import { guard } from "@/lib/rbac";

/**
 * Validate a company_id coming from the admin UI.
 *
 * NULL is a legitimate answer ("not assigned to a company"), so it passes
 * through. A non-null value must reference a row that actually exists —
 * otherwise the Companies tab counts a user under a company that isn't there,
 * which is worse than showing them as unassigned.
 */
async function resolveCompanyId(raw: unknown): Promise<number | null> {
  if (raw === null || raw === undefined || raw === "" || raw === "null") return null;

  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;

  const { data } = await supabase.from("companies").select("id").eq("id", id).maybeSingle();
  return data?.id ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  /* ⚠ This route previously had no authorization at all — an anonymous caller
     could list every user, create accounts, edit roles, or DELETE users and
     their sessions. Now every verb requires `can_manage_users`. */
  const admin = await guard(req, res, "can_manage_users");
  if (!admin) return;

  if (!supabase) {
    console.error("[AdminUsers] Supabase client not initialized.");
    return res.status(500).json({ error: "Database connection error" });
  }

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
      } catch (error: any) {
        console.error("[AdminUsers] GET error:", error);
        return res.status(500).json({ error: "Failed to fetch users", details: error.message });
      }

    case "POST":
      try {
        const { 
          Email, Password, Role, Department, Firstname, Lastname, ReferenceID, Status, 
          Company, Manager, TSM, ContactNumber, Position, Address, company_id,
          adminId, adminName 
        } = req.body ?? {};

        if (!Email || !Password || !Role || !Department || !Firstname || !Lastname || !ReferenceID) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        // company_id must point at a real row, or the Companies tab shows the
        // user under nobody. A missing company is legitimate (unassigned), a
        // bogus one is not.
        const companyId = await resolveCompanyId(company_id);

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
          // Tenant FK. Drives the Companies tab and every company_id filter.
          company_id: companyId,
          Manager: Manager || "",
          TSM: TSM || "",
          ContactNumber: ContactNumber || "",
          Position: Position || "",
          Address: Address || "",
          createdAt: new Date().toISOString(),
          LoginAttempts: 0,
          Connection: "Offline",
          // Merge over the legacy defaults so the drawer flags are additive and
          // the older camelCase keys are not dropped.
          permissions: {
            canCreateAttendance: true,
            canCreateSiteVisit: true,
            ...(permissions && typeof permissions === "object" ? permissions : {}),
          },
        };

        const { error: insertError } = await supabase.from("users").insert(newUser);
        if (insertError) throw insertError;
        
        if (adminId && adminName) {
            await recordAuditLog(adminId, adminName, "CREATE_USER", ReferenceID, `${Firstname} ${Lastname}`, `Created new ${Role} user in ${Department}`);
        }

        return res.status(201).json({ message: "User created successfully" });
      } catch (error: any) {
        console.error("[AdminUsers] POST error:", error);
        return res.status(500).json({ error: "Failed to create user", details: error.message });
      }

    case "PUT":
      try {
        const { userId, id, _id, adminId, adminName, ...updateData } = req.body ?? {};

        // Belt-and-braces: never let a client reassign a row's primary key.
        delete updateData.id;
        delete updateData._id;

        /* The admin UI sends the row's primary key as `id` (it mirrors whatever
           the GET handed out, which carries both `id` and `_id`), while other
           callers send `userId`. Accepting only `userId` meant every edit from
           the Users drawer 400'd with "User ID is required" — user editing was
           completely non-functional. */
        const targetId = userId ?? id ?? _id;
        if (!targetId) return res.status(400).json({ error: "User ID is required" });

        const { data: oldUser, error: fetchError } = await supabase
          .from("users")
          .select("*")
          .eq("id", targetId)
          .single();

        if (fetchError || !oldUser) return res.status(404).json({ error: "User not found" });

        if (updateData.Password) {
          updateData.Password = await bcrypt.hash(updateData.Password, 10);
        }

        /* company_id needs validating like everything else, but ONLY when the
           caller actually sent it — a PUT that omits the field must leave the
           existing assignment alone rather than clearing it. */
        if ("company_id" in updateData) {
          updateData.company_id = await resolveCompanyId(updateData.company_id);
        }

        /* Merge permissions rather than replacing the column.
           users.permissions is a shared jsonb bag — the create path seeds
           canCreateAttendance / canCreateSiteVisit, and lib/rbac.ts reads
           snake_case keys from it. Overwriting it with only the two keys the
           Users drawer sends would silently wipe every other flag on the row. */
        if (updateData.permissions && typeof updateData.permissions === "object") {
          const existingPerms =
            oldUser.permissions && typeof oldUser.permissions === "object" ? oldUser.permissions : {};
          updateData.permissions = { ...existingPerms, ...(updateData.permissions as object) };
        }

        const { error: updateError } = await supabase
          .from("users")
          .update({ ...updateData, updatedAt: new Date().toISOString() })
          .eq("id", targetId);

        if (updateError) throw updateError;

        if (adminId && adminName) {
            await recordAuditLog(adminId, adminName, "UPDATE_USER", oldUser.ReferenceID, `${oldUser.Firstname} ${oldUser.Lastname}`, `Updated user details`);
        }

        return res.status(200).json({ message: "User updated successfully" });
      } catch (error: any) {
        console.error("[AdminUsers] PUT error:", error);
        return res.status(500).json({ error: "Failed to update user", details: error.message });
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
      res.setHeader("Allow", ["GET", "POST", "PUT"]);
      return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
}
