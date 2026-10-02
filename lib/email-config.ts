/* ============================================================================
   Email configuration — per-company outbound mail settings
   ----------------------------------------------------------------------------
   Resolution order for the Resend key, highest first:

     1. public.email_config.resend_api_key_enc   (per-company override)
     2. process.env.RESEND_API_KEY               (the existing install-wide key)

   The env var is the fallback on purpose. This app already ships with a working
   Resend setup (lib/emails.ts used it before this module existed), so a fresh
   install must be able to send mail without anyone visiting Email Config first.
   Saving a key in the UI is an override for multi-tenant companies that each
   bring their own Resend account — not a requirement.

   Same for the sender: config.sender_email → RESEND_FROM → onboarding@resend.dev.
   ========================================================================== */

import { supabase } from "./supabase";
import { AAD_EMAIL_KEY, canEncrypt, maskKey, open, seal } from "./secret-box";

export type EmailConfig = {
  id: number | string;
  company_id: number | string | null;
  resend_api_key_enc: string | null;
  sender_email: string | null;
  sender_name: string | null;
  ob_recipients: string[];
  gps_recipients: string[];
  timesheet_recipients: string[];
  ob_subject_template: string | null;
  ob_body_template: string | null;
  auto_send_on_ob: boolean;
  is_active: boolean;
  updated_at: string | null;
};

/** What the UI sees. The plaintext key is deliberately absent. */
export type SafeEmailConfig = {
  hasApiKey: boolean;
  maskedApiKey: string | null;
  /** False when no master secret is configured, so the key field is disabled. */
  canStoreKey: boolean;
  sender_email: string;
  sender_name: string;
  ob_recipients: string[];
  gps_recipients: string[];
  timesheet_recipients: string[];
  ob_subject_template: string;
  ob_body_template: string;
  auto_send_on_ob: boolean;
  is_active: boolean;
  updated_at: string | null;
  /** True when the env key is what will actually be used. */
  usingEnvKey: boolean;
  envSenderEmail: string | null;
};

export const DEFAULT_OB_SUBJECT = "New OB Request — {Name} — {Destination}";
export const DEFAULT_OB_BODY =
  "A new Request for Official Business Trip was submitted and is waiting for your approval.";

export const DEFAULT_HRAD_RECIPIENTS = ["hrad@ecoshift.com"];

/* ── Recipient parsing ────────────────────────────────────────────────────
   Accepts a comma or semicolon separated string, trims, drops blanks and
   de-duplicates case-insensitively. Anything that is not a plausible address is
   dropped rather than passed to the transport, because a typo like
   "hrad@ecoshift.com hradmin" would otherwise reach SMTP as a malformed RCPT
   and fail the whole send. */

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

export function parseRecipients(input: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(input)
    ? input
    : String(input || "")
        .split(/[,;\n]/)
        .map((s) => s.trim());

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const v = String(r || "").trim();
    if (!v || !EMAIL_RE.test(v)) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** jsonb columns round-trip as arrays, but hand-edited rows can be anything. */
function toStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
    } catch {
      /* treat as a plain comma list */
    }
    return parseRecipients(raw);
  }
  return [];
}

/* ── Loading ────────────────────────────────────────────────────────────────
   Falls back to the company row, then to the NULL "default install" row. This
   two-step lookup is what lets an un-backfilled single-tenant install work: its
   company_id is NULL on users, so the default row is the only match. */

/**
 * Select the one config row for a company, including the NULL "default
 * install" row.
 *
 * `.eq("company_id", null)` does NOT mean IS NULL here. PostgREST serialises the
 * JS null as the literal string "null", and Postgres rejects it with 22P02
 * "invalid input syntax for type bigint". The correct forms are `.is(..., null)`
 * or `.is(..., undefined)`, both of which emit `IS NULL`.
 *
 * This is the shape that fails for every un-backfilled single-tenant install,
 * because company_id is NULL on their users row.
 */
function selectForCompany(companyId: number | string | null) {
  const q = supabase!.from("email_config").select("*");
  return companyId === null || companyId === undefined
    ? q.is("company_id", null)
    : q.eq("company_id", companyId);
}

