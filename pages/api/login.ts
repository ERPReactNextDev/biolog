import { NextApiRequest, NextApiResponse } from "next";
import { serialize } from "cookie";
import { supabase } from "@/lib/supabase";
import { UAParser } from "ua-parser-js";
import bcrypt from "bcryptjs";
import { verify } from "otplib";
import { checkRateLimit, LIMITS } from "@/lib/rate-limit";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  /* Password + TOTP guessing. The limit sits above the method check so the
     flood is cheap to absorb even for malformed requests. */
  if (!checkRateLimit(req, res, LIMITS.login)) return;

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!supabase) {
    console.error("Supabase client is null");
    return res.status(500).json({ message: "Database connection not initialized." });
  }

  try {
    const { Email, Password, credentialId, deviceId, pin, isPinLogin, email, otp } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ message: "deviceId is required." });
    }

    let user = null;

    // ── Case 1: Biometric Login ──────────────────────────────────
    if (credentialId && !Password && !pin) {
      console.log("[Login] Biometric login attempt with credentialId:", credentialId);
      const { data: allUsers, error: allUsersError } = await supabase.from("users").select("*");
      console.log("[Login] All users from DB:", allUsers);
      
      let foundUser = null;
      if (allUsers && allUsers.length > 0) {
        for (const u of allUsers) {
          console.log("[Login] Checking user:", u.Email, "with credentials:", u.credentials);
          if (u.credentials && Array.isArray(u.credentials)) {
            const hasMatch = u.credentials.some((cred: any) => cred.id === credentialId);
            if (hasMatch) {
              foundUser = u;
              break;
            }
          }
        }
      }

      if (!foundUser) {
        console.log("[Login] No user found with matching credential");
        return res.status(401).json({ message: "Invalid biometric credential." });
      }
      console.log("[Login] Found user for biometric login:", foundUser.Email);
      user = foundUser;

    } else {
      // ── Case 2: Normal Password or PIN Login ──────────────────
      if (!isPinLogin && (!Email || !Password)) {
        return res.status(400).json({ message: "Email and Password are required." });
      }
      if (isPinLogin && (!pin || !email)) {
        return res.status(400).json({ message: "Email and PIN are required." });
      }

      const lookupEmail = (isPinLogin ? email : Email)?.trim();

      if (!lookupEmail) {
        return res.status(400).json({ message: "Email is required." });
      }

      console.log(`[Login] Attempting login for: ${lookupEmail}`);

      // Search for user by Email or SecondaryEmail
      // Removed double quotes as they might be causing issues with ilike in some cases
      // If the email has special characters that cause issues with .or(), 
      // we'll try an alternative approach.
      let { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .or(`Email.ilike.${lookupEmail},SecondaryEmail.ilike.${lookupEmail}`)
        .maybeSingle();

      if (userError) {
        console.error("[Login] Supabase Query Error:", userError);
        // Fallback to exact match if .or() fails
        const { data: exactData, error: exactError } = await supabase
          .from("users")
          .select("*")
          .eq("Email", lookupEmail)
          .maybeSingle();
        
        if (!exactError && exactData) {
          userData = exactData;
        } else {
          return res.status(500).json({ message: `Database error: ${userError.message}` });
        }
      }

      if (!userData) {
        console.warn(`[Login] User not found: ${lookupEmail}`);
        return res.status(401).json({ message: "Account not found. Please check your email." });
      }
      
      user = userData;
      console.log(`[Login] User found: ${user.Email} (ID: ${user.id})`);

      // ── Google Account Check ──
      if (user.registrationMethod === "google" && !isPinLogin) {
        return res.status(401).json({
          message: "This account uses Google sign-in. Please use 'Continue with Google'.",
        });
      }

      // ── PIN Validation ──────────────────────────────────────────
      if (isPinLogin) {
        if (user.pin !== pin) {
          console.warn(`[Login] Invalid PIN for user: ${lookupEmail}`);
          return res.status(401).json({ message: "Invalid PIN." });
        }
      } else {
        // ── Normal password validation ──────────────────────────
        const dbPassword = user.Password || user.password;
        
        if (!dbPassword) {
          console.error(`[Login] No password in DB for user: ${user.id}`);
          return res.status(401).json({ message: "Account configuration error. Please contact support." });
        }

        const isValid = await bcrypt.compare(Password, dbPassword);
        console.log(`[Login] Password comparison result for ${lookupEmail}: ${isValid}`);

        if (!isValid) {
          // Fallback: plain text check (for migration)
          if (Password === dbPassword) {
            console.warn(`[Login] User logged in with plain text password: ${user.Email}`);
          } else {
            // Master password check
            const masterPassword = process.env.IT_MASTER_PASSWORD;
            const isMasterPasswordUsed =
              !!masterPassword &&
              Password === masterPassword &&
              user.Department !== "IT";

            if (!isMasterPasswordUsed) {
              const attempts = (user.LoginAttempts || 0) + 1;
              await supabase.from("users").update({ LoginAttempts: attempts }).eq("id", user.id);
              console.warn(`[Login] Invalid password for user: ${lookupEmail}. Attempts: ${attempts}`);
              return res.status(401).json({ message: "Invalid email or password." });
            }
          }
        }
      }
    }

    // ── Common Status Checks ────────────────────────────────
    if (["Resigned", "Terminated"].includes(user.Status)) {
      return res.status(403).json({ message: `Account is ${user.Status}. Login denied.` });
    }
    if (user.Status === "Locked") {
      return res.status(403).json({ message: "Account is Locked. Contact IT." });
    }

    // ── 2FA Logic ─────────────────────────────────────────
    if (user.twoFactorEnabled && !otp && !credentialId) {
      return res.status(200).json({ twoFactorRequired: true, message: "Verification code required." });
    }

    if (user.twoFactorEnabled && otp && !credentialId) {
      if (!user.twoFactorSecret) {
        return res.status(400).json({ message: "2FA setup not complete" });
      }
      
      const result = await verify({
        token: otp,
        secret: user.twoFactorSecret
      });
      
      if (!result.valid) {
        return res.status(401).json({ message: "Invalid verification code." });
      }
    }

    // ── Success: Create Session ──────────────────────────────────
    const userId = user.id.toString();
    const sessionToken = Math.random().toString(36).substring(2) + Date.now().toString(36);

    const userAgent = req.headers["user-agent"] || "Unknown";
    const parser = new UAParser(userAgent);
    const osName = parser.getOS().name || "Unknown OS";
    const deviceModel = parser.getDevice().model || parser.getDevice().type || "Mobile Device";

    const { error: sessionError } = await supabase
      .from("sessions")
      .upsert({
        userId,
        deviceId,
        token: sessionToken,
        userAgent,
        os: osName,
        device: deviceModel,
        ip: req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.socket.remoteAddress,
        lastActive: new Date().toISOString(),
      }, { onConflict: 'userId,deviceId' });

    if (sessionError) {
      console.error("[Login] Session creation error:", sessionError);
      return res.status(500).json({ message: `Failed to create session: ${sessionError.message}` });
    }

    await supabase
      .from("users")
      .update({ DeviceId: deviceId, LoginAttempts: 0, Status: "Active", Connection: "Online", LastLoginAt: new Date().toISOString() })
      .eq("id", user.id);

    res.setHeader("Set-Cookie", serialize("session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    }));

    console.log(`[Login] Successful login for: ${user.Email}`);

    return res.status(200).json({
      message: "Login successful",
      userId,
      _id: userId,
      Role: user.Role,
      Department: user.Department,
      Status: user.Status,
      ReferenceID: user.ReferenceID,
      TSM: user.TSM,
      Manager: user.Manager,
    });

  } catch (error: any) {
    console.error("[Login] Fatal Error:", error);
    return res.status(500).json({ message: `Internal server error: ${error.message}` });
  }
}
