import nodemailer from "nodemailer";

/* ============================================================================
   Transactional mail for the admin console.
   ----------------------------------------------------------------------------
   Shares the Resend SMTP transport with lib/password-reset.ts. Kept separate so
   the password-reset module stays about credentials, and so a future change to
   one doesn't silently alter the other.

   Both modules fall back to `onboarding@resend.dev` when RESEND_FROM is unset,
   which Resend only delivers to the account owner — see the diagnostics in
   password-reset.ts if mail silently stops arriving.
   ========================================================================== */

type Result = { ok: true } | { ok: false; error: string };

/**
 * Resend SMTP transport.
 *
 * `apiKey` lets a per-company override (public.email_config) win over the
 * install-wide env var — see lib/email-config.ts. Omit it and the existing
 * RESEND_API_KEY is used, which is every pre-existing call site.
 */
function transporter(apiKey?: string | null) {
  const key = (apiKey || process.env.RESEND_API_KEY || "").trim();
  if (!key) return null;
  return nodemailer.createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: { user: "resend", pass: key },
  });
}

/** "Display Name <addr@example.com>" — the display name is optional. */
function formatFrom(senderName?: string | null, senderEmail?: string | null): string {
  const addr = (senderEmail || process.env.RESEND_FROM || "").trim();
  const name = (senderName || "").trim();
  if (!addr) return "Biolog <onboarding@resend.dev>";
  if (addr.includes("<")) return addr; // already a full address spec
  if (!name) return `Biolog <${addr}>`;
  return `${name.replace(/[<>,]/g, "")} <${addr}>`;
}

/* ── Delivery with bounded retry ────────────────────────────────────────────
   Resend occasionally rejects a first attempt while a domain or reputation
   check settles, so one transient failure shouldn't cost the notification.
   Three attempts, exponential backoff, ~750ms worst case.

   This is IN-REQUEST retry on purpose. A serverless function cannot hold a timer
   for a deferred retry, and a "pending" row with no worker would never be picked
   up — the alternative is a real queue or cron, a bigger change than this
   feature warrants. Persisting EmailStatus / EmailRetries on the OB row is what
   keeps a later retry job (or a manual re-send) possible. */

export type SendOptions = {
  apiKey?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  retries?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function deliver(
  t: ReturnType<typeof transporter>,
  opts: { to: string; subject: string; html: string; from?: string },
  retries = 2
): Promise<Result> {
  if (!t) return { ok: false, error: "RESEND_API_KEY is not configured" };

  let lastError = "Unknown error";
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await t.sendMail(opts);
      return { ok: true };
    } catch (err: any) {
      lastError = err?.message || "Failed to send email";
      // A 4xx that isn't 429 means the request itself is wrong — retrying just
      // burns quota, so only transient failures get another go.
      const status = err?.statusCode ?? err?.responseCode;
      const transient = !status || status >= 500 || status === 429;
      if (attempt === retries || !transient) break;
      await sleep(250 * 2 ** attempt);
    }
  }
  return { ok: false, error: lastError };
}

/** Mint headers shared by every admin email. */
function shell(title: string, body: string) {
  return `
  <div style="font-family:Nunito,system-ui,-apple-system,sans-serif;background:#F7FCF9;padding:24px">
    <div style="max-width:440px;margin:0 auto;background:#fff;border:1px solid #E2ECE8;border-radius:18px;overflow:hidden">
      <div style="background:linear-gradient(180deg,#E8F6EF,#F7FCF9);padding:20px 24px;text-align:center">
        <div style="font-weight:900;letter-spacing:.12em;color:#096B4C;font-size:15px">BIOLOG</div>
        <div style="margin-top:2px;font-size:11px;font-weight:700;letter-spacing:.1em;color:#64748B">ADMIN CONSOLE</div>
      </div>
      <div style="padding:24px">
        <h1 style="margin:0 0 10px;font-size:19px;font-weight:900;color:#0F172A">${title}</h1>
        ${body}
      </div>
    </div>
  </div>`;
}

