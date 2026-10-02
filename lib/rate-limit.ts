/* ============================================================================
   Rate limiting
   ----------------------------------------------------------------------------
   The repo had NO rate limiting anywhere, which left two real holes:

     • /api/login              → unlimited password/OTP guessing
     • password-reset-request  → unlimited OTP emails, i.e. mail-bombing a
                                 victim or burning through the Resend quota

   Dependency-free on purpose: `express-rate-limit` would not compose with the
   existing hand-written `export default async function handler` signatures
   without wrapping every route, and this is ~100 lines.

   HOW IT WORKS
   Sliding window. For each (route, IP) pair we keep the timestamps of recent
   hits and drop any that have fallen out of the window. A fixed window would
   let an attacker send 2x the budget by straddling the boundary.

   HEADERS
   X-RateLimit-Limit / X-RateLimit-Remaining on every response, plus
   Retry-After on a 429.

   ⚠ SERVERLESS CAVEAT
   This state lives in the Node process. On Vercel/Lambda each cold start (and
   each concurrent instance) gets its own bucket, so the effective limit is
   per-instance, not global. That is still enough to stop casual abuse, but if
   you need a hard global cap, swap `hits` for a Redis/Upstash counter — the
   call sites would not change, only `record()`.
   ========================================================================== */

import type { NextApiRequest, NextApiResponse } from "next";

export type RateLimitRule = {
  /** Hits allowed inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** 429 body override. */
  message?: string;
  /** Distinguishes buckets when several routes share a handler. */
  scope?: string;
};

type Bucket = { hits: number[] };

/** route scope -> ip -> hit timestamps */
const buckets = new Map<string, Bucket>();

let lastSweep = 0;

/** Drop buckets untouched for two windows so memory can't grow forever. */
function sweep(windowMs: number) {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    const cutoff = now - windowMs * 2;
    const live = bucket.hits.filter((t) => t > cutoff);
    if (live.length === 0) buckets.delete(key);
    else bucket.hits = live;
  }
}

/** Client IP, honouring the proxy headers Vercel / nginx set. */
export function clientIp(req: NextApiRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  if (Array.isArray(fwd) && fwd.length) return String(fwd[0]).split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.length) return real;
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Returns true when the request may proceed. When the budget is exhausted it
 * writes a 429 (with Retry-After) itself and returns false.
 */
export function checkRateLimit(
  req: NextApiRequest,
  res: NextApiResponse,
  rule: RateLimitRule
): boolean {
  const scope = rule.scope || req.url?.split("?")[0] || "unknown";
  const key = `${scope}|${clientIp(req)}`;

  sweep(rule.windowMs);

  const now = Date.now();
  const cutoff = now - rule.windowMs;
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  const remaining = rule.limit - bucket.hits.length;

  if (remaining <= 0) {
    // Soonest hit leaving the window = when a slot frees up.
    const retryAfter = Math.max(1, Math.ceil((bucket.hits[0] + rule.windowMs - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    res.setHeader("X-RateLimit-Limit", String(rule.limit));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.status(429).json({
      success: false,
      message:
        rule.message ||
        "Too many attempts. Please wait a moment and try again.",
      retryAfter,
    });
    return false;
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  res.setHeader("X-RateLimit-Limit", String(rule.limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining - 1));
  return true;
}

/* ── Budgets ───────────────────────────────────────────────────────────────
   Tuned for the real threat of a field-sales app on shared mobile networks,
   where many agents sit behind one carrier NAT IP. Limits are per-IP, so they
   lean generous to avoid locking out a legitimate office.                        */

export const LIMITS = {
  /** Credential guessing. */
  login: { limit: 10, windowMs: 15 * 60_000, message: "Too many sign-in attempts. Try again in a few minutes." },
  /** OTP brute force — 10^6 space, so this must stay tight. */
  otpVerify: { limit: 10, windowMs: 15 * 60_000, message: "Too many code attempts. Request a new code and wait before retrying." },
  /** Each hit sends a real email. The strictest budget in the app. */
  resetRequest: { limit: 3, windowMs: 15 * 60_000, message: "Too many codes requested. Please wait before trying again." },
  /** Changing the password itself. */
  resetComplete: { limit: 10, windowMs: 15 * 60_000, message: "Too many password changes. Please try again later." },
  /** Mass account creation. */
  register: { limit: 5, windowMs: 60 * 60_000, message: "Too many accounts created from this device. Please try again later." },
  /** 2FA enrolment. */
  twoFactor: { limit: 10, windowMs: 15 * 60_000, message: "Too many attempts. Please try again shortly." },
} satisfies Record<string, RateLimitRule>;