export async function loadEmailConfig(companyId: number | string | null): Promise<EmailConfig | null> {
  if (!supabase) return null;

  const { data, error } = await selectForCompany(companyId).maybeSingle();

  if (error) {
    console.error("[email-config] load error:", error);
    return null;
  }
  return (data as EmailConfig | null) ?? null;
}

/** Masked projection for the client. Never includes the plaintext key. */
export function toSafeConfig(config: EmailConfig | null): SafeEmailConfig {
  const envKey = process.env.RESEND_API_KEY?.trim() || "";
  const plaintext = config?.resend_api_key_enc ? open(config.resend_api_key_enc, AAD_EMAIL_KEY) : null;

  const obRecipients = toStringArray(config?.ob_recipients);

  return {
    hasApiKey: Boolean(plaintext) || Boolean(envKey),
    maskedApiKey: plaintext ? maskKey(plaintext) : null,
    canStoreKey: canEncrypt(),
    sender_email: config?.sender_email || process.env.RESEND_FROM || "",
    sender_name: config?.sender_name || "BIOLOG Notifications",
    ob_recipients: obRecipients.length ? obRecipients : DEFAULT_HRAD_RECIPIENTS,
    gps_recipients: toStringArray(config?.gps_recipients),
    timesheet_recipients: toStringArray(config?.timesheet_recipients),
    ob_subject_template: config?.ob_subject_template || DEFAULT_OB_SUBJECT,
    ob_body_template: config?.ob_body_template || DEFAULT_OB_BODY,
    auto_send_on_ob: Boolean(config?.auto_send_on_ob),
    is_active: config ? config.is_active !== false : true,
    updated_at: config?.updated_at ?? null,
    usingEnvKey: !plaintext && Boolean(envKey),
    envSenderEmail: process.env.RESEND_FROM || null,
  };
}

/** The transport key for a company, or null when nothing is configured. */
export async function resolveApiKey(companyId: number | string | null): Promise<string | null> {
  const config = await loadEmailConfig(companyId);
  if (config?.resend_api_key_enc) {
    const plaintext = open(config.resend_api_key_enc, AAD_EMAIL_KEY);
    if (plaintext) return plaintext;
    // Present but undecryptable (rotated master secret, tampered row). Fall
    // through to the env key rather than failing every send — but say so.
    console.warn(
      "[email-config] stored Resend key could not be decrypted; falling back to RESEND_API_KEY."
    );
  }
  return process.env.RESEND_API_KEY?.trim() || null;
}

/* ── Saving ───────────────────────────────────────────────────────────────── */

export type SaveEmailConfigInput = {
  companyId: number | string | null;
  /** Omit to leave the stored key untouched; pass "" to clear it. */
  resendApiKey?: string;
  sender_email?: string;
  sender_name?: string;
  ob_recipients?: string | string[];
  gps_recipients?: string | string[];
  timesheet_recipients?: string | string[];
  ob_subject_template?: string;
  ob_body_template?: string;
  auto_send_on_ob?: boolean;
  is_active?: boolean;
};

export type SaveResult =
  | { ok: true; config: EmailConfig }
  | { ok: false; status: number; error: string; code?: string };

