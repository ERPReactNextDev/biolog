/* ============================================================================
   Secret box — AES-256-GCM for credentials at rest
   ----------------------------------------------------------------------------
   WHY THIS EXISTS
   public.email_config holds a live Resend API key: anything that can read that
   row can send mail as the company, and Resend keys cannot be scoped down to a
   single sending domain the way a password can. Storing it as plaintext in a
   jsonb column that the admin UI reads back would make the whole admin console
   a credential-dump surface.

   So the key is encrypted with AES-256-GCM before it reaches the database, and
   the API never returns the plaintext — it returns a mask and a boolean.

   WHERE THE ENCRYPTION KEY COMES FROM
   EMAIL_CONFIG_SECRET is the intended source. IT_MASTER_PASSWORD is accepted as
   a fallback so existing installs are not broken by the new variable. If
   NEITHER is set, `canEncrypt()` is false and the API refuses to persist a
   key rather than silently writing it in the clear.

   AAD binds each ciphertext to a context string, so a value encrypted for
   "email_config:resend_api_key" cannot be replayed into another column.
   ========================================================================== */

import crypto from "crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "v1"; // version marker, so the scheme can be rotated later

type Box = { iv: string; tag: string; data: string };

function masterSecret(): Buffer | null {
  const raw =
    process.env.EMAIL_CONFIG_SECRET?.trim() || process.env.IT_MASTER_PASSWORD?.trim() || "";
  if (!raw) return null;
  // scrypt so a short passphrase still yields a full-strength key. The salt is
  // a fixed app constant: it is not protecting against an offline attacker with
  // the database, it is stretching a human-chosen secret into 32 bytes.
  return crypto.scryptSync(raw, "biolog-email-config", 32);
}

/** True when a key can be encrypted here. Surfaced to the UI as a warning. */
export function canEncrypt(): boolean {
  return masterSecret() !== null;
}

/** Encrypt with an associated-context binding. Returns `null` if unavailable. */
export function seal(plaintext: string, aad: string): string | null {
  const key = masterSecret();
  if (!key || !plaintext) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));

  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const box: Box = {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: data.toString("base64"),
  };
  return `${PREFIX}.${Buffer.from(JSON.stringify(box), "utf8").toString("base64")}`;
}

/**
 * Decrypt. Returns null for anything that is not a well-formed, authentic box —
 * a wrong AAD, a tampered payload and a value encrypted under a different
 * master secret are all indistinguishable here, which is the correct behaviour:
 * each of them means "this ciphertext is not usable", not "recover the text".
 */
export function open(ciphertext: string | null | undefined, aad: string): string | null {
  const key = masterSecret();
  if (!key || !ciphertext) return null;

  const parts = String(ciphertext).split(".");
  if (parts.length !== 2 || parts[0] !== PREFIX) return null;

  let box: Box;
  try {
    box = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
  if (!box?.iv || !box?.tag || !box?.data) return null;

  try {
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(box.iv, "base64"));
    if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(box.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(box.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** AAD context for the Resend key column. Change together with the column name. */
export const AAD_EMAIL_KEY = "email_config:resend_api_key";

/**
 * Show enough of a key to let an admin recognise which one is stored, and no
 * more. Resend keys are `re_` + ~36 chars, so the first 6 and last 4 identify
 * it without being usable.
 */
export function maskKey(plaintext: string): string {
  const k = (plaintext || "").trim();
  if (!k) return "";
  if (k.length <= 12) return "••••••••";
  return `${k.slice(0, 6)}••••••••${k.slice(-4)}`;
}