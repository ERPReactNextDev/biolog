import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard, hasPermission } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  DEFAULT_HRAD_RECIPIENTS,
  loadEmailConfig,
  parseRecipients,
  renderObTemplate,
  resolveApiKey,
  saveEmailConfig,
  toSafeConfig,
} from "@/lib/email-config";

/* ============================================================================
   /api/admin/email-config

   GET  → masked config (never the plaintext key)
   POST → { action: "save" | "test" }

   Guarded by `can_manage_settings`. The API key is write-only from the UI: GET
   returns a mask and a boolean, and a POST that echoes the mask back is treated
   as "unchanged" rather than overwriting the stored key with asterisks.
   ========================================================================== */

/** The company whose config this session manages. */
async function companyIdFor(userId: number | string): Promise<number | string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  return (data?.company_id as number | string | null) ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  if (!supabase) {
    return res.status(500).json({ error: "Database is not configured." });
  }

  // Saving an API key or firing test mail is a privileged action; 20/min is
  // plenty for a human and stops the test button being used as a mail cannon.
  if (!checkRateLimit(req, res, { limit: 20, windowMs: 60_000, scope: "email-config" })) return;

  const admin = await guard(req, res, "can_manage_settings");
  if (!admin) return;

  const companyId = await companyIdFor(admin.id);

  /* ── GET ────────────────────────────────────────────────────────────────── */
  if (req.method === "GET") {
    // `toSafeConfig` is a hand-built projection rather than a spread of the row
    // with the key deleted — a future column added to email_config then cannot
    // accidentally be serialised to the browser by default.
    return res.status(200).json({
      ...toSafeConfig(await loadEmailConfig(companyId)),
      companyId,
      canManageSettings: hasPermission(admin, "can_manage_settings"),
    });
  }

  /* ── POST ───────────────────────────────────────────────────────────────── */

  const body = (req.body || {}) as Record<string, unknown>;
  const action = String(body.action || "save");

  if (action === "test") {
    return sendTestEmail(res, companyId, body);
  }

  // Validation before save: an admin who cannot receive the mail should find out
  // at save time, not when an agent's OB request silently fails to notify.
  // Validate the addresses before anything else, so a typo is reported against
  // the field that caused it rather than as a generic save failure.
  const obRecipients = parseRecipients(body.ob_recipients as string);
  if (obRecipients.length === 0) {
    return res.status(400).json({
      error: "Add at least one valid HRAD email address before saving.",
      field: "ob_recipients",
    });
  }

  // Auto-send is a promise to email HRAD on every submit, so refuse to enable it
  // without a working key — otherwise the queue fills with silent failures.
  if (body.auto_send_on_ob === true) {
    const apiKey = await resolveApiKey(companyId);
    if (!apiKey) {
      return res.status(400).json({
        error:
          "Turn off auto-send, or configure a Resend API key first — reviewers would not be emailed.",
        field: "auto_send_on_ob",
      });
    }
  }

  const result = await saveEmailConfig({
    companyId,
    resendApiKey: body.resendApiKey as string | undefined,
    sender_email: body.sender_email as string,
    sender_name: body.sender_name as string,
    ob_recipients: obRecipients,
    gps_recipients: body.gps_recipients as string,
    timesheet_recipients: body.timesheet_recipients as string,
    ob_subject_template: body.ob_subject_template as string,
    ob_body_template: body.ob_body_template as string,
    auto_send_on_ob: body.auto_send_on_ob === true,
    is_active: body.is_active === undefined ? true : body.is_active === true,
  });

  if (!result.ok) {
    return res.status(result.status).json({
      error: result.error,
      // Supabase errors carry a code like 42501 (permission) or 42P10 (bad
      // conflict target). Surfacing it turns "could not save" into something
      // an admin can act on — e.g. a missing policy.
      code: (result as { code?: string }).code,
    });
  }

  return res.status(200).json({
    ok: true,
    message: "Email configuration saved.",
    config: toSafeConfig(result.config),
  });
}

/* ── Send Test Email ────────────────────────────────────────────────────────
   Sends to the addresses currently in the form (not the saved ones) so an
   admin can verify a freshly typed address before committing to it. */

const TEST_VARS = {
  Name: "Juan Dela Cruz",
  Position: "Territory Sales Associate",
  Department: "Sales",
  Destination: "Cebu City, Cebu",
  DateOfOB: "2026-10-06",
  Purpose: "Client onboarding and system training.",
  ReferenceID: "TSA-0000",
};

async function sendTestEmail(
  res: NextApiResponse,
  companyId: number | string | null,
  body: Record<string, unknown>
) {
  // Default to the form's addresses, else the saved/default HRAD list.
  const recipients = parseRecipients(body.ob_recipients as string);
  if (recipients.length === 0) {
    const saved = toSafeConfig(await loadEmailConfig(companyId));
    recipients.push(...(saved.ob_recipients.length ? saved.ob_recipients : DEFAULT_HRAD_RECIPIENTS));
  }
  if (recipients.length === 0) {
    return res.status(400).json({ error: "No recipients to send the test to." });
  }

  const apiKey = await resolveApiKey(companyId);
  if (!apiKey) {
    return res.status(400).json({
      error: "No Resend API key configured. Paste one in the field above, or set RESEND_API_KEY on the server.",
    });
  }

  const saved = toSafeConfig(await loadEmailConfig(companyId));
  const subjectTemplate = (body.ob_subject_template as string) || saved.ob_subject_template;

  // The body template only supplies the sentence under the subject; the rest of
  // the mail (detail table, image links, review button) is structural and is not
  // templated. It is passed through the intro slot so a custom intro is honoured
  // in the test exactly as it will be on a real OB.
  const introLine = (body.ob_body_template as string) || saved.ob_body_template;

  const { sendObSubmittedEmail } = await import("@/lib/emails");

  const sent = await sendObSubmittedEmail(
    recipients,
    {
      ...TEST_VARS,
      intro: renderObTemplate(introLine, TEST_VARS),
      IsLateFiling: true,
      Justification: "This is a test message from the Biolog Email Config screen.",
      photos: [],
      reviewUrl: `${(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")}/admin/ob-approvals`,
    },
    `[TEST] ${renderObTemplate(subjectTemplate, TEST_VARS)}`,
    {
      apiKey,
      senderEmail: (body.sender_email as string) || saved.sender_email,
      senderName: (body.sender_name as string) || saved.sender_name,
      retries: 1,
    }
  );

  if (!sent.ok) {
    return res.status(502).json({
      error: `Test email failed: ${sent.error}`,
      recipients,
    });
  }

  return res.status(200).json({
    ok: true,
    message: `Test email sent to ${recipients.join(", ")}.`,
    recipients,
  });
}