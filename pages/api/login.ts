import { NextApiRequest, NextApiResponse } from "next";
import { serialize } from "cookie";
import { supabase } from "@/lib/supabase";
import nodemailer from "nodemailer";
import { UAParser } from "ua-parser-js";
import bcrypt from "bcrypt";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .contains("credentials", [{ id: credentialId }])
        .maybeSingle();

      if (userError || !userData) {
        return res.status(401).json({ message: "Invalid biometric credential." });
      }
      user = userData;

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
      const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      await supabase.from("users").update({ otp: generatedOtp, otpExpiry }).eq("id", user.id);

      try {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
          },
        });

        const recipient = user.SecondaryEmail || user.Email;
        await transporter.sendMail({
          from: `"Acculog Security" <${process.env.EMAIL_USER}>`,
          to: recipient,
          subject: "Your Verification Code",
          html: `<p>Your verification code is: <b>${generatedOtp}</b>. Valid for 10 minutes.</p>`,
        });
        console.log(`[Login] OTP sent to: ${recipient}`);
      } catch (e) {
        console.error("[Login] Failed to send 2FA email:", e);
      }

      return res.status(200).json({ twoFactorRequired: true, message: "OTP sent to your email." });
    }

    if (user.twoFactorEnabled && otp && !credentialId) {
      if (user.otp !== otp || new Date() > new Date(user.otpExpiry)) {
        return res.status(401).json({ message: "Invalid or expired OTP." });
      }
      await supabase.from("users").update({ otp: null, otpExpiry: null }).eq("id", user.id);
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
