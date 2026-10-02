import { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { guard } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAuditLog } from "@/utils/audit-logger";

/**
 * POST /api/admin/reset-password
 * body: { userId, tempPassword?, forceChangeOnLogin? }
 *
 * Sets a temporary password, clears the lockout counters, and emails it.
 *
 *   UPDATE users SET "Password" = <bcrypt>, "LoginAttempts" = 0,
 *                    "LockUntil" = NULL, updatedAt = now()
 *    WHERE id = $1
 *
 * Column names are exactly as they exist in the schema. When the users table
 * has no `mustChangePassword` column (it does not, per the schema) the
 * "force change" request is returned to the client as a flag so the UI can
 * still prompt; it is not silently dropped.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const admin = await guard(req, res, "can_manage_users");
  if (!admin) return;

  // Resetting passwords is destructive — keep it deliberate.
  if (!checkRateLimit(req, res, { limit: 20, windowMs: 60_000, scope: "admin-reset-password" })) {
    return;
  }

  if (!supabase) {
    return res.status(500).json({ success: false, message: "Database connection error" });
  }

  try {
    const { userId, tempPassword, forceChangeOnLogin = true } = req.body ?? {};

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required." });
    }

    // ── Target ─────────────────────────────────────────────────────────────
    const { data: target, error: findErr } = await supabase
      .from("users")
      .select('id, "Firstname", "Lastname", "Email", "Role"')
      .eq("id", userId)
      .maybeSingle();

    if (findErr) {
      console.error("[reset-password] lookup failed:", findErr);
      return res.status(500).json({ success: false, message: "Could not find that user." });
    }
    if (!target) {
      return res.status(404).json({ success: false, message: "That user no longer exists." });
    }

    // ── Password ───────────────────────────────────────────────────────────
    // Generate one when the admin didn't supply their own.
    const password =
      typeof tempPassword === "string" && tempPassword.trim().length >= 6
        ? tempPassword.trim()
        : generateTempPassword();

    const hashed = await bcrypt.hash(password, 10);

    // ── Update: set password and clear the lockout counters ────────────────
    const { data: updated, error: updErr } = await supabase
      .from("users")
      .update({
        Password: hashed,
        LoginAttempts: 0,
        LockUntil: null,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", userId)
      .select("id")
      .maybeSingle();

    if (updErr) {
      console.error("[reset-password] update failed:", updErr);
      return res.status(500).json({ success: false, message: "Could not set the password." });
    }
    if (!updated) {
      return res.status(404).json({ success: false, message: "That user no longer exists." });
    }

    // Force any existing sessions to end, otherwise the old session would keep
    // working after a credential reset.
    await supabase.from("sessions").delete().eq("userId", userId);

    await recordAuditLog(
      String(admin.id),
      admin.email,
      "reset_password",
      String(userId),
      target.Email || String(userId),
      `Temporary password issued${forceChangeOnLogin ? " with forced change" : ""}`
    ).catch(() => {
      /* auditing must not block the reset */
    });

    // ── Email (best effort — the reset already succeeded) ─────────────────
    let emailed = false;
    let emailError: string | undefined;
    if (target.Email) {
      try {
        const { sendTemporaryPasswordEmail } = await import("@/lib/emails");
        const sent = await sendTemporaryPasswordEmail(
          target.Email,
          password,
          Boolean(forceChangeOnLogin)
        );
        emailed = sent.ok;
        if (!sent.ok) emailError = sent.error;
      } catch (err: any) {
        emailError = err?.message || "Failed to send email";
      }
    }

    // The plain password is returned ONCE so the admin can copy it. It is
    // never stored in plaintext or logged.
    return res.status(200).json({
      success: true,
      message: `Password reset for ${target.Email || "user"}.`,
      tempPassword: password,
      emailed,
      emailError,
      // The schema has no mustChangePassword column, so surface the intent
      // rather than pretending it was persisted.
      forceChangeOnLogin: Boolean(forceChangeOnLogin),
      forceChangePersisted: false,
      userId,
    });
  } catch (err: any) {
    console.error("[reset-password] fatal:", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Something went wrong." });
  }
}

/** Readable but not guessable: avoids characters that are easy to confuse. */
function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;

  const pick = (set: string) => set[crypto.randomInt(0, set.length)];

  // Guarantee one of each class, then fill and shuffle.
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));

  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}