/** Tell the submitter their GPS report was approved or declined. */
export async function sendGpsReviewEmail(
  to: string,
  status: "approved" | "declined",
  notes: string,
  opts: SendOptions & { supervisor?: string | null } = {}
): Promise<Result> {
  const t = transporter(opts.apiKey);
  if (!t) return { ok: false, error: "RESEND_API_KEY is not configured" };

  const approved = status === "approved";
  const accent = approved ? "#0D9669" : "#DC2626";
  const tint = approved ? "#E6F4EE" : "#FDE8E8";
  const heading = approved ? "GPS report approved" : "GPS report declined";

  const html = shell(
    heading,
    `
    <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#64748B;line-height:1.6">
      An administrator has reviewed the GPS report you submitted.
    </p>
    <div style="border-radius:14px;padding:12px 14px;margin-bottom:16px;background:${tint};color:${accent};font-size:13px;font-weight:800">
      ${heading}
    </div>
    ${
      notes
        ? `<p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#64748B">Reviewer notes</p>
           <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#0F172A;line-height:1.6;background:#F7FCF9;border:1px solid #E2ECE8;border-radius:14px;padding:12px 14px">${escapeHtml(notes)}</p>`
        : `<p style="margin:0 0 16px;font-size:12.5px;font-weight:600;color:#64748B">No notes were left.</p>`
    }
    <p style="margin:0;font-size:12px;font-weight:600;color:#64748B;line-height:1.5">
      Open the Biolog app to see the full report and its status.
    </p>`
  );

  // Supervisors configured in Email Config get a blind copy, so an audit trail
  // exists outside the app. Best effort: a bad address must not cost the agent
  // their own notification.
  const supervisor = (opts.supervisor || "").trim();
  if (supervisor) {
    try {
      const copy = await deliver(
        t,
        {
          to: supervisor,
          subject: `[Copy] ${heading} — Biolog`,
          html,
        },
        1
      );
      if (!copy.ok) console.warn("[emails] gps supervisor copy failed:", copy.error);
    } catch (err) {
      console.warn("[emails] gps supervisor copy threw:", err);
    }
  }

  return deliver(
    t,
    {
      to,
      subject: `${heading} — Biolog`,
      html,
    },
    opts.retries
  );
}

/** Deliver a temporary password set by an administrator. */
export async function sendTemporaryPasswordEmail(
  to: string,
  tempPassword: string,
  forceChange: boolean,
  opts: SendOptions = {}
): Promise<Result> {
  const t = transporter(opts.apiKey);
  if (!t) return { ok: false, error: "RESEND_API_KEY is not configured" };

  const html = shell(
    "Your temporary password",
    `
    <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#64748B;line-height:1.6">
      An administrator reset your Biolog password. Sign in with the password below,
      then change it straight away.
    </p>
    <div style="font-size:22px;font-weight:900;letter-spacing:2px;text-align:center;color:#0D9669;
                background:#E6F4EE;border-radius:16px;padding:16px 10px;margin-bottom:16px;
                font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(tempPassword)}</div>
    ${
      forceChange
        ? `<div style="background:#FEF3C7;border-radius:14px;padding:12px 14px;margin-bottom:16px">
             <p style="margin:0;font-size:12px;font-weight:700;color:#92400E;line-height:1.5">
               You will be asked to choose a new password when you sign in.
             </p>
           </div>`
        : ""
    }
    <p style="margin:0;font-size:12px;font-weight:600;color:#64748B;line-height:1.5">
      If you did not expect this, contact your administrator immediately.
    </p>`
  );

  return deliver(
    t,
    {
      to,
      from: formatFrom(),
      subject: "Your temporary Biolog password",
      html,
    },
    opts.retries
  );
}

/** Reviewer notes come from an admin textarea, so escape before inserting. */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── Official Business Trip (ROBT) ─────────────────────────────────────── */

export type ObEmailStatus = "approved" | "declined";

const OB_STATUS_EMAIL: Record<ObEmailStatus, { heading: string; accent: string; tint: string; blurb: string }> = {
  approved: {
    heading: "OB request approved",
    accent: "#0D9669",
    tint: "#E6F4EE",
    blurb: "Your Official Business Trip request has been approved and received by HRAD.",
  },
  declined: {
    heading: "OB request declined",
    accent: "#DC2626",
    tint: "#FDE8E8",
    blurb: "Your Official Business Trip request was not approved. Please read the reviewer's reason below.",
  },
};

/**
 * Tell the agent their OB request was approved or declined.
 *
 * `detail` carries the trip facts the agent needs to recognise the request
 * without opening the app (destination + date of OB). Every value is escaped —
 * `Justification` and `ReviewNotes` are free text typed by two different people
 * on either side of this call.
 */
export async function sendObReviewEmail(
  to: string,
  status: ObEmailStatus,
  notes: string,
  detail?: { destination?: string | null; dateOfOb?: string | null; isLateFiling?: boolean },
  opts: SendOptions = {}
): Promise<Result> {
  const t = transporter(opts.apiKey);
  if (!t) return { ok: false, error: "RESEND_API_KEY is not configured" };

  const s = OB_STATUS_EMAIL[status];

  const html = shell(
    s.heading,
    `
    <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#64748B;line-height:1.6">
      ${s.blurb}
    </p>

    ${
      detail && (detail.destination || detail.dateOfOb)
        ? `<div style="border-radius:14px;padding:12px 14px;margin-bottom:16px;background:#F7FCF9;border:1px solid #E2ECE8">
             <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#64748B">Request for Official Business Trip</p>
             <p style="margin:0;font-size:13px;font-weight:800;color:#0F172A;line-height:1.5">
               ${escapeHtml(detail.destination || "Destination not specified")}
             </p>
             <p style="margin:2px 0 0;font-size:12px;font-weight:600;color:#64748B;line-height:1.5">
               Date of OB: ${escapeHtml(detail.dateOfOb || "—")}
             </p>
           </div>`
        : ""
    }

    <div style="border-radius:14px;padding:12px 14px;margin-bottom:16px;background:${s.tint};color:${s.accent};font-size:13px;font-weight:800">
      ${s.heading}
    </div>

    ${
      detail?.isLateFiling
        ? `<div style="background:#FEF3C7;border-radius:14px;padding:12px 14px;margin-bottom:16px">
             <p style="margin:0;font-size:12px;font-weight:700;color:#92400E;line-height:1.5">
               Filed with less than one (1) day of notice — guideline 1 of the ROBT form.
             </p>
           </div>`
        : ""
    }

    ${
      notes
        ? `<p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#64748B">Reviewer notes</p>
           <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#0F172A;line-height:1.6;background:#F7FCF9;border:1px solid #E2ECE8;border-radius:14px;padding:12px 14px">${escapeHtml(notes)}</p>`
        : `<p style="margin:0 0 16px;font-size:12.5px;font-weight:600;color:#64748B">No notes were left.</p>`
    }
    <p style="margin:0;font-size:12px;font-weight:600;color:#64748B;line-height:1.5">
      Open the Biolog app → OB Request → My OB Requests to see the signed form and its full status.
    </p>`
  );

  return deliver(
    t,
    {
      to,
      from: formatFrom(opts.senderName, opts.senderEmail),
      subject: `${s.heading} — Biolog`,
      html,
    },
    opts.retries
  );
}

/* ── New OB request → HRAD ──────────────────────────────────────────────── */

export type ObSubmittedEmail = {
  Name: string;
  Position?: string | null;
  Department?: string | null;
  Destination?: string | null;
  DateOfOB?: string | null;
  Purpose?: string | null;
  ReferenceID?: string | null;
  IsLateFiling?: boolean;
  Justification?: string | null;
  /**
   * Intro line from the company's body template, already rendered. Optional —
   * when absent the mail falls back to a generic sentence.
   */
  intro?: string | null;
  /** Image URLs of the signed form, in upload order. */
  photos: string[];
  reviewUrl: string;
};

/**
 * Tell HRAD a new OB request is waiting.
 *
 * `subject` is already rendered by the caller from the company's template so
 * the admin's wording is honoured verbatim.
 *
 * Every value is escaped: Purpose, Justification and Destination are typed by
 * the agent, and the photo URLs come from the request body.
 */
export async function sendObSubmittedEmail(
  to: string[],
  data: ObSubmittedEmail,
  subject: string,
  opts: SendOptions = {}
): Promise<Result> {
  const t = transporter(opts.apiKey);
  if (!t) return { ok: false, error: "RESEND_API_KEY is not configured" };
  if (!to.length) return { ok: false, error: "No recipients configured" };

  const photos = data.photos.filter((p) => /^https?:\/\//i.test(p));

  const rows: Array<[string, string]> = [
    ["Name", data.Name],
    ["Position", data.Position || ""],
    ["Department", data.Department || ""],
    ["Destination", data.Destination || "Not stated"],
    ["Date of OB", data.DateOfOB || "Not stated"],
    ["Purpose", data.Purpose || "Not stated"],
  ];

  const html = shell(
    "New OB request for approval",
    `
    <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#64748B;line-height:1.6">
      ${escapeHtml(data.Name)}${data.Department ? ` (${escapeHtml(data.Department)})` : ""} submitted
      a Request for Official Business Trip. It is waiting for your decision in Biolog.
    </p>

    ${
      data.intro?.trim()
        ? `<p style="margin:-6px 0 16px;font-size:12.5px;font-weight:600;color:#0F172A;line-height:1.6">${escapeHtml(data.intro.trim())}</p>`
        : ""
    }

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border-collapse:collapse;margin-bottom:16px">
      ${rows
        .map(
          ([k, v]) => `<tr>
            <td style="padding:7px 0;font-size:11px;font-weight:800;letter-spacing:.08em;
                       text-transform:uppercase;color:#64748B;white-space:nowrap;vertical-align:top">${k}</td>
            <td style="padding:7px 0;font-size:13px;font-weight:700;color:#0F172A;line-height:1.5">${escapeHtml(v)}</td>
          </tr>`
        )
        .join("")}
    </table>

    ${
      data.IsLateFiling
        ? `<div style="background:#FEF3C7;border-radius:14px;padding:12px 14px;margin-bottom:16px">
             <p style="margin:0 0 4px;font-size:12px;font-weight:800;color:#92400E;line-height:1.5">
               Late filing — less than one (1) day of notice.
             </p>
             ${
               data.Justification
                 ? `<p style="margin:0;font-size:12.5px;font-weight:600;color:#0F172A;line-height:1.6">${escapeHtml(data.Justification)}</p>`
                 : ""
             }
           </div>`
        : ""
    }

    ${
      photos.length
        ? `<p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#64748B">
             Signed form${photos.length > 1 ? ` (${photos.length} images)` : ""}
           </p>
           <p style="margin:0 0 16px;font-size:12.5px;font-weight:600;color:#0F172A;line-height:1.7">
             ${photos
               .map(
                 (p, i) =>
                   `<a href="${escapeHtml(p)}" style="display:inline-block;margin:0 8px 8px 0;padding:7px 12px;border-radius:10px;background:#E6F4EE;color:#096B4C;font-size:12px;font-weight:800;text-decoration:none">View image ${i + 1}</a>`
               )
               .join("")}
           </p>`
        : ""
    }

    <a href="${escapeHtml(data.reviewUrl)}"
       style="display:inline-block;background:#0B7F5A;color:#fff;text-decoration:none;
              font-size:13.5px;font-weight:800;padding:12px 20px;border-radius:14px">
       Review in Biolog Admin
    </a>`
  );

  return deliver(
    t,
    {
      to: to.join(", "),
      from: formatFrom(opts.senderName, opts.senderEmail),
      subject,
      html,
    },
    opts.retries
  );
}