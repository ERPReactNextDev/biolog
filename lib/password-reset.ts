/* ============================================================================
   Password reset — signed tickets + Resend email
   ----------------------------------------------------------------------------
   There is no migration system in this repo, so rather than require a new
   Supabase table we use STATELESS signed tokens:

     request  -> OTP emailed, client gets a `ticket` (HMAC over email+otp+exp)
     verify   -> OTP checked against that ticket, returns a `resetToken`
     complete -> resetToken verified, password rehashed with bcrypt

   The secret is derived from an existing server-side env var, so nothing new
   has to be added to .env.local.
   ========================================================================== */

import crypto from "crypto";
import nodemailer from "nodemailer";

/* ── Secrets ───────────────────────────────────────────────────────────────── */

function resetSecret(): string {
  return (
    process.env.IT_MASTER_PASSWORD ||
    process.env.RESEND_API_KEY ||
    "biolog-dev-reset-secret"
  );
}

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");

function hmac(payload: string): string {
  return crypto.createHmac("sha256", resetSecret()).update(payload).digest("base64url");
}

/* ── Ticket signing ────────────────────────────────────────────────────────── */

export type TicketPurpose = "otp" | "reset";

export type SignedPayload = {
  /** purpose guard so an OTP ticket can't be replayed as a reset token */
  p: TicketPurpose;
  e: string; // email, lowercased
  /** extra secret material to prove knowledge (the OTP, or "confirmed") */
  k: string;
  exp: number; // epoch ms
};

/** Sign a payload into a compact `data.signature` string. */
export function signTicket(payload: SignedPayload): string {
  const data = b64u(JSON.stringify(payload));
  return `${data}.${hmac(data)}`;
}

/** Verify and decode. Returns null when tampered, malformed or expired. */
export function verifyTicket<T extends SignedPayload = SignedPayload>(
  token: string | undefined | null,
  purpose: TicketPurpose
): T | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;

  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = hmac(data);
  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: SignedPayload;
  try {
    payload = JSON.parse(unb64u(data));
  } catch {
    return null;
  }
  if (payload.p !== purpose) return null;
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload as T;
}

/* ── OTP ───────────────────────────────────────────────────────────────────── */

export const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes, per the spec
export const RESET_TTL_MS = 10 * 60 * 1000; // short window to finish resetting

