/* ============================================================================
   POST /api/public/website-inquiry
   ----------------------------------------------------------------------------
   Receives a contact-form submission from the marketing site
   (website/contact.html) and stores it in public.website_inquiries.

   WHY THIS IS PUBLIC
   The marketing site is unauthenticated by definition — nobody has an account
   before they enquire. So this route has no session check, and that makes it
   the single most abused endpoint in the app. Everything below exists because
   of that, not in spite of it.

   THE FOUR DEFENCES
     1. Field validation with length caps.
     2. A honeypot field. Bots fill every input they find; humans never see it
        because it is off-screen. Cheaper than a captcha and it does not cost a
        legitimate field agent on mobile data a single tap.
     3. Per-IP rate limiting, in memory. See the note on the number below.
     4. Email format check. Deliberately permissive — over-strict regexes reject
        valid addresses and the only real test is delivering to them.

   THE DATABASE CHECK CONSTRAINTS ARE A BACKSTOP, NOT A DEFENCE
   Every column is capped by a CHECK as well (verified live: an over-long
   message is rejected with 23514). Do not mistake those for a working spam
   control. This route truncates with clean() BEFORE it inserts, so a CHECK can
   never fire from here. They exist to stop a bad direct write, a future code
   path that forgets to cap, and a hand-edited row. The defences that actually
   run are the three above.

   NO CAPTCHA, ON PURPOSE
   The audience is Philippine field teams on mobile data. A captcha on a
   demo-request form loses more real leads than it stops bots. If this ever gets
   hammered, add Cloudflare Turnstile — not a checkbox.

   IT DEGRADES QUIETLY IF THE MIGRATION HAS NOT BEEN RUN
   42P01 → 200 with { ok: true, stored: false }. The visitor's site is static and
   cannot know about our database, so showing them an error would lose the lead
   over a missing migration. The admin page says the table is absent instead.
   ========================================================================== */

import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

/* ── Rate limit ──────────────────────────────────────────────────────────────
   10 submissions per IP per 10 minutes.

   THE NUMBER IS SET BY THE AUDIENCE, NOT BY THE THREAT MODEL. This product's
   users are Philippine field teams, and they share office and warehouse
   connections. Every device behind one NAT arrives with the same public IP, so
   an aggressive per-IP limit does not merely throttle bots — it locks out a
   whole branch that is legitimately trying to reach us. The first cut here was
   5, and testing surfaced exactly that: five requests from one address and the
   sixth real enquiry is refused.

   Ten per ten minutes sits far above any human (nobody submits a demo request
   ten times) while still being awkward for a naive script. The real defence is
   the honeypot plus the CHECK length constraints, which make bulk submits fail
   on their own.

   IN-MEMORY, AND THAT IS A KNOWN LIMITATION: serverless gives each warm
   instance its own heap, so N instances means N x 10. If this route ever shows
   sustained abuse, move the counter to a table rather than raising the number
   here. */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateHits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (rateHits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  // Opportunistic cleanup: without it the map grows one entry per distinct IP
  // for the life of the process, which on a long-lived server is a slow leak.
  if (hits.length >= RATE_LIMIT_MAX) {
    rateHits.set(ip, hits);
    return true;
  }

  hits.push(now);
  rateHits.set(ip, hits);
  return false;
}

/* Trim + collapse runs of whitespace, and strip control characters. Free-text
   fields are stored and later rendered in the admin UI, so a newline-only or
   zero-width-laden value must not become a formatting trick. */
function clean(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .slice(0, max);
}

/** One @, something either side, a plausible domain. Not RFC 5322. */
function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  /* The marketing site is served from a different origin than the app, so CORS
     is mandatory. `*` is correct here and only here: there is no cookie, no
     Authorization header, and nothing to read back — the response is a boolean
     the site already knows the answer to. */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST", "OPTIONS"]);
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  if (rateLimited(ip)) {
    /* 429 is honest and the site knows how to word it. Returning 200 instead
       would let a script keep hammering without noticing. */
    return res.status(429).json({
      ok: false,
      error: "Too many submissions. Please try again in a few minutes, or email us directly.",
    });
  }

  const b = (req.body || {}) as Record<string, unknown>;

  /* Honeypot FIRST, before any validation or database work.
     `website_url` is a plausible-looking field name a bot will fill; humans
     never see it because it is off-screen and hidden from assistive tech. */
  const honey = clean(b.website_url, 200);
  if (honey) {
    /* Answer exactly as a success would. Telling a bot it was caught just
       teaches it to try again differently. */
    console.warn(`[website-inquiry] honeypot tripped from ${ip}`);
    return res.status(200).json({ ok: true, stored: false });
  }

  const name = clean(b.name, 120);
  const email = clean(b.email, 200);
  const company = clean(b.company, 160);
  const message = clean(b.message, 4000);
  const userRange = clean(b.user_range, 40);
  const sourcePage = clean(b.source_page, 200);

  /* 400 with a field-keyed error so the site can put the message under the
     right input instead of showing one generic banner. */
  const errors: Record<string, string> = {};
  if (!name) errors.name = "Please tell us your name.";
  if (!email) errors.email = "We need an email to reply to.";
  else if (!looksLikeEmail(email)) errors.email = "That doesn't look like an email address yet.";
  if (!message) errors.message = "A sentence or two is plenty.";
  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, error: "Please check the form.", errors });
  }

  if (!supabase) {
    return res.status(500).json({
      ok: false,
      error: "The server is not configured. Please email us directly.",
    });
  }

  const { error } = await supabase.from("website_inquiries").insert({
    name,
    email,
    company: company || null,
    message,
    user_range: userRange || null,
    source_page: sourcePage || null,
    submitted_ip: ip,
    user_agent: clean(req.headers["user-agent"], 400) || null,
    status: "new",
    is_read: false,
  });

  if (error) {
    /* 42P01 = the migration has not been applied. The visitor is not at fault
       and there is nothing they can do about it, so they get the confirmation
       and the console gets a warning. Failing loudly here would mean a missing
       migration silently swallows every demo request on the marketing site. */
    if (error.code === "42P01" || error.code === "42703" || error.code === "PGRST204") {
      console.warn(
        "[website-inquiry] website_inquiries is missing — run " +
          "supabase/migrations/20260107_website_inquiries.sql. Submission discarded: " +
          `${name} <${email}>`
      );
      return res.status(200).json({ ok: true, stored: false });
    }

    /* A CHECK violation means a field the client validated differently than
       the database does. 400 is right: the data is wrong, not the server. */
    if (error.code === "23514") {
      return res.status(400).json({
        ok: false,
        error: "Please check the form.",
        errors: { message: "That message is too long." },
      });
    }

    console.error("[website-inquiry] insert failed:", error);
    return res.status(500).json({
      ok: false,
      error: "Something went wrong on our side. Please email us directly.",
    });
  }

  return res.status(201).json({ ok: true, stored: true });
}