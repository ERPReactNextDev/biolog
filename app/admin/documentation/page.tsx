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
  PlaneTakeoff,
  Server,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Pill } from "@/app/activity-planner/mint/ui";

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
      { k: "h", text: "ob_requests — official business trips (ROBT), image-first" },
      {
        k: "p",
        text: "The signed paper form is the artifact: an agent photographs it and the photo is what HRAD approves. There are deliberately no signature columns.",
      },
      {
        k: "code",
        text: `id                      bigint PK
"ReferenceID"           text NOT NULL   -- submitter
"Name"/"Position"/"Department" text       -- snapshot at submit
"Destination"           text
"DateOfOB"              date
"PurposeOfTravel"       text
"IsLateFiling"          bool            -- filed with <= 1 day notice
"Justification"         text            -- expected when late
"PhotoURL"              jsonb NOT NULL  -- image URLs; CHECK requires >= 1
"Status"                text default 'Pending Review'
                          CHECK IN ('Pending Review','Approved','Declined',
                                    'For COO Approval')
"ReviewedBy"/"ReviewNotes"/"ReviewedAt"
"EmailStatus"           text            -- 'pending' | 'sent' | 'failed'
"EmailSentAt"/"EmailRetries"/"EmailError"
date_created, company_id`,
      },
      {
        k: "note",
        tone: "info",
        title: "'For COO Approval' is reserved",
        text: "The approval chain is Agent → HRAD. Nothing writes 'For COO Approval' and no transition targets it; the value is kept so COO sign-off can be enabled without a migration.",
      },
      { k: "h", text: "group_visitations — team-restricted field visits" },
      {
        k: "code",
        text: `id                      bigint PK
"ReferenceID_creator"   text NOT NULL   -- creator decides visibility
"CreatorRole"/"CreatorName"            -- snapshot at create
"CompanyName"           text NOT NULL   -- the headline of every card
"CompanyAddress"        text
"VisitDate"             date default current_date
"MeetupTime"            time
"MeetingPoint"/"Purpose" text
"MaxMembers"            int             -- NULL = unlimited
"Visibility"            text default 'team_only'
                          CHECK IN ('team_only','open_to_all')
"Status"                text default 'Upcoming'
                          CHECK IN ('Upcoming','Ongoing','Completed','Cancelled')
date_created, company_id`,
      },
      {
        k: "note",
        tone: "warn",
        title: "Visibility follows the creator, not the visitor",
        text: "A Manager / Territory Sales Manager creates team-only by default; an ordinary agent creates open-to-all. Both defaults carry an override. Team membership resolves from users.TSM / users.Manager by ReferenceID, with users.TSMName / users.ManagerName as a fallback.",
      },
      { k: "h", text: "group_visit_members — one row per person per visit" },
      {
        k: "code",
        text: `id                   bigint PK
group_visit_id       bigint NOT NULL REFERENCES group_visitations ON DELETE CASCADE
"ReferenceID"        text NOT NULL
joined_at, checked_in, checked_in_at
UNIQUE (group_visit_id, "ReferenceID")   -- no double join`,
      },
      {
        k: "p",
        text: "Status is DERIVED on read, not stored: Upcoming → Ongoing at the meet-up time → Completed at end of day. Only Cancelled and manual overrides persist.",
      },
      { k: "h", text: "notifications — in-app bell" },
      {
        k: "code",
        text: `id                bigint PK
"ReferenceID"     text NOT NULL   -- recipient; one row each, never a broadcast
type              text NOT NULL
                    CHECK IN ('ob_approved','ob_declined','ob_submitted',
                              'gps_reviewed','group_visit')
title, message, link_url, thumb_url
meta              jsonb
is_read default false, read_at
company_id, created_at`,
      },
      {
        k: "note",
        tone: "info",
        title: "Two bells, two feeds",
        text: "The admin bell shows ob_submitted only (OB approvals). The agent bell shows ob_approved, ob_declined and group_visit. group_visit is deliberately NOT in the admin feed, or team visits would bury real OB requests.",
      },
      { k: "h", text: "email_config — per-company outbound mail" },
      {
        k: "code",
        text: `id                bigint PK
company_id        bigint          -- NULL = the default install
resend_api_key_enc text           -- AES-256-GCM; never exported to a backup
sender_email, sender_name
ob_recipients / gps_recipients / timesheet_recipients   jsonb
ob_subject_template, ob_body_template
auto_send_on_ob  bool default false
is_active, updated_at, created_at`,
      },
      {
        k: "note",
        tone: "warn",
        title: "The key is write-only and encrypted",
        text: "Resolution order is email_config → RESEND_API_KEY, so a fresh install works before anyone configures anything. The API never returns the plaintext key; it returns a mask and a boolean.",
      },
      { k: "h", text: "tasklog — the location-quality columns" },
      {
        k: "p",
        text: "Added by migration 20260106_location_accuracy.sql. All nullable, so every pre-existing row is untouched and reads back as GeoFlag = NULL, meaning \u201cno geo data\u201d rather than \u201cpassed\u201d.",
      },
      {
        k: "code",
        text: `"GeoAccuracyM"     numeric     -- reported accuracy radius, metres
"GeoSource"        text        CHECK IN ('gps','fallback','cached','manual')
"GeoFlag"          text        CHECK IN ('low_accuracy','outside_geofence',
                                    'manual_override','offline_stale',
                                    'network_fix')
"GeoDistanceM"     integer     -- distance from the client site's centre
"GeoSiteName"      text        -- which client_sites row matched
"GeoReviewed"      boolean     default false
"GeoReviewedBy"/"GeoReviewedAt"

-- Partial index: the review queue only ever reads flagged, unreviewed rows.
CREATE INDEX idx_tasklog_geo_review ON tasklog (date_created DESC)
  WHERE "GeoFlag" IS NOT NULL AND "GeoReviewed" = false;`,
      },
      {
        k: "note",
        tone: "warn",
        title: "GeoFlag is derived on the server, never accepted from the browser",
        text: "AddLog reads GeoAccuracyM and GeoSource but ignores any GeoFlag in the request body — a client that can name its own flag has no flag at all. The value is computed from our own accuracy number and our own fence lookup. For an out-of-fence visit the server additionally REFUSES the write unless a photo and remarks are both present, since the sheet is exactly the thing an agent can bypass.",
      },
      {
        k: "p",
        text: "Priority when two apply: outside_geofence outranks everything, then offline_stale, network_fix, manual_override, low_accuracy. Being outside the boundary is the only one an admin must act on, and it must not be buried under a low-accuracy entry.",
      },
      { k: "h", text: "client_sites — the fence directory, NOT a client list" },
      {
        k: "note",
        tone: "info",
        title: "The clients live in Neon",
        text: "accounts.company_name, read by /api/fetch-account, /api/fetch-tsm and /api/fetch-manager. That remains the only source of truth for who the clients are. client_sites holds no company name, contact or account reference — it stores only where a client is and how far an agent may stray from it.",
      },
      {
        k: "code",
        text: `id            bigint PK
name          text NOT NULL   -- LOOKUP KEY ONLY, not a registry
latitude      numeric NOT NULL
longitude     numeric NOT NULL
radius_meters integer NOT NULL DEFAULT 100 CHECK (> 0 AND <= 5000)
is_active     boolean NOT NULL DEFAULT true
created_at / updated_at / company_id

-- GENERATED, so the app cannot write a wrong value:
name_key      text GENERATED ALWAYS AS
                (lower(btrim(regexp_replace(name, '\\s+', ' ', 'g')))) STORED`,
      },
      {
        k: "p",
        text: "The name is present purely because Neon and Supabase are separate databases and tasklog.\"SiteVisitAccount\" is a plain company-name string with no shared id — so the name is the only thing a fence can be found by. A client renamed in Neon stops matching, which is silent and harmless: no fence means no warning, exactly as before.",
      },
      {
        k: "p",
        text: "Wants the fence to travel with the account instead? Add latitude/longitude/radius_meters to Neon accounts and drop this table. Two functions change: resolveFence() in pages/api/ModuleSales/Activity/AddLog.ts and fetchSiteFence() in lib/geofence.ts. The trade is that Neon is not covered by the JSON backup.",
      },
      { k: "h", text: "Platform tables" },
      {
        k: "table",
        head: ["Table", "Purpose"],
        rows: [
          ["sessions", "Signed-in sessions keyed by the `session` cookie"],
          ["system_settings", "Global config; upserted on type = 'global'"],
          ["meetings", "Scheduled client meetings"],
          ["accounts (NEON)", "Client master data — the source of truth for client names"],
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
Territory Sales Associate           → sales attendance drawer (role default)
HRAD / Territory Sales Manager      → can review OB requests
Default User                       → basic attendance drawer`,
      },
      {
        k: "p",
        text: "Roles are compared case-insensitively with whitespace collapsed — \"SuperAdmin\", \"SUPERADMIN\" and \"Super Admin\" are all the same role, because the column is hand-edited. The live table also contains \"MANAGER\" next to \"Manager\", so a strict comparison would silently exclude a real manager.",
      },
      { k: "h", text: "Fine-grained permissions (users.permissions jsonb)" },
      {
        k: "code",
        text: `can_manage_users     can_review_gps        can_view_all
can_manage_settings  can_view_reports      can_create_sales_attendance
can_review_ob        can_lookup_clients    can_create_attendance`,
      },
      {
        k: "p",
        text: "Super Admin and Admin pass every permission unconditionally. Everyone else is decided by these flags.",
      },
      {
        k: "note",
        tone: "warn",
        title: "Use permFlagRaw(), not permFlag(), for anything overridable",
        text: "permFlag() collapses an ABSENT key to false, which makes it impossible to express 'the admin chose no'. permFlagRaw() returns true / false / undefined so an explicit override can override a role default in both directions. Using the boolean form for can_create_attendance also denied every user who had never been configured, which 403'd the whole attendance surface.",
      },
      {
        k: "table",
        head: ["Permission", "Default when unset"],
        rows: [
          ["can_create_sales_attendance", "True for a Territory Sales Associate"],
          ["can_lookup_clients", "True — existing sales users keep the client picker"],
          ["can_create_attendance", "True — only an explicit false denies"],
          ["can_review_ob", "False unless the role is HRAD / TSM / Manager or Super Admin"],
        ],
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
          ["/api/admin/email-config", "Per-company mail settings + send test (can_manage_settings)"],
          ["/api/admin/client-sites", "Fence CRUD (can_manage_settings); GET is open to all"],
          ["/api/admin/geo-flags", "Flagged attendance queue + mark reviewed (can_view_reports)"],
          ["GET /api/geofence/site?site=", "The fence for one client name — used by both sheets"],
          ["/api/admin/backup/export", "Full JSON dump of every table in the backup manifest"],
        ],
      },
      { k: "h", text: "OB and Group Visit endpoints" },
      {
        k: "table",
        head: ["Endpoint", "Purpose"],
        rows: [
          ["GET /api/ob-request?scope=mine", "Your own OB requests"],
          ["GET /api/ob-request?scope=queue&filter=pending|approved|declined|late", "Review queue (can_review_ob)"],
          ["POST /api/ob-request", "File a request. At least one image URL is required"],
          ["POST /api/ob-request/review", "Approve or decline; notifies the agent"],
          ["GET /api/group-visits?scope=feed", "Group visits you are ALLOWED to see, with join state"],
          ["GET /api/group-visits?scope=one&id=N", "One visit — still filtered through the team rule"],
          ["POST /api/group-visits", "Create a visit; creator auto-joins, team is notified"],
          ["POST /api/group-visits/join", "action: join | leave | cancel | checkin"],
          ["GET /api/notifications?bell=admin|agent", "Your notifications and unread count"],
          ["POST /api/notifications/read", "Mark one read, or all when id is omitted"],
        ],
      },
      {
        k: "note",
        tone: "info",
        title: "A restricted visit is never sent to the client",
        text: "GET /api/group-visits filters through canSee() on the server, so a team-only group is invisible to an outsider — guessing its id returns nothing. The disabled JOIN button exists only so the UI can explain the restriction.",
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
    id: "field-features",
    title: "Field features",
    icon: <PlaneTakeoff size={16} />,
    blocks: [
      {
        k: "p",
        text: "Three additions to the agent app that share one rule: the SERVER decides what an agent may see or do, and the UI only renders what it was told.",
      },

      { k: "h", text: "Location accuracy — watchPosition, not getCurrentPosition" },
      {
        k: "p",
        text: "lib/geo.ts is the single authority for how a coordinate was obtained, how good it is, and what address it is. Both attendance sheets and the GPS report go through it, so \u201cwhat counts as a good fix\u201d cannot drift between screens.",
      },
      {
        k: "table",
        head: ["Was", "Now"],
        rows: [
          ["getCurrentPosition() resolved with the FIRST reading", "watchPosition() for up to 15 s, keeping the tightest"],
          ["The first reading was accepted immediately", "2.5 s minimum dwell, so the radio can improve on it"],
          ["coords.accuracy was discarded", "Carried end-to-end: badge, map circle, tasklog column, server-side flag"],
          ["A poor fix looked identical to a good one", "Excellent / Good / Poor — amber only on Poor"],
          ["Raw Nominatim fetch on every drag", "Pluggable provider + 30-day cache + 1 req/s floor"],
          ["Offline produced a blank address", "Last known fix, then cached address, then raw coordinates"],
        ],
      },
      {
        k: "code",
        text: `captureBestPosition()  // the fallback chain, in order
  1. watchPosition  { enableHighAccuracy: true, timeout: 15000,
                      maximumAge: 0 }
     keeps the BEST reading and resolves early once <= 25 m, but only
     AFTER a 2.5 s dwell. Own timer, because PositionOptions.timeout
     bounds the reading AGE, not the total listening time — so it cannot
     be relied on to end the window.
  2. one getCurrentPosition { enableHighAccuracy: false, timeout: 10000,
                               maximumAge: 60000 }   → source "fallback"
  3. localStorage last known fix                    → source "cached"

  PERMISSION_DENIED short-circuits the whole chain on purpose: falling
  through to a stale pin would clock the agent in somewhere they are not.`,
      },
      {
        k: "table",
        head: ["Source", "Flagged when", "Meaning"],
        rows: [
          ["gps", "accuracy > 50 m", "Live fix but a weak one — usually indoors"],
          ["gps", "never", "Accepted silently"],
          ["fallback", "always", "The high-accuracy watch timed out; the network answered"],
          ["cached", "always", "Last known position, not a live reading"],
          ["manual", "always", "The agent dragged the pin or typed an address"],
          ["— server side —", "outside the fence", "Outranks every flag above"],
        ],
      },
      {
        k: "note",
        tone: "warn",
        title: "Nominatim is a policy risk, and swapping it costs money",
        text: "Nominatim's public instance forbids heavy and commercial use and throttles hard. Google and Mapbox both bill per request, and this app geocodes on every drag, so the provider is an env var rather than a hardcoded swap: set NEXT_PUBLIC_MAPBOX_TOKEN or NEXT_PUBLIC_GOOGLE_GEOCODING_KEY and it is picked up automatically; otherwise Nominatim stays, but behind a real cache and a 1 req/s floor so a team of agents does not get the whole install IP blocked.",
      },
      {
        k: "note",
        tone: "info",
        title: "The accuracy circle is the point of the map",
        text: "The picker draws L.circle at radius = coords.accuracy, dashed so it stays distinguishable from the solid geofence. The GPS fix and the draggable marker are deliberately two separate things — collapsing them into one marker is what made the original confusing, because moving the pin visually moved the error circle. OSM streets and Esri World Imagery are both available, because an agent inside a building needs to see the roof they are under.",
      },
      {
        k: "note",
        tone: "info",
        title: "Two fences, and they refuse differently on purpose",
        text: "The OFFICE fence (system_settings) still REFUSES an off-site clock-in, exactly as before. A CLIENT fence only warns and flags: an agent legitimately standing near a client is not away from the office, so refusing the visit would be wrong. Both sheets apply the office fence on Login so they agree.",
      },
      { k: "h", text: "Attendance access — permission, not position" },
      {
        k: "p",
        text: "Admin → Users has an Attendance access setting that picks which clock-in screen an agent gets. It overrides their role in BOTH directions, so a Territory Sales Associate can be moved onto the standard drawer and an ordinary agent can be given the sales one.",
      },
      {
        k: "table",
        head: ["Setting", "Effect"],
        rows: [
          ["Standard attendance", "components/CreateAttendance.tsx — photo, location, remarks"],
          ["Sales & client visits", "components/CreateSalesAttenance.tsx — adds client type, account, sales remarks"],
          ["Allow client lookup", "Sales drawer only. Off hides New/Existing Client and the account search"],
        ],
      },
      {
        k: "note",
        tone: "warn",
        title: "Tri-state flags, not booleans",
        text: "can_create_sales_attendance is read through permFlagRaw(), which distinguishes unset from false. The boolean reader collapsed 'never configured' into 'denied', which made it impossible for an admin to say no — and separately made every attendance endpoint answer 403, because can_create_attendance treated an absent key as a denial.",
      },
      {
        k: "code",
        text: `GET /api/attendance/drawer

200 →
{
  "success": true,
  "drawer": "sales",            // or "basic"
  "canCreateSales": true,
  "canLookupClients": true,     // forced off for the basic drawer
  "targetQuota": 1750000
}`,
      },
      {
        k: "note",
        tone: "info",
        title: "Client lookup off does not block clock-out",
        text: "The sales drawer normally requires a client on Logout. With the toggle off that validation is skipped, otherwise the agent could never log out.",
      },

      { k: "h", text: "OB Request — image-first" },
      {
        k: "p",
        text: "The ROBT form is signed on paper by the Employee, Department Head and HRAD. The agent photographs that form and the photo becomes the approval artifact, so a request cannot be submitted without one — enforced in the UI, in the API, and by a CHECK constraint.",
      },
      {
        k: "table",
        head: ["Stage", "What happens"],
        rows: [
          ["Submit", "Image is required. Name/Position/Department auto-fill from the session — never from the request body."],
          ["Late filing", "Computed from VisitDate vs today in Manila time. <= 1 day is late; a justification is requested."],
          ["Queue", "HRAD sees a thumbnail, zoomable image, details, and Approve / Decline with notes."],
          ["Decision", "Email + in-app bell both fire. The email address is resolved from users by ReferenceID."],
          ["Failure", "EmailStatus = 'failed' raises a banner in OB Approvals pointing at Email Config."],
        ],
      },
      {
        k: "note",
        tone: "info",
        title: "Images go to Supabase Storage first",
        text: "lib/storage.ts tries the 'ob-requests' bucket and falls back to Cloudinary, so the feature works before the bucket exists. Both return a plain HTTPS URL, so the viewer treats them interchangeably.",
      },

      { k: "h", text: "Group Visitation — team-restricted" },
      {
        k: "p",
        text: "A manager or TSM's team visit is visible only to the people under them. Who counts as 'under them' is resolved in lib/group-visits.ts and enforced on every read and every join — the disabled JOIN button is a convenience, never the boundary.",
      },
      {
        k: "code",
        text: `users."TSM"        = creator."ReferenceID"
OR users."Manager"  = creator."ReferenceID"
OR users."TSMName"    = creator full name      -- fallback
OR users."ManagerName" = creator full name    -- fallback`,
      },
      {
        k: "note",
        tone: "warn",
        title: "ReferenceID matching is primary",
        text: "On the live database the denormalised TSMName/ManagerName columns are far emptier than TSM/Manager, so name-only matching would miss most of a team. Both are matched, case-insensitively, because the data contains 'MANAGER' alongside 'Manager'.",
      },
      {
        k: "table",
        head: ["Viewer", "team_only group"],
        rows: [
          ["Creator", "sees and joins"],
          ["Agent under the creator", "sees and joins"],
          ["Anyone else", "hidden from the feed; join is rejected with the creator's name"],
          ["Super Admin / Admin", "sees and joins everything"],
        ],
      },

      { k: "h", text: "Email and notifications" },
      {
        k: "p",
        text: "Admin → Email Config holds the per-company Resend settings. Turning on 'Auto-send on every OB submit' makes HRAD receive the request the moment it is filed; the in-app bell works either way.",
      },
      {
        k: "note",
        tone: "warn",
        title: "Backups exclude credentials by design",
        text: "lib/backup-manifest.ts names columns explicitly and never uses select('*'). users.Password, email_config.resend_api_key_enc and api_keys.key_hash are excluded, and the export file records that it did so.",
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
          ["/ob-request", "OB Request — submit a signed form · my requests"],
          ["/group-visitation", "Group Visitation — feed + create a team visit"],
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
          ["/admin/ob-approvals", "OB Approvals — review signed forms"],
          ["/admin/site-visits", "Site Visits & Activity Log"],
          ["/admin/reports", "Attendance Reports — Team Overview"],
          ["/admin/timesheet", "Timesheet — weekly"],
          ["/admin/api-keys", "API Credentials"],
          ["/admin/backup", "Backup & Restore"],
          ["/admin/companies", "Companies"],
          ["/admin/settings", "Admin Settings"],
          ["/admin/email-config", "Email Config — Resend key, recipients, templates"],
          ["/admin/client-sites", "Client Site Fences — map boundaries per client"],
          ["/admin/location-review", "Location Review — flagged attendance records"],
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