"use client";

/* ============================================================================
   DOCUMENTATION
   ----------------------------------------------------------------------------
   Reference for the whole Biolog platform: the attendance sequence, the data
   model, every page, every API, and how a third party connects with a Bearer
   token.

   Everything here is read from the actual codebase — the table list comes from
   what Supabase actually returns, the route list from pages/api, the page list
   from app/. Nothing is aspirational.
   ========================================================================== */

import React, { useMemo, useState } from "react";
import {
  Book,
  Check,
  Copy,
  Database,
  KeyRound,
  Layers,
  MapPin,
  Server,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Card, Pill } from "@/app/activity-planner/mint/ui";

/* ── Content ─────────────────────────────────────────────────────────────── */

type Block =
  | { k: "p"; text: string }
  | { k: "code"; lang?: string; text: string }
  | { k: "table"; head: string[]; rows: string[][] }
  | { k: "note"; tone: "info" | "warn" | "ok"; title: string; text: string }
  | { k: "list"; items: string[] }
  | { k: "h"; text: string };

const SECTIONS: { id: string; title: string; icon: React.ReactNode; blocks: Block[] }[] = [
  {
    id: "overview",
    title: "Overview",
    icon: <Book size={16} />,
    blocks: [
      { k: "p", text: "Biolog is a field-attendance platform for Territory Sales Associates: biometric clock-in/out, GPS-verified client site visits, offline-first syncing, and a Super Admin console for oversight." },
      {
        k: "list",
        items: [
          "Agent app — clock in, log client visits, submit GPS reports, request tickets",
          "Admin console — users, GPS approvals, team reports, timesheets, API keys, backups, companies",
          "Public API — Bearer-token access to the activity log for 3rd-party integration",
        ],
      },
      {
        k: "note",
        tone: "info",
        title: "Two independent sequences",
        text: "Clock In/Out (the shift) and Time In/Out (client visits) write the SAME Status values — \"Login\" and \"Logout\". Only the Type column separates them. Any query or report MUST filter on Type, or a site visit will be misread as a clock-in.",
      },
    ],
  },
  {
    id: "sequence",
    title: "Attendance sequence",
    icon: <Layers size={16} />,
    blocks: [
      { k: "p", text: "A field agent's day runs: Clock In once → Time In / Time Out for every client → Clock Out once." },
      {
        k: "table",
        head: ["Action", "Type", "Status", "Repeats?"],
        rows: [
          ["Clock In", "On Field", "Login", "Once per day"],
          ["Time In", "Client Visit", "Login", "Once per client"],
          ["Time Out", "Client Visit", "Logout", "Once per client"],
          ["Clock Out", "On Field", "Logout", "Once per day"],
        ],
      },
      {
        k: "note",
        tone: "warn",
        title: "The single most common bug",
        text: "Because both sequences share Status values, attendance state must be computed with a Type filter (isShiftLog / isVisitLog in app/activity-planner/mint/data.ts). Without it the Clock In button flips to \"Clock Out\" immediately after a single site visit.",
      },
      { k: "p", text: "Lockout is separate from that sequence: an account is locked once LoginAttempts reaches 5 and LockUntil is still in the future." },
    ],
  },
  {
    id: "data-model",
    title: "Data model",
    icon: <Database size={16} />,
    blocks: [
      {
        k: "p",
        text: "Supabase / PostgreSQL. Column names are quoted exactly as they exist — \"ReferenceID\", \"SiteVisitAccount\", and so on are case-sensitive.",
      },
      { k: "h", text: "tasklog — every attendance and site-visit row" },
      {
        k: "code",
        text: `id                    bigint PK
ReferenceID           text NOT NULL
Email                 text
Type                  text     -- "On Field" | "Client Visit"
Status                text     -- "Login" | "Logout"
Remarks               text
TSM                   text
SiteVisitAccount      text     -- "New Client" | "Existing Client"
Manager               text
Location              text
Latitude              text     -- stored as TEXT, not numeric
Longitude             text
PhotoURL              text
account_reference_number text
date_created          timestamptz
updatedAt             timestamp
company_id            bigint   -- multi-tenant`,
      },
      { k: "h", text: "users" },
      {
        k: "code",
        text: `id, "ReferenceID" (unique), "UserId", "Firstname", "Lastname",
"Email", "userName", "Password" (bcrypt), "Role", "TargetQuota",
"Department", "Location", "Company", "Manager", "TSM", "Status",
"LockUntil", "LoginAttempts", "ContactNumber", "profilePicture",
"Position", "FingerprintKey", "DeviceId",
twoFactorEnabled, faceVerificationEnabled,
permissions jsonb, "Directories" jsonb, type_of_sales,
company_id bigint`,
      },
      { k: "h", text: "gps_reports — GPS submissions under review" },
      {
        k: "code",
        text: `id, "ReferenceID", "Email", "Type" default 'GPS Report',
"Status" default 'Submitted', "Remarks", "TSM", "PhotoURL" jsonb,
loginDate, logoutDate, "Latitude", "Longitude", "Location",
reviewStatus default 'pending', "reviewedBy", "reviewNotes", "reviewedAt",
date_created, company_id`,
      },
      { k: "h", text: "Platform tables" },
      {
        k: "table",
        head: ["Table", "Purpose"],
        rows: [
          ["sessions", "Signed-in sessions keyed by the `session` cookie"],
          ["system_settings", "Global config; upserted on type = 'global'"],
          ["meetings", "Scheduled client meetings"],
          ["tickets", "Agent support tickets"],
          ["audit_logs", "Who did what, admin actions"],
          ["push_tokens", "Device push registrations"],
          ["companies", "Multi-tenant companies"],
          ["api_keys", "Third-party API keys — SHA-256 hash only"],
          ["api_call_log", "Every authenticated API call"],
          ["backups", "Backup history"],
        ],
      },
    ],
  },
  {
    id: "auth",
    title: "Authentication",
    icon: <ShieldCheck size={16} />,
    blocks: [
      {
        k: "p",
        text: "Admin and agent sessions both resolve from an HttpOnly `session` cookie: cookie → sessions.token → sessions.userId → users.id.",
      },
      {
        k: "note",
        tone: "info",
        title: "The session is the only authority",
        text: "UI state is never trusted. Every /api/admin/* route re-checks the cookie server-side. Do not gate anything on a URL parameter — the ?id= value is client-controlled and was previously used to leak another agent's records.",
      },
      { k: "h", text: "Role resolution" },
      {
        k: "code",
        text: `Super Admin / Admin / Admin / IT  → everything
Manager                            → team-wide read (can_view_all)
Territory Sales Associate           → sales attendance drawer
Default User                       → basic attendance drawer`,
      },
      {
        k: "p",
        text: "Roles are compared case-insensitively with whitespace collapsed — \"SuperAdmin\", \"SUPERADMIN\" and \"Super Admin\" are all the same role, because the column is hand-edited.",
      },
      { k: "h", text: "Fine-grained permissions (users.permissions jsonb)" },
      {
        k: "code",
        text: `can_manage_users     can_review_gps        can_view_all
can_manage_settings  can_view_reports      can_create_sales_attendance
can_create_attendance`,
      },
    ],
  },
  {
    id: "api",
    title: "API reference",
    icon: <Server size={16} />,
    blocks: [
      {
        k: "p",
        text: "Two surfaces. Internal routes under /api/* are session-cookie authenticated and are for the app itself. The public /api/v1/* surface is Bearer-token authenticated and is for third parties.",
      },
      { k: "h", text: "Public v1 — GET /api/v1/tasklog" },
      {
        k: "p",
        text: "Scope required: read:tasklog. Query parameters:",
      },
      {
        k: "table",
        head: ["Parameter", "Notes"],
        rows: [
          ["ReferenceID", "Exact match. Required for self-scoped keys."],
          ["type", "\"On Field\" or \"Client Visit\""],
          ["status", "\"Login\" or \"Logout\""],
          ["date_from", "ISO 8601, inclusive"],
          ["date_to", "ISO 8601, inclusive"],
          ["company_id", "Multi-tenant filter"],
          ["limit / offset", "Paging"],
        ],
      },
      {
        k: "code",
        text: `GET /api/v1/tasklog?ReferenceID=JG-NCR-920587&date_from=2026-10-01
Authorization: Bearer blg_live_xxxxxxxx

200 →
{
  "success": true,
  "count": 3,
  "data": [ { "id": 1, "ReferenceID": "…", "Type": "Client Visit", … } ],
  "meta": { "limit": 100, "offset": 0,
            "range": { "from": "2026-10-01", "to": null } }
}`,
      },
      { k: "h", text: "Public v1 — POST /api/v1/tasklog" },
      { k: "p", text: "Scope required: write:tasklog. Required body fields: ReferenceID, Type, Status." },
      {
        k: "code",
        text: `POST /api/v1/tasklog
Authorization: Bearer blg_live_xxxxxxxx
Content-Type: application/json

{
  "ReferenceID": "JG-NCR-920587",
  "Type": "Client Visit",
  "Status": "Login",
  "Location": "EDSA, Quezon City",
  "Latitude": "14.6760",
  "Longitude": "121.0437",
  "Remarks": "Arrived at client"
}

201 → { "success": true, "id": 4821 }`,
      },
      { k: "h", text: "Admin endpoints (session cookie required)" },
      {
        k: "table",
        head: ["Endpoint", "Purpose"],
        rows: [
          ["/api/admin/session", "Who am I + effective permissions"],
          ["/api/admin/users", "User CRUD (can_manage_users)"],
          ["/api/admin/reset-password", "Temporary password, clears lockout, kills sessions"],
          ["/api/admin/approvals", "GPS report queue + review counts"],
          ["/api/admin/activity", "Unified activity log (tasklog + meetings)"],
          ["/api/admin/analytics", "Per-agent attendance + weekly hours"],
          ["/api/admin/settings", "Global config (announcement, shift, grace period)"],
          ["/api/admin/api-keys", "Create / list / revoke API keys"],
          ["/api/admin/companies", "Multi-tenant company management"],
          ["/api/admin/backup", "Backup history + restore"],
          ["/api/gps-report/update", "Approve or decline a report (can_review_gps)"],
          ["/api/attendance/drawer", "Which attendance drawer this role may open"],
        ],
      },
      { k: "h", text: "Auth and activity endpoints" },
      {
        k: "code",
        text: `POST /api/login                       sign in, sets the session cookie
GET  /api/check-session                 validate the cookie
POST /api/auth/password-reset-request  email a 6-digit OTP
POST /api/auth/password-reset-verify   exchange the OTP for a reset token
POST /api/auth/password-reset-complete set the new password
POST /api/ModuleSales/Activity/AddLog       write an attendance row
GET  /api/ModuleSales/Activity/FetchLog     read activity (admin or self)
GET  /api/ModuleSales/Activity/LastStatus   last status for a Type
POST /api/gps-report                       submit a GPS report`,
      },
    ],
  },
  {
    id: "tokens",
    title: "Connecting from a 3rd party",
    icon: <KeyRound size={16} />,
    blocks: [
      {
        k: "p",
        text: "Create a key in Admin → Advanced → API Credentials. The plaintext key is shown exactly once — only its SHA-256 hash is stored, so it cannot be recovered later.",
      },
      { k: "h", text: "Scopes" },
      {
        k: "table",
        head: ["Scope", "Grants"],
        rows: [
          ["read:tasklog", "GET /api/v1/tasklog"],
          ["write:tasklog", "POST /api/v1/tasklog"],
          ["admin:full", "Everything the key can otherwise do"],
        ],
      },
      { k: "h", text: "Rate limits" },
      {
        k: "p",
        text: "Per key, per minute. Exceeding it returns 429 with a Retry-After header. Choose 100, 500, or unlimited when creating the key.",
      },
      { k: "h", text: "Example — Node" },
      {
        k: "code",
        lang: "js",
        text: `const res = await fetch(
  "https://<your-host>/api/v1/tasklog" +
  "?ReferenceID=JG-NCR-920587" +
  "&date_from=2026-10-01",
  {
    headers: {
      Authorization: "Bearer blg_live_xxxxxxxxxxxxxxxx",
      Accept: "application/json",
    },
  },
);

if (!res.ok) {
  const err = await res.json();
  throw new Error(err.error);   // 401 bad/missing key, 403 scope, 429 limit
}

const { data, meta } = await res.json();
console.log(\`\${meta.range.from} → \${data.length} rows\`);`,
      },
      { k: "h", text: "Example — cURL" },
      {
        k: "code",
        lang: "bash",
        text: `curl -s "https://<your-host>/api/v1/tasklog?limit=5" \\
  -H "Authorization: Bearer blg_live_xxxxxxxxxxxxxxxx"`,
      },
      { k: "h", text: "Error responses" },
      {
        k: "table",
        head: ["Status", "Meaning"],
        rows: [
          ["401", "Missing, malformed, revoked or unknown key"],
          ["403", "Key is valid but lacks the required scope"],
          ["429", "Rate limit exceeded — read Retry-After"],
          ["400", "Invalid query or missing required body field"],
        ],
      },
      {
        k: "note",
        tone: "warn",
        title: "Treat the key like a password",
        text: "It grants read access to attendance data including GPS coordinates and site locations. Never commit it, never log it, and revoke it from the API Credentials tab the moment it leaks.",
      },
      {
        k: "note",
        tone: "info",
        title: "Every call is audited",
        text: "api_call_log records the key id, endpoint, method, IP, status code and whether the call was denied.",
      },
    ],
  },
  {
    id: "pages",
    title: "Pages",
    icon: <Smartphone size={16} />,
    blocks: [
      { k: "h", text: "Agent app" },
      {
        k: "table",
        head: ["Route", "Screen"],
        rows: [
          ["/Login", "Sign in"],
          ["/Register", "Create an account (admin review required)"],
          ["/activity-planner", "Home · Calendar · Reports · Profile"],
          ["/gps-report", "Submit a GPS report"],
          ["/profile", "Account and settings"],
          ["/time-attendance/activity", "Activity log"],
          ["/time-attendance/location", "Location records"],
          ["/time-attendance/timesheet", "Personal timesheet"],
          ["/ticket", "Raise a support ticket"],
          ["/pending-approval", "Awaiting admin approval"],
        ],
      },
      { k: "h", text: "Admin console" },
      {
        k: "table",
        head: ["Route", "Screen"],
        rows: [
          ["/admin", "Admin Overview"],
          ["/admin/users", "System Users"],
          ["/admin/approvals", "GPS Approvals"],
          ["/admin/site-visits", "Site Visits & Activity Log"],
          ["/admin/reports", "Attendance Reports — Team Overview"],
          ["/admin/timesheet", "Timesheet — weekly"],
          ["/admin/api-keys", "API Credentials"],
          ["/admin/backup", "Backup & Restore"],
          ["/admin/companies", "Companies"],
          ["/admin/settings", "Admin Settings"],
          ["/admin/activity-logs", "Activity logs"],
          ["/admin/attendance-summary", "Attendance summary"],
          ["/admin/audit-logs", "Audit log"],
          ["/admin/gps-reports", "GPS reports"],
          ["/admin/live-tracking", "Live tracking"],
          ["/admin/tickets", "Tickets"],
          ["/admin/documentation", "This page"],
        ],
      },
      { k: "h", text: "Recruitment" },
      {
        k: "table",
        head: ["Route", "Screen"],
        rows: [
          ["/recruitment/job-posting", "Job postings"],
          ["/recruitment/applicant-inquiries", "Applicant inquiries"],
        ],
      },
    ],
  },
  {
    id: "operations",
    title: "Operations",
    icon: <MapPin size={16} />,
    blocks: [
      { k: "h", text: "Offline behaviour" },
      {
        k: "list",
        items: [
          "Attendance rows are queued in IndexedDB when the network is unavailable.",
          "The queue drains automatically once signal returns.",
          "ProtectedPageWrapper falls back to the locally stored offline session.",
          "Queued rows are not visible in reports until they sync.",
        ],
      },
      { k: "h", text: "Email" },
      {
        k: "p",
        text: "Transactional mail goes through Resend over SMTP. Without RESEND_FROM the sandbox sender is used, which only ever delivers to the Resend account owner — password reset silently fails for everyone else.",
      },
      { k: "h", text: "Rate limiting" },
      {
        k: "p",
        text: "lib/rate-limit.ts applies a sliding window per IP. Tightest budget is password-reset-request at 3 per 15 minutes, because every accepted request sends a real email.",
      },
      {
        k: "note",
        tone: "warn",
        title: "Serverless caveat",
        text: "Rate-limit counters live in the Node process. On Vercel each cold start gets its own bucket, so the effective limit is per-instance rather than global.",
      },
      { k: "h", text: "Schema migrations" },
      {
        k: "code",
        text: `supabase/migrations/20260101_admin_platform.sql

Applies companies, api_keys, api_call_log, backups and company_id.
Idempotent — re-running is safe. The app connects with the publishable
key only, so DDL must be run from the Supabase SQL Editor.`,
      },
    ],
  },
];

