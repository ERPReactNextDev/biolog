import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";

/*
  GET /api/auth/google/callback
  ──────────────────────────────
  Fixes:
  1. Google users now get a bcrypt-hashed random password (not empty string)
     so bcrypt.compare never crashes.
  2. Redirect uses Supabase id — same identifier as /api/login's result.userId.
  3. registrationMethod: "google" flags the account so the login API can
     return a clear message if the user tries email + password login.
*/
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, error } = req.query;

  if (error || !code) {
    return res.redirect("/Login?error=google_denied");
  }

  try {
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google/callback`;

    /* ── 1. Exchange code for tokens ── */
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code:          code as string,
        client_id:     process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();

    if (!tokenRes.ok || !tokens.access_token) {
      return res.redirect("/Login?error=google_token_failed");
    }

    /* ── 2. Get Google profile ── */
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const profile = await profileRes.json();

    if (!profile.email) {
      return res.redirect("/Login?error=google_no_email");
    }

    /* ── 3a. Existing user ── */
    const { data: existing, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .ilike("Email", profile.email)
      .maybeSingle();

    if (existing) {
      if (existing.Status === "Active") {
        // Use Supabase id string
        return res.redirect(
          `/activity-planner?id=${encodeURIComponent(existing.id.toString())}`
        );
      }
      // Revoked / Resigned / Terminated
      return res.redirect("/pending-approval");
    }

    /* ── 3b. Brand-new Google user ── */

    // Hash a random UUID so Password is never an empty string.
    // bcrypt.compare will always return false — can't log in via email+password.
    const randomPassword = await bcrypt.hash(uuidv4(), 10);

    const { error: insertError } = await supabase.from("users").insert({
      Firstname:          profile.given_name  || profile.name?.split(" ")[0] || "User",
      Lastname:           profile.family_name || profile.name?.split(" ").slice(1).join(" ") || "",
      Email:              profile.email,
      Password:           randomPassword,     // valid bcrypt hash, unguessable
      Role:               "User",
      Department:         "",                 // admin fills this in later
      Company:            "",
      ReferenceID:        `G-${Date.now()}`,  // unique, readable
      Status:             "Revoked",          // admin must grant access
      ProfilePicture:     profile.picture || "",
      LoginAttempts:      0,
      Connection:         "Offline",
      registrationMethod: "google",           // flag for login API
      googleId:           profile.id,
      createdAt:          new Date().toISOString(),
    });

    if (insertError) throw insertError;

    return res.redirect("/pending-approval");

  } catch (err) {
    console.error("Google callback error:", err);
    return res.redirect("/Login?error=google_server_error");
  }
}