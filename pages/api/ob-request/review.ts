import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  OB_REVIEW_ACTIONS,
  OB_STATUS,
  isValidObReviewTarget,
  normaliseObStatus,
  obReviewOutcome,
  parseObReviewAction,
} from "@/lib/ob-requests";

/* ============================================================================
   /api/ob-request/review
   body: { requestId, action: "Approved" | "Declined" | "For COO Approval", notes? }

   Approve, decline, or escalate a late OB request to the COO.

   Guarded by `can_review_ob` — see lib/rbac.ts. `ReviewedBy` comes from the
   session email, never from the body, so a reviewer cannot be forged.
   ========================================================================== */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  if (!supabase) {
    return res.status(500).json({ error: "Database is not configured." });
  }

  // A reviewer cycling approve/decline is either buggy or hostile.
  if (!checkRateLimit(req, res, { limit: 60, windowMs: 60_000, scope: "ob-review" })) return;

  const reviewer = await guard(req, res, "can_review_ob");
  if (!reviewer) return;

  try {
    const { requestId, action, notes } = (req.body || {}) as Record<string, unknown>;

    if (!requestId) {
      return res.status(400).json({ error: "Request ID is required." });
    }

    const target = parseObReviewAction(typeof action === "string" ? action : null);
    if (!target) {
      return res.status(400).json({ error: "That is not a valid review action." });
    }
    // Reachable from at least one status. Approved/Declined are, COO is not
    // (reserved — see OB_REVIEW_ACTIONS).
    if (!isValidObReviewTarget(target)) {
      return res.status(400).json({
        error: `"${target}" is not an action a reviewer can take right now.`,
      });
    }

    const cleanNotes = (typeof notes === "string" ? notes.trim() : "").slice(0, 1000);

    // Guideline: a decline must carry a reason — the agent gets it by email and
    // needs to know what to fix. Approval may go through without one.
    if (target === OB_STATUS.DECLINED && !cleanNotes) {
      return res.status(400).json({ error: "A reason is required when declining." });
    }

    const { data: current, error: readErr } = await supabase
      .from("ob_requests")
      .select('id, "ReferenceID", "Name", "Status", "Destination", "DateOfOB", "IsLateFiling", company_id')
      .eq("id", requestId)
      .maybeSingle();

    if (readErr) {
      console.error("[ob-review] read error:", readErr);
      return res.status(500).json({ error: "Could not load the OB request." });
    }
    if (!current) {
      return res.status(404).json({ error: "OB request not found." });
    }

    // Re-read the current status so a second reviewer cannot approve a request
    // that has already been declined.
    const now = normaliseObStatus(current.Status);
    if (!OB_REVIEW_ACTIONS[now].next.includes(target)) {
      return res.status(409).json({
        error: `This request is already marked "${OB_REVIEW_ACTIONS[now].label}" and cannot be changed.`,
      });
    }

    // NOTE: a late filing used to be blocked here from being approved, forcing
    // it to the COO instead (guideline 3). The chain is now Agent → HRAD with
    // no COO step, so late requests are approved or declined like any other —
    // the IsLateFiling flag and the justification are what HRAD judges on.
    // See lib/ob-requests.ts if COO sign-off comes back.

    const { error: updateErr } = await supabase
      .from("ob_requests")
      .update({
        Status: target,
        ReviewedBy: reviewer.email,
        ReviewNotes: cleanNotes,
        ReviewedAt: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (updateErr) {
      console.error("[ob-review] update error:", updateErr);
      return res.status(500).json({ error: "Could not save the review." });
    }

    /* ── Notify the agent (best effort) ────────────────────────────────────
       The review is already committed at this point. A bell or mail failure
       must never turn a successful approval into a failed request, so every
       error here is logged and swallowed. The two channels are tracked
       separately because they fail independently — a dead SMTP provider should
       not be reported as "the agent was never told". */
    let notified = false;
    let emailNotified = false;

    // In-app bell first: it cannot fail for external reasons.
    try {
      const { onObReviewed } = await import("@/lib/notifications");
      await onObReviewed({
        id: current.id,
        ReferenceID: current.ReferenceID,
        Name: current.Name,
        Destination: current.Destination,
        Status: target,
        ReviewNotes: cleanNotes,
        ReviewedBy: reviewer.email,
      });
      notified = true;
    } catch (err) {
      console.warn("[ob-review] bell insert threw:", err);
    }

    try {
      // Email is resolved from the users table by ReferenceID rather than stored
      // on the OB row: a stale or spoofed address would send an approval notice
      // to the wrong person.
      const { data: agent } = await supabase
        .from("users")
        .select("Email")
        .eq("ReferenceID", current.ReferenceID)
        .maybeSingle();

      if (agent?.Email) {
        const { loadEmailConfig, resolveApiKey, toSafeConfig } = await import("@/lib/email-config");
        const config = await loadEmailConfig(current.company_id);
        const safe = toSafeConfig(config);
        const apiKey = await resolveApiKey(current.company_id);

        const { sendObReviewEmail } = await import("@/lib/emails");
        const sent = await sendObReviewEmail(
          agent.Email,
          obReviewOutcome(target),
          cleanNotes,
          {
            destination: current.Destination,
            dateOfOb: current.DateOfOB,
            isLateFiling: Boolean(current.IsLateFiling),
          },
          { apiKey, senderEmail: safe.sender_email, senderName: safe.sender_name }
        );
        emailNotified = sent.ok;
        if (!sent.ok) console.warn("[ob-review] email failed:", sent.error);
      } else {
        console.warn("[ob-review] no email found for ReferenceID", current.ReferenceID);
      }
    } catch (err) {
      console.warn("[ob-review] email threw:", err);
    }

    return res.status(200).json({
      success: true,
      message: `OB request ${target}.`,
      requestId,
      status: target,
      reviewedBy: reviewer.email,
      notified,
      emailNotified,
    });
  } catch (error) {
    console.error("[ob-review] error:", error);
    return res.status(500).json({ error: "Failed to update the OB request. Please try again." });
  }
}