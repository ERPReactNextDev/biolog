import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { requireSession, hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  MAX_OB_PHOTOS,
  OB_STATUS,
  computeLateFiling,
  type ObRequest,
} from "@/lib/ob-requests";

/* ============================================================================
   /api/ob-request — Official Business Trip (ROBT) requests, image-first

   GET  ?scope=mine                       → the caller's own requests
   GET  ?scope=queue&filter=pending|approved|declined|late|all
                                          → requires `can_review_ob`
   POST                                 → file a new request

   IDENTITY IS NEVER TRUSTED FROM THE BODY
   ReferenceID, Name, Position and Department are all resolved from the session
   cookie. pages/api/gps-report.ts reads ReferenceID out of the request, which
   means any caller can file a report under somebody else's name; this route
   does not repeat that mistake, because an OB request is a leave/attendance
   record with a financial consequence (guideline 2: an unfiled OB is treated as
   an absence subject to salary deduction).
   ========================================================================== */

/** Only http(s) URLs are stored — never a data: URL or a javascript: scheme. */
function isSafeImageUrl(u: unknown): u is string {
  return typeof u === "string" && /^https?:\/\//i.test(u) && u.length < 2000;
}

/**
 * Tenant filter.
 *
 * company_id is nullable and, on installs that have not backfilled
 * 20260101_admin_platform.sql, is NULL on every row. Filtering unconditionally
 * would therefore return an empty queue and look like "no requests" rather than
 * a config problem — so the filter is applied only when the caller actually has
 * a company, and single-tenant installs behave exactly as before.
 */
function scopeToCompany(query: any, companyId: number | string | null | undefined) {
  return companyId === null || companyId === undefined ? query : query.eq("company_id", companyId);
}

