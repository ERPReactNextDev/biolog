"use client";

/* ============================================================================
   ADMIN · Email Configuration
   ----------------------------------------------------------------------------
   Card-based form for public.email_config. Sections follow the spec:
     A. Email service  — Resend key, sender email/name
     B. Recipients     — per request type
     C. Template       — subject + body with live preview
     D. Actions        — Save + Send Test Email

   THE KEY IS WRITE-ONLY
   GET returns `maskedApiKey` + `hasApiKey`, never the plaintext. The field
   pre-fills with the mask and is saved back unchanged unless the admin types
   over it — the API treats a value that still looks like the mask as "leave it
   alone", so visiting this page can never overwrite a working key with
   asterisks.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Mail,
  Save,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button, Card } from "@/app/activity-planner/mint/ui";
import { LoadingSkeleton, ErrorOverlay } from "@/app/activity-planner/mint/states";

type SafeConfig = {
  hasApiKey: boolean;
  maskedApiKey: string | null;
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
  usingEnvKey: boolean;
  envSenderEmail: string | null;
};

const PREVIEW_VARS: Record<string, string> = {
  Name: "Juan Dela Cruz",
  Position: "Territory Sales Associate",
  Department: "Sales",
  Destination: "Cebu City, Cebu",
  DateOfOB: "Oct 6, 2026",
  Purpose: "Client onboarding and system training.",
  ReferenceID: "TSA-0142",
};

const TOKENS = Object.keys(PREVIEW_VARS);

/** Unknown tokens are left visible so a typo shows up in the preview. */
function renderPreview(template: string) {
  return String(template || "").replace(/\{(\w+)\}/g, (whole, key: string) =>
    PREVIEW_VARS[key] === undefined ? whole : PREVIEW_VARS[key]
  );
}

/* ── Field kit ───────────────────────────────────────────────────────────── */

const INPUT =
  "w-full min-h-[48px] px-4 rounded-[var(--r-btn)] border border-[var(--border-strong)] bg-[var(--card)] text-[13.5px] font-semibold text-[var(--text)] placeholder:text-[var(--text-faint)] outline-none transition-colors focus:border-[var(--mint)] disabled:opacity-50";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] font-semibold text-[var(--text-faint)] mt-1.5 leading-snug">
          {hint}
        </p>
      )}
    </div>
  );
}