/* ── Renderers ───────────────────────────────────────────────────────────── */

function Code({ text }: { text: string }) {
  return (
    <pre
      className="rounded-[var(--r-card)] p-3.5 overflow-x-auto text-[11.5px] leading-relaxed font-mono"
      style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
    >
      <code>{text}</code>
    </pre>
  );
}

function Note({
  tone,
  title,
  text,
}: {
  tone: "info" | "warn" | "ok";
  title: string;
  text: string;
}) {
  const map = {
    info: { bg: "var(--info-soft)", fg: "var(--info)" },
    warn: { bg: "var(--hint-bg)", fg: "var(--hint-text)" },
    ok: { bg: "var(--mint-soft)", fg: "var(--mint-strong)" },
  } as const;
  const t = map[tone];
  return (
    <div
      className="rounded-[var(--r-card)] p-3.5 flex items-start gap-2.5"
      style={{ background: t.bg, color: t.fg }}
    >
      <span className="shrink-0 mt-0.5">
        {tone === "ok" ? <Check size={14} /> : <ShieldCheck size={14} />}
      </span>
      <div>
        <p className="text-[12px] font-extrabold">{title}</p>
        <p className="text-[11.5px] font-semibold leading-relaxed mt-1">{text}</p>
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function AdminDocumentation() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const [copied, setCopied] = useState("");

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      /* clipboard blocked */
    }
  };

  const jump = (id: string) => {
    setActive(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const current = useMemo(() => SECTIONS.find((s) => s.id === active) || SECTIONS[0], [active]);

  return (
    <div>
      <div className="flex items-start gap-3 mb-5 flex-wrap">
        <div
          className="w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0"
          style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
        >
          <Book size={20} />
        </div>
        <div>
          <h1 className="text-[19px] font-black text-[var(--text)] leading-tight">Documentation</h1>
          <p className="text-[12.5px] font-semibold text-[var(--text-muted)] mt-0.5">
            Data model, attendance rules, API reference and third-party integration.
          </p>
        </div>
      </div>

      <div className="flex gap-6 items-start">
        {/* Table of contents */}
        <nav className="hidden lg:block w-[210px] shrink-0 sticky top-4">
          <p className="text-[9.5px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
            Contents
          </p>
          <div className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => {
              const on = active === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jump(s.id)}
                  className="flex items-center gap-2 min-h-[40px] px-3 rounded-[11px] text-[12px] font-bold text-left transition-colors"
                  style={{
                    background: on ? "var(--mint-soft)" : "transparent",
                    color: on ? "var(--mint-strong)" : "var(--text-muted)",
                  }}
                >
                  {s.icon}
                  <span className="truncate">{s.title}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Body */}
        <div className="flex-1 min-w-0 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.id} id={`doc-${s.id}`} className="scroll-mt-4">
              <div className="flex items-center gap-2.5 mb-3">
                <span
                  className="w-8 h-8 rounded-[11px] flex items-center justify-center shrink-0"
                  style={{ background: "var(--mint-soft)", color: "var(--mint-strong)" }}
                >
                  {s.icon}
                </span>
                <h2 className="text-[17px] font-black text-[var(--text)]">{s.title}</h2>
              </div>

              <div className="flex flex-col gap-3.5">
                {s.blocks.map((b, i) => {
                  switch (b.k) {
                    case "p":
                      return (
                        <p key={i} className="text-[13px] font-semibold text-[var(--text)] leading-relaxed">
                          {b.text}
                        </p>
                      );
                    case "h":
                      return (
                        <p
                          key={i}
                          className="text-[10px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] mt-1"
                        >
                          {b.text}
                        </p>
                      );
                    case "list":
                      return (
                        <ul key={i} className="flex flex-col gap-1.5">
                          {b.items.map((it) => (
                            <li key={it} className="flex items-start gap-2 text-[12.5px] font-semibold text-[var(--text)]">
                              <span
                                className="w-1.5 h-1.5 rounded-full mt-2 shrink-0"
                                style={{ background: "var(--mint)" }}
                              />
                              {it}
                            </li>
                          ))}
                        </ul>
                      );
                    case "code":
                      return (
                        <div key={i} className="relative group">
                          <Code text={b.text} />
                          <button
                            type="button"
                            onClick={() => copy(b.text, `${s.id}-${i}`)}
                            aria-label="Copy"
                            className="absolute top-2 right-2 w-9 h-9 rounded-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text-faint)" }}
                          >
                            {copied === `${s.id}-${i}` ? (
                              <Check size={14} style={{ color: "var(--mint-strong)" }} />
                            ) : (
                              <Copy size={14} />
                            )}
                          </button>
                        </div>
                      );
                    case "note":
                      return <Note key={i} tone={b.tone} title={b.title} text={b.text} />;
                    case "table":
                      return (
                        <div
                          key={i}
                          className="rounded-[var(--r-card)] border overflow-x-auto"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <table className="w-full min-w-[420px]">
                            <thead>
                              <tr style={{ background: "var(--bg)" }}>
                                {b.head.map((h) => (
                                  <th
                                    key={h}
                                    className="text-left px-3.5 py-2.5 text-[9.5px] font-black uppercase tracking-[0.1em]"
                                    style={{ color: "var(--text-muted)" }}
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {b.rows.map((r, ri) => (
                                <tr
                                  key={ri}
                                  className="border-t"
                                  style={{ borderColor: "var(--border)" }}
                                >
                                  {r.map((c, ci) => (
                                    <td
                                      key={ci}
                                      className={
                                        ci === 0
                                          ? "px-3.5 py-2.5 text-[11.5px] font-extrabold text-[var(--text)] whitespace-nowrap"
                                          : "px-3.5 py-2.5 text-[11.5px] font-semibold text-[var(--text-muted)]"
                                      }
                                    >
                                      {c}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    default:
                      return null;
                  }
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* Mobile section chips */}
      <div className="lg:hidden flex items-center gap-2 overflow-x-auto pb-2 mt-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            className="min-h-[38px] px-3 rounded-full text-[11.5px] font-extrabold whitespace-nowrap border"
            style={{
              background: current.id === s.id ? "var(--mint-btn)" : "var(--card)",
              color: current.id === s.id ? "#fff" : "var(--text-muted)",
              borderColor: current.id === s.id ? "transparent" : "var(--border)",
            }}
          >
            {s.title}
          </button>
        ))}
      </div>

      <Pill tone="neutral" className="mt-4">
        Verified against the running codebase
      </Pill>
    </div>
  );
}