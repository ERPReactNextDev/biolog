import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * POST /api/gps-report/update
 * body: { reportId, status: "approved" | "declined", reviewNotes? }
 *
 * Approve / decline a GPS report.
 *
 * ⚠ This route previously had NO authorization: any anonymous caller could
 * approve or decline any report and forge `reviewedBy`. It now requires a
 * session AND the `can_review_gps` permission.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // A reviewer hammering approve/decline is either buggy or hostile.
  if (!checkRateLimit(req, res, { limit: 60, windowMs: 60_000, scope: "gps-review" })) {
    return;
  }

  // ── Authorization ────────────────────────────────────────────────────────
  const admin = await guard(req, res, "can_review_gps");
  if (!admin) return;

  try {
    const { reportId, status, reviewNotes } = req.body ?? {};

    if (!reportId) {
      return res.status(400).json({ error: "Report ID is required" });
    }

    // "rejected" is accepted as a legacy alias; the schema uses "declined".
    const normalised =
      status === "approved" ? "approved" : status === "declined" || status === "rejected" ? "declined" : null;

    if (!normalised) {
      return res.status(400).json({ error: "Status must be 'approved' or 'declined'" });
    }

    // ── Update ──────────────────────────────────────────────────────────────
    const { data: updated, error } = await supabase
      .from("gps_reports")
      .update({
        reviewStatus: normalised,
        // Taken from the session, never from the request body.
        reviewedBy: admin.email,
        reviewNotes: (reviewNotes || "").trim(),
        reviewedAt: new Date().toISOString(),
      })
      .eq("id", reportId)
      .select("id, Email")
      .maybeSingle();

    if (error) {
      console.error("[gps-report/update] Supabase error:", error);
      return res.status(500).json({ error: "Could not save the review." });
    }
    if (!updated) {
      return res.status(404).json({ error: "Report not found" });
    }

    // ── Notify the submitter, plus a supervisor copy if configured ──────────
    // Both channels are optional-by-configuration. When Email Config has no
    // entry for this company we fall straight back to the plain env-configured
    // send so the agent is never silently skipped.
    if (updated.Email) {
      const notes = (reviewNotes || "").trim();
      try {
        const { loadEmailConfig, resolveApiKey, toSafeConfig } = await import("@/lib/email-config");
        const { data: reviewed } = await supabase
          .from("gps_reports")
          .select("company_id")
          .eq("id", reportId)
          .maybeSingle();

        const companyId = reviewed?.company_id ?? null;
        const safe = toSafeConfig(await loadEmailConfig(companyId));
        const apiKey = await resolveApiKey(companyId);

        const { sendGpsReviewEmail } = await import("@/lib/emails");
        const sent = await sendGpsReviewEmail(updated.Email, normalised, notes, {
          apiKey,
          senderEmail: safe.sender_email,
          senderName: safe.sender_name,
          supervisor: safe.gps_recipients[0] || null,
        });
        if (!sent.ok) console.warn("[gps-review] email failed:", sent.error);
      } catch (err) {
        // Config lookup failed — still send, just without the config extras.
        try {
          const { sendGpsReviewEmail } = await import("@/lib/emails");
          const sent = await sendGpsReviewEmail(updated.Email, normalised, notes);
          if (!sent.ok) console.warn("[gps-review] email failed:", sent.error);
        } catch (inner) {
          // The review is already saved; never fail the request over email.
          console.warn("[gps-review] email threw:", inner);
        }
        console.warn("[gps-review] email config lookup failed:", err);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Report ${normalised}`,
      reportId,
      status: normalised,
      reviewedBy: admin.email,
    });
  } catch (error) {
    console.error("[gps-report/update] error:", error);
    return res
      .status(500)
      .json({ error: "Failed to update report status. Please try again." });
  }
}