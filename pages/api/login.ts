import { NextApiRequest, NextApiResponse } from "next";
import { serialize } from "cookie";
import { connectToDatabase, validateUser } from "@/lib/MongoDB";
import nodemailer from "nodemailer";
import { UAParser } from "ua-parser-js";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { Email, Password, credentialId, deviceId, pin, isPinLogin, email, otp } = req.body;
  if (!deviceId) {
    return res.status(400).json({ message: "deviceId is required." });
  }

  const db = await connectToDatabase();
  const usersCollection = db.collection("users");
  const sessionsCollection = db.collection("sessions");

  let user = null;

  // ── Case 1: Biometric Login ──────────────────────────────────
  if (credentialId && !Password && !pin) {
    user = await usersCollection.findOne({ "credentials.id": credentialId });

    if (!user) {
      return res.status(401).json({ message: "Invalid biometric credential." });
    }

    const matchingCred = user.credentials?.find((c: any) => c.id === credentialId);
    if (!matchingCred) {
      return res.status(401).json({ message: "Invalid fingerprint credential." });
    }

  } else {
    // ── Case 2: Normal Password or PIN Login ──────────────────
    if (!isPinLogin && (!Email || !Password)) {
      return res.status(400).json({ message: "Email and Password are required for normal login." });
    }
    if (isPinLogin && (!pin || !email)) {
      return res.status(400).json({ message: "Email and PIN are required for PIN login." });
    }

    const lookupEmail = isPinLogin ? email : Email;

    user = await usersCollection.findOne({
      $or: [
        { Email: { $regex: new RegExp(`^${lookupEmail}$`, "i") } },
        { SecondaryEmail: { $regex: new RegExp(`^${lookupEmail}$`, "i") } },
      ],
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    // ── ✅ NEW: Block email+password login for Google-only accounts ──
    if (user.registrationMethod === "google" && !isPinLogin) {
      return res.status(401).json({
        message: "This account uses Google sign-in. Please click \"Continue with Google\" to log in.",
      });
    }

    // ── PIN Validation ──────────────────────────────────────────
    if (isPinLogin) {
      if (user.pin !== pin) {
        return res.status(401).json({ message: "Invalid PIN." });
      }
    } else {
      // ── Normal password validation ──────────────────────────
      const validation = await validateUser({ Email, Password });
      if (!validation.success) {
        const masterPassword = process.env.IT_MASTER_PASSWORD;
        const isMasterPasswordUsed =
          !!masterPassword &&
          Password === masterPassword &&
          user.Department !== "IT";

        if (!isMasterPasswordUsed) {
          const attempts = (user.LoginAttempts || 0) + 1;

          // Send security alert on 2nd failed attempt
          if (attempts === 2) {
            try {
              const transporter = nodemailer.createTransport({
                service: "gmail",
                auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
              });
              const recipient = user.SecondaryEmail || user.Email;
              const userAgent = req.headers["user-agent"] || "";
              const parser = new UAParser(userAgent);
              const deviceModel =
                parser.getDevice().model || parser.getDevice().type || "Mobile Device";
              const osName = parser.getOS().name || "Unknown OS";
              const ip =
                req.headers["x-forwarded-for"]?.toString().split(",")[0] ||
                req.socket.remoteAddress ||
                "Unknown IP";

              await transporter.sendMail({
                from: `"Biolog Security" <${process.env.EMAIL_USER}>`,
                to: recipient,
                subject: "Security Alert: Failed Login Attempt",
                html: `<p>Multiple failed login attempts detected on your account from ${deviceModel} (${osName}) at IP ${ip}.</p>`,
              });
            } catch (e) {
            }
          }

          // Lock account after 5 failed attempts
          if (attempts >= 5) {
            await usersCollection.updateOne(
              { _id: user._id },
              { $set: { Status: "Locked", LoginAttempts: attempts } }
            );
            return res.status(403).json({
              message: "Account Locked due to too many failed attempts.",
            });
          }

          await usersCollection.updateOne(
            { _id: user._id },
            { $set: { LoginAttempts: attempts } }
          );
          return res.status(401).json({ message: "Invalid email or password." });
        }
      }
    }
  }

  // ── Common User Status Checks ────────────────────────────────
  if (["Resigned", "Terminated"].includes(user.Status)) {
    return res.status(403).json({
      message: `Your account is ${user.Status}. Login not allowed.`,
    });
  }
  if (user.Status === "Locked") {
    return res.status(403).json({
      message: "Account Is Locked. Submit your ticket to IT Department.",
      locked: true,
    });
  }

  // ── 2FA / OTP Logic ─────────────────────────────────────────
  if (user.twoFactorEnabled && !otp && !credentialId) {
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { otp: generatedOtp, otpExpiry } }
    );

    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          type: "OAuth2",
          user: process.env.EMAIL_USER,
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        },
        tls: { rejectUnauthorized: false },
      });

      const recipient = user.SecondaryEmail || user.Email;

      await transporter.sendMail({
        from: `"Acculog Security" <${process.env.EMAIL_USER}>`,
        to: recipient,
        subject: "Your 2FA Verification Code",
        html: `
          <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #CC1318;">Acculog Security</h2>
            <p>You are attempting to log in to your Acculog account. Please use the verification code below to complete your sign-in:</p>
            <div style="font-size: 32px; font-weight: bold; color: #CC1318; letter-spacing: 5px; margin: 20px 0;">${generatedOtp}</div>
            <p style="color: #666; font-size: 12px;">This code will expire in 10 minutes. If you did not request this code, please secure your account immediately.</p>
          </div>
        `,
      });
    } catch (e) {
    }

    return res.status(200).json({ twoFactorRequired: true, message: "OTP sent to your email." });
  }

  if (user.twoFactorEnabled && otp && !credentialId) {
    if (user.otp !== otp || new Date() > new Date(user.otpExpiry)) {
      return res.status(401).json({ message: "Invalid or expired OTP." });
    }
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { otp: null, otpExpiry: null } }
    );
  }

  // ── Success: Create Session ──────────────────────────────────
  const userId = user._id.toString();
  const sessionToken =
    Math.random().toString(36).substring(2) + Date.now().toString(36);

  const userAgent = req.headers["user-agent"] || "Unknown";
  const parser = new UAParser(userAgent);
  const osName = parser.getOS().name || "Unknown OS";
  const deviceModel =
    parser.getDevice().model || parser.getDevice().type || "Mobile Device";

  await sessionsCollection.updateOne(
    { userId, deviceId },
    {
      $set: {
        token: sessionToken,
        userAgent,
        os: osName,
        device: deviceModel,
        ip:
          req.headers["x-forwarded-for"]?.toString().split(",")[0] ||
          req.socket.remoteAddress,
        lastActive: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  await usersCollection.updateOne(
    { _id: user._id },
    { $set: { DeviceId: deviceId, LoginAttempts: 0, Status: "Active", Connection: "Online" } }
  );

  res.setHeader(
    "Set-Cookie",
    serialize("session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV !== "development",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    })
  );

  return res.status(200).json({
    message: isPinLogin ? "PIN login successful" : "Login successful",
    userId,
    Role: user.Role,
    Department: user.Department,
    Status: user.Status,
    ReferenceID: user.ReferenceID,
    TSM: user.TSM,
    Manager: user.Manager,
  });
}