export async function saveEmailConfig(input: SaveEmailConfigInput): Promise<SaveResult> {
  if (!supabase) return { ok: false, status: 500, error: "Database is not configured." };

  const {
    companyId,
    resendApiKey,
    sender_email,
    sender_name,
    ob_recipients,
    gps_recipients,
    timesheet_recipients,
    ob_subject_template,
    ob_body_template,
    auto_send_on_ob,
    is_active,
  } = input;

  const row: Record<string, unknown> = {
    company_id: companyId ?? null,
    sender_email: (sender_email || "").trim() || null,
    sender_name: (sender_name || "").trim() || null,
    ob_recipients: parseRecipients(ob_recipients),
    gps_recipients: parseRecipients(gps_recipients),
    timesheet_recipients: parseRecipients(timesheet_recipients),
    ob_subject_template: (ob_subject_template || "").trim() || DEFAULT_OB_SUBJECT,
    ob_body_template: (ob_body_template || "").trim() || DEFAULT_OB_BODY,
    auto_send_on_ob: Boolean(auto_send_on_ob),
    is_active: is_active === undefined ? true : Boolean(is_active),
    updated_at: new Date().toISOString(),
  };

  // Write-only key handling. An untouched field must NOT clear the stored key,
  // or every save that omits the masked field would wipe the credential.
  if (resendApiKey !== undefined) {
    const provided = String(resendApiKey).trim();
    if (provided === "") {
      row.resend_api_key_enc = null; // explicit clear
    } else if (/^•+/.test(provided)) {
      // The masked value was echoed back by the UI — treat as "unchanged".
    } else if (!canEncrypt()) {
      return {
        ok: false,
        status: 503,
        error:
          "Cannot store an API key: EMAIL_CONFIG_SECRET (or IT_MASTER_PASSWORD) is not set on the server, so there is no way to encrypt it.",
      };
    } else {
      const sealed = seal(provided, AAD_EMAIL_KEY);
      if (!sealed) {
        return { ok: false, status: 500, error: "Could not encrypt the API key." };
      }
      row.resend_api_key_enc = sealed;
    }
  }

  /* ── Read-then-write, NOT upsert ─────────────────────────────────────────
     The table's uniqueness is enforced by TWO PARTIAL unique indexes (one for
     company_id IS NOT NULL, one for the NULL "default install" row). Postgres
     will only use a partial index for ON CONFLICT if the WHERE predicate is
     restated in the conflict target, which PostgREST's `onConflict` option
     cannot express. So `upsert(..., { onConflict: "company_id" })` fails with
     42P10 "there is no unique or exclusion constraint matching the ON CONFLICT
     specification" on every save.

     Selecting first and then inserting or updating by primary key sidesteps the
     conflict target entirely and works with either index shape. */

  const existing = await selectForCompany(companyId)
    .select("id")
    .maybeSingle();

  if (existing.error) {
    console.error("[email-config] lookup error:", existing.error);
    return { ok: false, status: 500, error: "Could not read the current email configuration." };
  }

  let saved: EmailConfig | null = null;

  if (existing.data?.id) {
    const upd = await supabase
      .from("email_config")
      .update(row)
      .eq("id", existing.data.id)
      .select("*")
      .single();

    if (upd.error) {
      console.error("[email-config] update error:", upd.error);
      return {
        ok: false,
        status: 500,
        error: upd.error.message || "Could not save the email configuration.",
        code: upd.error.code,
      };
    }
    saved = upd.data as EmailConfig;
  } else {
    const ins = await supabase
      .from("email_config")
      // created_at is only set on first insert; the DB default covers it too.
      .insert({ ...row, created_at: new Date().toISOString() })
      .select("*")
      .single();

    if (ins.error) {
      console.error("[email-config] insert error:", ins.error);
      return {
        ok: false,
        status: 500,
        error: ins.error.message || "Could not save the email configuration.",
        code: ins.error.code,
      };
    }
    saved = ins.data as EmailConfig;
  }

  return { ok: true, config: saved };
}

/* ── Template rendering ──────────────────────────────────────────────────────
   Placeholders are {Name}, {Position}, {Department}, {Destination}, {DateOfOB},
   {Purpose}, {ReferenceID}. Unknown tokens are left visible rather than blanked
   so a typo in the template is obvious in the preview instead of silently
   producing an email with a hole in it. */

export type ObTemplateVars = {
  Name?: string | null;
  Position?: string | null;
  Department?: string | null;
  Destination?: string | null;
  DateOfOB?: string | null;
  Purpose?: string | null;
  ReferenceID?: string | null;
};

export function renderObTemplate(template: string, vars: ObTemplateVars): string {
  return String(template || "").replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = (vars as Record<string, unknown>)[key];
    return v === undefined || v === null || v === "" ? whole : String(v);
  });
}

export const OB_TEMPLATE_TOKENS = [
  "Name",
  "Position",
  "Department",
  "Destination",
  "DateOfOB",
  "Purpose",
  "ReferenceID",
] as const;