/** Extra profile fields the session payload doesn't carry. */
async function loadProfile(userId: number | string) {
  if (!supabase) return { firstName: "", lastName: "", companyId: null as number | null };
  const { data } = await supabase
    .from("users")
    .select("Firstname, Lastname, company_id")
    .eq("id", userId)
    .maybeSingle();
  return {
    firstName: data?.Firstname || "",
    lastName: data?.Lastname || "",
    companyId: (data?.company_id as number | null) ?? null,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  if (!supabase) {
    return res.status(500).json({ error: "Database is not configured." });
  }

  if (!checkRateLimit(req, res, { limit: 60, windowMs: 60_000, scope: "ob-request" })) return;

  const user = await requireSession(req, res);
  if (!user) return;

  /* ── GET ────────────────────────────────────────────────────────────────── */

  if (req.method === "GET") {
    const scope = String(req.query.scope || "mine");
    const filter = String(req.query.filter || "all").toLowerCase();

    // The queue is the reviewer's view and is permission-gated. Everything else
    // defaults to "mine" so a missing/typo'd scope param can never widen access.
    if (scope !== "mine" && !hasPermission(user, "can_review_ob")) {
      return res.status(403).json({
        error: "You do not have permission to review OB requests.",
      });
    }

    let query = supabase.from("ob_requests").select("*");

    if (scope === "mine") {
      query = query.eq("ReferenceID", user.referenceId);
    } else {
      const { companyId } = await loadProfile(user.id);
      query = scopeToCompany(query, companyId);
    }

    if (filter === "pending") {
      query = query.in("Status", [OB_STATUS.PENDING, OB_STATUS.FOR_COO]);
    } else if (filter === "approved") {
      query = query.eq("Status", OB_STATUS.APPROVED);
    } else if (filter === "declined") {
      query = query.eq("Status", OB_STATUS.DECLINED);
    } else if (filter === "late") {
      query = query.eq("IsLateFiling", true);
    } else if (filter !== "all") {
      return res.status(400).json({ error: "Unknown filter." });
    }

    const { data, error } = await query
      .order("date_created", { ascending: false })
      .limit(Number(req.query.limit) || 200);

    if (error) {
      console.error("[ob-request] list error:", error);
      return res.status(500).json({ error: "Could not load OB requests." });
    }

    const requests = (data || []) as ObRequest[];

    // Counts are computed from the same scoped set so the filter chips and the
    // admin badge never disagree with the list underneath them.
    const counts = {
      all: requests.length,
      pending: requests.filter((r) => r.Status === OB_STATUS.PENDING || r.Status === OB_STATUS.FOR_COO)
        .length,
      approved: requests.filter((r) => r.Status === OB_STATUS.APPROVED).length,
      declined: requests.filter((r) => r.Status === OB_STATUS.DECLINED).length,
      late: requests.filter((r) => r.IsLateFiling).length,
    };

    return res.status(200).json({ requests, counts, isReviewer: hasPermission(user, "can_review_ob") });
  }

  /* ── POST ───────────────────────────────────────────────────────────────── */

  const {
    photos,
    destination,
    dateOfOB,
    purposeOfTravel,
    justification,
  } = (req.body || {}) as Record<string, unknown>;

  /* Validation. The photo is the whole point of the feature, so it is enforced
     here as well as in the UI — and again by a CHECK constraint in the DB. */
  if (!Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ error: "A photo of the signed OB form is required." });
  }
  if (photos.length > MAX_OB_PHOTOS) {
    return res.status(400).json({ error: `At most ${MAX_OB_PHOTOS} images are allowed.` });
  }
  const cleanPhotos = photos.filter(isSafeImageUrl);
  if (cleanPhotos.length !== photos.length) {
    return res.status(400).json({ error: "One or more image URLs were invalid." });
  }

  const clean = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  if (dateOfOB !== undefined && dateOfOB !== null && dateOfOB !== "") {
    if (typeof dateOfOB !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfOB)) {
      return res.status(400).json({ error: "Date of OB must be a YYYY-MM-DD date." });
    }
    if (Number.isNaN(Date.parse(dateOfOB))) {
      return res.status(400).json({ error: "Date of OB is not a real date." });
    }
  }

  // Recomputed server-side from the actual filing date rather than trusting the
  // toggle in the UI — otherwise "filed at least a day ahead" would be a value
  // the client gets to choose, which is the exact rule the COO relies on.
  const isLateFiling = computeLateFiling(clean(dateOfOB, 10) || null);

  const { firstName, lastName, companyId } = await loadProfile(user.id);

  const row = {
    ReferenceID: user.referenceId,
    Name: `${firstName} ${lastName}`.trim() || user.email,
    Position: user.role,
    Department: user.department || "",
    Destination: clean(destination),
    DateOfOB: clean(dateOfOB, 10) || null,
    PurposeOfTravel: clean(purposeOfTravel, 1000),
    IsLateFiling: isLateFiling,
    Justification: clean(justification, 1000),
    PhotoURL: cleanPhotos,
    Status: OB_STATUS.PENDING,
    date_created: new Date().toISOString(),
    company_id: companyId,
  };

  const { data, error } = await supabase.from("ob_requests").insert(row).select("*").single();

  if (error) {
    console.error("[ob-request] insert error:", error);
    return res.status(500).json({ error: "Could not save the OB request. Please try again." });
  }

  const created = data as ObRequest;

  /* ── Notify (best effort) ────────────────────────────────────────────────
     Runs AFTER the row is committed, so a mail or bell failure can never cost
     the agent their request. The outcome is recorded on the row so the admin
     queue can show "OB email failed to send — check config". */

  let emailStatus: "sent" | "failed" | null = null;
  let emailError: string | null = null;

  try {
    const { onObSubmitted } = await import("@/lib/notifications");
    const outcome = await onObSubmitted(created, {
      companyId,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:5000",
    });

    // Only record a status when a send was actually attempted. Auto-send being
    // off is a deliberate configuration, not a failure, and recording 'failed'
    // for it would light the admin banner for a system working as intended.
    if (outcome.email.attempted) {
      emailStatus = outcome.email.sent ? "sent" : "failed";
      emailError = outcome.email.sent ? null : outcome.email.error || "Unknown error";
      if (emailStatus === "failed") {
        console.error("[ob-request] HRAD email failed:", emailError);
      }
    }
  } catch (err: any) {
    console.warn("[ob-request] notification step threw:", err);
    emailStatus = "failed";
    emailError = err?.message || "Unknown error";
  }

  if (emailStatus) {
    // Fire-and-forget: the response must not wait on a second round trip.
    void supabase
      .from("ob_requests")
      .update({
        EmailStatus: emailStatus,
        EmailError: emailError,
        EmailSentAt: emailStatus === "sent" ? new Date().toISOString() : null,
      })
      .eq("id", created.id);
  }

  return res.status(201).json({
    request: created,
    message: "OB request submitted.",
    isLateFiling,
  });
}