export function generateOtp(): string {
  // crypto-random 6 digits, avoiding leading-zero loss
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export const maskEmail = (email: string) => {
  const [name = "", domain = ""] = email.split("@");
  if (!domain) return email;
  const head = name.slice(0, 1);
  const tail = name.length > 1 ? name.slice(-1) : "";
  return `${head}${tail}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
};

/* ── Email transport (Resend over SMTP, via nodemailer) ───────────────────── */

function transporter() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return nodemailer.createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: { user: "resend", pass: key },
  });
}

/** `RESEND_FROM` when set, else Resend's sandbox sender. */
function fromAddress() {
  return (
    process.env.RESEND_FROM ||
    "Biolog <onboarding@resend.dev>"
  );
}

/* ── Unverified-sender diagnostics ─────────────────────────────────────────────
   Resend's `onboarding@resend.dev` sandbox will only ever deliver to the
   Resend account owner's own address; every other recipient is rejected with
   a 550. That makes password reset silently non-functional for real users,
   so we shout about it in the server log instead of only returning a generic
   error the agent can't act on.

   To fix: verify a domain at https://resend.com/domains, then set
     RESEND_FROM="Biolog <no-reply@yourdomain.com>"
   in .env.local.                                                                            */

function isUnverifiedSenderError(err: any): boolean {
  const msg = String(err?.message || err || "");
  return /550/.test(msg) && /only send testing emails|verify a domain/i.test(msg);
}

function logUnverifiedSender(what: string, to: string) {
  console.error(
    [
      "",
      "══════════════════════════════════════════════════════════════════",
      ` [password-reset] ${what} email NOT SENT to ${to}`,
      " Cause: RESEND_FROM is not set, so the sandbox sender",
      "        onboarding@resend.dev is used. That sender only delivers",
      "        to the Resend account owner's own email — every other",
      "        recipient is rejected.",
      " Fix:   1. Verify a domain at https://resend.com/domains",
      "        2. Set RESEND_FROM=\"Biolog <no-reply@yourdomain.com>\"",
      "           in .env.local and restart the dev server.",
      "══════════════════════════════════════════════════════════════════",
      "",
    ].join("\n")
  );
}

export type EmailResult = { ok: true } | { ok: false; error: string };

export async function sendOtpEmail(to: string, code: string): Promise<EmailResult> {
  const t = transporter();
  if (!t) return { ok: false, error: "RESEND_API_KEY is not configured" };

  const minutes = Math.round(OTP_TTL_MS / 60000);
  const html = `
  <div style="font-family:Nunito,system-ui,-apple-system,sans-serif;background:#F7FCF9;padding:24px">
    <div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #E2ECE8;border-radius:18px;overflow:hidden">
      <div style="background:linear-gradient(180deg,#E8F6EF,#F7FCF9);padding:20px 24px;text-align:center">
        <div style="display:inline-flex;width:44px;height:44px;border-radius:15px;background:#0B7F5A;align-items:center;justify-content:center">
          <div style="width:20px;height:16px;position:relative">
            <div style="position:absolute;left:0;top:6px;width:20px;height:3px;border-radius:2px;background:#fff"></div>
            <div style="position:absolute;left:0;top:1px;width:11px;height:3px;border-radius:2px;background:#fff"></div>
            <div style="position:absolute;left:0;top:11px;width:14px;height:3px;border-radius:2px;background:#fff"></div>
          </div>
        </div>
        <div style="margin-top:8px;font-weight:900;letter-spacing:.12em;color:#096B4C;font-size:15px">BIOLOG</div>
      </div>

      <div style="padding:24px">
        <h1 style="margin:0 0 6px;font-size:20px;font-weight:900;color:#0F172A">Verify your email</h1>
        <p style="margin:0 0 18px;font-size:13px;font-weight:600;color:#64748B;line-height:1.5">
          We sent you a 6-digit code to reset your password.
        </p>

        <div style="font-size:30px;font-weight:900;letter-spacing:10px;text-align:center;color:#0D9669;
                    background:#E6F4EE;border-radius:16px;padding:18px 10px;margin-bottom:16px">
          ${code}
        </div>

        <div style="background:#FEF3C7;border-radius:14px;padding:12px 14px;margin-bottom:18px">
          <p style="margin:0;font-size:12px;font-weight:700;color:#92400E;line-height:1.5">
            This code expires in ${minutes} minutes. Never share it with anyone
            &mdash; we will never ask you for it.
          </p>
        </div>

        <p style="margin:0;font-size:12.5px;font-weight:600;color:#64748B;line-height:1.5">
          Didn&apos;t receive it? Check your spam or junk folder, or request a new code.
        </p>
      </div>
    </div>
  </div>`;

  try {
    await t.sendMail({
      from: fromAddress(),
      to,
      subject: `${code} is your Biolog verification code`,
      html,
    });
    return { ok: true };
  } catch (err: any) {
    console.error("[password-reset] OTP send failed:", err);
    if (isUnverifiedSenderError(err)) logUnverifiedSender("OTP", to);
    return { ok: false, error: err?.message || "Failed to send email" };
  }
}

export async function sendPasswordChangedEmail(to: string): Promise<EmailResult> {
  const t = transporter();
  if (!t) return { ok: false, error: "RESEND_API_KEY is not configured" };

  const html = `
  <div style="font-family:Nunito,system-ui,-apple-system,sans-serif;background:#F7FCF9;padding:24px">
    <div style="max-width:420px;margin:0 auto;background:#fff;border:1px solid #E2ECE8;border-radius:18px;overflow:hidden">
      <div style="background:linear-gradient(180deg,#E8F6EF,#F7FCF9);padding:20px 24px;text-align:center">
        <div style="margin:0;font-weight:900;letter-spacing:.12em;color:#096B4C;font-size:15px">BIOLOG</div>
      </div>
      <div style="padding:24px">
        <h1 style="margin:0 0 8px;font-size:19px;font-weight:900;color:#0F172A">Password updated</h1>
        <p style="margin:0;font-size:13px;font-weight:600;color:#64748B;line-height:1.6">
          Your password has been updated. You can now sign in with your new password.
        </p>
        <div style="background:#FDE8E8;border-radius:14px;padding:12px 14px;margin-top:18px">
          <p style="margin:0;font-size:12px;font-weight:700;color:#B91C1C;line-height:1.5">
            Wasn&apos;t this you? Contact the Biolog help desk immediately to lock your account.
          </p>
        </div>
      </div>
    </div>
  </div>`;

  try {
    await t.sendMail({
      from: fromAddress(),
      to,
      subject: "Your Biolog password was changed",
      html,
    });
    return { ok: true };
  } catch (err: any) {
    // Not fatal — the password is already changed.
    console.error("[password-reset] confirmation email failed:", err);
    return { ok: false, error: err?.message || "Failed to send email" };
  }
}