function SectionCard({
  icon,
  iconBg,
  iconFg,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconFg: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5 mb-4">
      <div className="flex items-start gap-3.5 mb-4">
        <div
          className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
          style={{ background: iconBg, color: iconFg }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold text-[var(--text)] leading-tight">{title}</p>
          <p className="text-[12px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
            {subtitle}
          </p>
        </div>
      </div>
      {children}
    </Card>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className="w-[52px] h-[30px] rounded-full p-[3px] flex items-center transition-colors shrink-0"
      style={{ background: checked ? "var(--mint-btn)" : "var(--border-strong)" }}
    >
      <span
        className="w-6 h-6 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? "translateX(22px)" : "translateX(0)" }}
      />
    </button>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function EmailConfigPage() {
  const [config, setConfig] = useState<SafeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("");
  const [obRecipients, setObRecipients] = useState("");
  const [gpsRecipients, setGpsRecipients] = useState("");
  const [timesheetRecipients, setTimesheetRecipients] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [autoSend, setAutoSend] = useState(false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setForbidden(false);
    try {
      const res = await fetch("/api/admin/email-config", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Could not load the email configuration.");
        return;
      }
      setConfig(json);
      // Seed the form from what the server actually holds.
      setApiKey(json.maskedApiKey || "");
      setSenderEmail(json.sender_email || "");
      setSenderName(json.sender_name || "");
      setObRecipients((json.ob_recipients || []).join(", "));
      setGpsRecipients((json.gps_recipients || []).join(", "));
      setTimesheetRecipients((json.timesheet_recipients || []).join(", "));
      setSubject(json.ob_subject_template || "");
      setBody(json.ob_body_template || "");
      setAutoSend(Boolean(json.auto_send_on_ob));
    } catch {
      setError("Network problem. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const payload = useMemo(
    () => ({
      action: "save",
      resendApiKey: apiKey,
      sender_email: senderEmail,
      sender_name: senderName,
      ob_recipients: obRecipients,
      gps_recipients: gpsRecipients,
      timesheet_recipients: timesheetRecipients,
      ob_subject_template: subject,
      ob_body_template: body,
      auto_send_on_ob: autoSend,
    }),
    [
      apiKey, senderEmail, senderName, obRecipients,
      gpsRecipients, timesheetRecipients, subject, body, autoSend,
    ]
  );

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Show the server's message verbatim — it carries the Supabase error code
        // (e.g. a missing RLS policy), which is what actually tells an admin
        // what to fix. A generic "could not save" hides that.
        toast.error(json?.error || "Could not save the configuration.", {
          duration: 8000,
          description: json?.code ? `Database error ${json.code}` : undefined,
        });
        return;
      }
      toast.success("Email configuration saved.");
      await load(); // re-seed so the field shows the mask of what is now stored
    } catch {
      toast.error("Network problem — configuration not saved.");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/email-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...payload, action: "test" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || "Test email failed.", { duration: 6000 });
        return;
      }
      toast.success(json?.message || "Test email sent.");
    } catch {
      toast.error("Network problem — test email not sent.");
    } finally {
      setTesting(false);
    }
  };

  if (forbidden) {
    return (
      <div className="mint-ui mint-scope flex flex-col items-center justify-center text-center px-6 py-16">
        <div
          className="w-16 h-16 rounded-[20px] flex items-center justify-center mb-4"
          style={{ background: "var(--alert-soft)", color: "var(--alert)" }}
        >
          <ShieldCheck size={28} />
        </div>
        <p className="text-[16px] font-black text-[var(--text)]">Access denied</p>
        <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1.5 max-w-[320px] leading-relaxed">
          Email configuration is managed by Super Admins.
        </p>
      </div>
    );
  }

  if (loading && !config) return <LoadingSkeleton />;
  if (error && !config) return <ErrorOverlay message={error} onRetry={load} />;

  // The field is untouched when it still holds the mask — that is how the API
  // distinguishes "no change" from "clear the key".
  const keyUnchanged = Boolean(config?.maskedApiKey) && apiKey === config?.maskedApiKey;
  const connected = Boolean(config?.hasApiKey);
  const obRecipientCount = obRecipients.split(/[,;\n]/).filter((s) => s.trim()).length;

  return (
    <div className="mint-ui mint-scope max-w-3xl">
      {/* Head */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div className="min-w-0">
          <h1 className="text-[21px] font-black text-[var(--text)] leading-tight tracking-tight">
            Email Configuration
          </h1>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-1 leading-snug">
            Where Biolog sends OB requests, GPS reviews and other notifications
          </p>
        </div>

        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold"
          style={
            connected
              ? { background: "var(--mint-soft)", color: "var(--mint-strong)" }
              : { background: "var(--hint-bg)", color: "var(--hint-text)" }
          }
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: connected ? "var(--mint)" : "#f59e0b" }}
          />
          Email service: {connected ? "Connected" : "Not configured"}
        </span>
      </div>

      {config?.usingEnvKey && (
        <div
          className="flex items-start gap-2.5 rounded-[var(--r-card)] p-3 mb-4"
          style={{ background: "var(--info-soft)" }}
        >
          <Info size={14} style={{ color: "var(--info)" }} className="shrink-0 mt-px" />
          <p className="text-[12px] font-semibold leading-relaxed" style={{ color: "var(--info)" }}>
            Using the server&apos;s RESEND_API_KEY ({config.envSenderEmail || "default sender"}).
            Paste a key below to override it for this company.
          </p>
        </div>
      )}

      {/* A · EMAIL SERVICE */}
      <SectionCard
        icon={<Server size={19} />}
        iconBg="var(--mint-soft)"
        iconFg="var(--mint-strong)"
        title="Email service"
        subtitle="Resend SMTP — the same provider the rest of Biolog already uses"
      >
        <div className="space-y-4">
          <Field
            label="Resend API key"
            hint={
              config?.canStoreKey
                ? "Stored encrypted with AES-256-GCM. Write-only: it is never sent back to this browser."
                : "Cannot be stored: EMAIL_CONFIG_SECRET (or IT_MASTER_PASSWORD) is not set on the server. Biolog will fall back to the server's RESEND_API_KEY."
            }
          >
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={!config?.canStoreKey}
                placeholder={connected ? "stored — type to replace" : "re_xxxxxxxxxxxxxxxxxxxx"}
                autoComplete="off"
                spellCheck={false}
                className={`${INPUT} pr-12 font-mono`}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Hide API key" : "Show API key"}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-[10px] flex items-center justify-center"
                style={{ color: "var(--text-muted)" }}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {keyUnchanged ? (
              <p
                className="text-[11px] font-semibold mt-2 flex items-center gap-1.5"
                style={{ color: "var(--mint-strong)" }}
              >
                <CheckCircle2 size={12} />
                A key is stored — leave this as-is, or type a new one to replace it.
              </p>
            ) : apiKey.length > 0 ? (
              <button
                type="button"
                onClick={() => setApiKey("")}
                className="text-[11px] font-extrabold mt-2 flex items-center gap-1.5"
                style={{ color: "var(--alert-ink)" }}
              >
                <X size={12} />
                Discard this key
              </button>
            ) : null}
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Sender email" hint="Must be on a verified Resend domain.">
              <input
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="no-reply@biolog.ph"
                className={INPUT}
              />
            </Field>

            <Field label="Sender name">
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="BIOLOG Notifications"
                className={INPUT}
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* B · RECIPIENTS */}
      <SectionCard
        icon={<Mail size={19} />}
        iconBg="var(--clay-soft)"
        iconFg="var(--clay-ink)"
        title="Recipients per request type"
        subtitle="Comma-separated. Multiple addresses are allowed."
      >
        <div className="space-y-4">
          <Field
            label="OB Request → HRAD"
            hint={`${obRecipientCount} recipient${obRecipientCount === 1 ? "" : "s"} · at least one is required to save.`}
          >
            <input
              type="text"
              value={obRecipients}
              onChange={(e) => setObRecipients(e.target.value)}
              placeholder="hrad@ecoshift.com, hr.admin@biolog.ph"
              className={INPUT}
            />
          </Field>

          <div
            className="flex items-center justify-between gap-3 rounded-[var(--r-card)] p-3.5"
            style={{ background: "var(--bg)", border: "1px solid var(--border)" }}
          >
            <div className="min-w-0">
              <p className="text-[13px] font-extrabold text-[var(--text)] leading-tight">
                Auto-send on every OB submit
              </p>
              <p className="text-[11px] font-semibold text-[var(--text-muted)] mt-0.5 leading-snug">
                {autoSend
                  ? "HRAD is emailed the moment an agent submits a request."
                  : "Off — reviewers are still notified through the in-app bell."}
              </p>
            </div>
            <Toggle
              checked={autoSend}
              onChange={() => setAutoSend((v) => !v)}
              label="Auto-send on every OB submit"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="GPS Report review → Supervisor" hint="Gets a blind copy of each decision.">
              <input
                type="text"
                value={gpsRecipients}
                onChange={(e) => setGpsRecipients(e.target.value)}
                placeholder="supervisor@biolog.ph"
                className={INPUT}
              />
            </Field>

            <Field label="Timesheet export" hint="Reserved — not wired up yet.">
              <input
                type="text"
                value={timesheetRecipients}
                onChange={(e) => setTimesheetRecipients(e.target.value)}
                placeholder="hr@biolog.ph"
                className={INPUT}
                disabled
              />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* C · TEMPLATE */}
      <SectionCard
        icon={<Sparkles size={19} />}
        iconBg="var(--info-soft)"
        iconFg="var(--info)"
        title="OB email template"
        subtitle="Subject and intro line for the HRAD notification"
      >
        <div className="space-y-4">
          <Field label="Subject line">
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={INPUT}
            />
          </Field>

          <Field label="Body intro">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className={`${INPUT} py-3 resize-none leading-relaxed`}
            />
          </Field>

          <div>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
              Insert a placeholder into the subject
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TOKENS.map((tok) => (
                <button
                  key={tok}
                  type="button"
                  onClick={() => setSubject((s) => `${s}{${tok}}`)}
                  className="min-h-[32px] px-2.5 rounded-full text-[11px] font-extrabold border transition-colors"
                  style={{ background: "var(--card)", color: "var(--text-muted)", borderColor: "var(--border)" }}
                >
                  {`{${tok}}`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
              How it will look
            </p>
            <div
              className="rounded-[var(--r-card)] border p-3.5"
              style={{ background: "var(--bg)", borderColor: "var(--border)" }}
            >
              <p className="text-[12px] font-extrabold text-[var(--text)] mb-1">
                {renderPreview(subject) || "(empty subject)"}
              </p>
              <p className="text-[12px] font-semibold text-[var(--text-muted)] leading-relaxed">
                {renderPreview(body)}
              </p>
              <p className="text-[11px] font-semibold text-[var(--text-faint)] mt-2.5 leading-relaxed">
                Then a detail table (name, position, department, destination, date of OB, purpose),
                links to each signed-form image, and a &ldquo;Review in Biolog Admin&rdquo; button.
              </p>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* D · ACTIONS */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="secondary"
            size="md"
            className="sm:flex-1"
            loading={testing}
            onClick={sendTest}
            icon={testing ? undefined : <Send size={17} />}
          >
            {testing ? "Sending…" : "Send Test Email"}
          </Button>
          <Button
            size="md"
            className="sm:flex-1"
            loading={saving}
            onClick={save}
            icon={saving ? undefined : <Save size={17} />}
          >
            {saving ? "Saving…" : "Save Configuration"}
          </Button>
        </div>

        <p className="text-[11.5px] font-semibold text-[var(--text-muted)] mt-3 leading-relaxed">
          The test email goes to the addresses currently in the form, not the saved ones — so you
          can verify a new address before committing to it. It is prefixed with [TEST].
        </p>

        {config?.updated_at && (
          <p className="text-[11px] font-bold text-[var(--text-faint)] mt-2">
            Last saved {new Date(config.updated_at).toLocaleString("en-PH")}
          </p>
        )}
      </Card>

      {!connected && (
        <div
          className="flex items-start gap-2.5 rounded-[var(--r-card)] p-3 mt-4"
          style={{ background: "var(--hint-bg)" }}
        >
          <AlertTriangle size={14} style={{ color: "var(--hint-text)" }} className="shrink-0 mt-px" />
          <p className="text-[12px] font-semibold leading-relaxed" style={{ color: "var(--hint-text)" }}>
            No Resend API key yet, so OB emails will not send. The in-app bell still notifies
            reviewers either way.
          </p>
        </div>
      )}
    </div>
  );
}