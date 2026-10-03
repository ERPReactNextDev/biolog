/* ============================================================================
   Backup manifest — which tables a JSON export contains
   ----------------------------------------------------------------------------
   WHY A MANIFEST
   The export previously hardcoded four fetches in app/admin/backup/page.tsx.
   Every new table then needed a code change, and forgetting one meant a backup
   that silently omitted live records — a backup you believe covers OB requests,
   group visits and notifications but which quietly does not.

   One list here is the whole contract. Adding a table is a one-line change.

   WHY THE REDACTIONS ARE NOT OPTIONAL
   `users` holds bcrypt password hashes and `email_config` holds the
   encrypted Resend API key. A backup file is a JSON blob that lands in a
   Downloads folder and gets emailed around — writing credential columns into it
   turns "take a backup" into "leak every credential in the database". Both
   columns are dropped below, and `select()` is never `select("*")` for a table
   with secrets, so a new column cannot silently start leaking either.

   WHY A MISSING TABLE IS NOT FATAL
   A backup taken on an install that has not yet applied the newest migration
   will hit tables that do not exist. Those are reported under `skipped` and the
   rest of the export completes — otherwise adding a feature would break
   backups for everyone who has not run the migration yet, which is the worst
   possible time to lose your safety net.
   ========================================================================== */

export type BackupTable = {
  /** Database table name. */
  name: string;
  /** Label shown in the export progress list. */
  label: string;
  /**
   * Explicit column list. Deliberately NOT "*" so a column added later has to
   * be chosen deliberately rather than leaking by default.
   */
  columns: string[];
  /** Cap on rows. null = no limit. */
  limit?: number | null;
  /**
   * Restrict to one tenant. Only meaningful for tenant tables; company_id is
   * nullable, so a NULL row belongs to no tenant and is always included.
   */
  tenantScoped?: boolean;
  /** Short note shown in the UI when the table is skipped. */
  note?: string;
};

/** Columns that must never reach a backup file. */
export const NEVER_EXPORT = {
  users: ["Password"],
  email_config: ["resend_api_key_enc"],
  // Visitor IPs and user agents identify a person. A backup file lands in a
  // Downloads folder and gets emailed around, so these are dropped. The
  // owner/status/notes that the sales pipeline actually needs are included.
  website_inquiries: ["submitted_ip", "user_agent", "honeypot"],
} as const;

export const BACKUP_TABLES: BackupTable[] = [
  {
    name: "users",
    label: "Users",
    // Password is deliberately absent — see NEVER_EXPORT.
    columns: [
      "id", "Firstname", "Lastname", "Email", "Role", "Department", "Company",
      "company_id", "ReferenceID", "Status", "Manager", "TSM", "TSMName",
      "ManagerName", "ContactNumber", "Position", "Address", "Location",
      "TargetQuota", "profilePicture", "permissions", "createdAt", "updatedAt",
      "LoginAttempts", "LockUntil", "Connection", "twoFactorEnabled",
    ],
    note: "Password hashes are excluded by design.",
  },
  {
    name: "tasklog",
    label: "Attendance & site visits",
    // Column names verified against the live table. Attendance and client
    // visits BOTH live here — there is no site_visits table (see the
    // admin_platform migration), so this row is the attendance history.
    columns: [
      "id", "ReferenceID", "Email", "Type", "Status", "Remarks", "TSM",
      "Manager", "SiteVisitAccount", "Location", "Latitude", "Longitude",
      "PhotoURL", "SitePhotoURL", "account_reference_number",
      "company_id", "date_created", "updatedAt",
      // Location quality, added with migration 20260106. GeoReviewed* is
      // included deliberately: whether a manager already looked at a flagged
      // visit is part of the record, and losing it would resurrect every
      // reviewed item as "new" on the next login after a restore.
      "GeoAccuracyM", "GeoSource", "GeoFlag", "GeoDistanceM", "GeoSiteName",
      "GeoReviewed", "GeoReviewedBy", "GeoReviewedAt",
    ],
  },
  {
    name: "website_inquiries",
    label: "Website inquiries",
    // submitted_ip, user_agent and honeypot are deliberately absent — see
    // NEVER_EXPORT above. A lead's name, email, company and pipeline state are
    // the parts worth keeping; the visitor's IP is not.
    columns: [
      "id", "name", "email", "company", "message", "user_range",
      "status", "assigned_to", "notes", "source_page",
      "is_read", "read_at", "created_at", "updated_at",
    ],
    note: "Demo requests from the marketing site. Visitor IP and user agent are excluded by design.",
  },
  {
    name: "client_sites",
    label: "Client site fences",
    // Coordinates and boundaries ONLY. This is not a client list — the client
    // master lives in Neon and is not in this database. name_key is GENERATED
    // and deliberately absent: the database recomputes it on write.
    columns: [
      "id", "name", "latitude", "longitude", "radius_meters", "is_active",
      "company_id", "created_at", "updated_at",
    ],
    note: "Geofence boundaries keyed by client name. Client master data lives in Neon and is not part of a Supabase backup.",
  },
  {
    name: "gps_reports",
    label: "GPS reports",
    columns: [
      "id", "ReferenceID", "Email", "TSM", "Status", "Remarks", "PhotoURL",
      "loginDate", "logoutDate", "Latitude", "Longitude", "Location",
      "reviewStatus", "reviewedBy", "reviewNotes", "reviewedAt",
      "company_id", "date_created",
      // Same rationale as tasklog: GeoReviewed* records that a human has
      // already looked at the report's location, and dropping it would
      // resurrect every reviewed report as unreviewed after a restore.
      "GeoAccuracyM", "GeoSource", "GeoFlag",
      "GeoReviewed", "GeoReviewedBy", "GeoReviewedAt",
    ],
  },
  {
    name: "ob_requests",
    label: "OB requests",
    columns: [
      "id", "ReferenceID", "Name", "Position", "Department", "Destination",
      "DateOfOB", "PurposeOfTravel", "IsLateFiling", "Justification",
      "PhotoURL", "Status", "ReviewedBy", "ReviewNotes", "ReviewedAt",
      "EmailStatus", "EmailSentAt", "EmailRetries", "EmailError",
      "company_id", "date_created",
    ],
    note: "Includes the signed-form image URLs and the email delivery status.",
  },
  {
    name: "group_visitations",
    label: "Group visitations",
    columns: [
      "id", "ReferenceID_creator", "CreatorRole", "CreatorName", "CompanyName",
      "CompanyAddress", "VisitDate", "MeetupTime", "MeetingPoint", "Purpose",
      "MaxMembers", "Visibility", "Status", "GroupPhotoURL", "company_id",
      "date_created",
    ],
  },
  {
    name: "group_visit_members",
    label: "Group visit members",
    columns: [
      "id", "group_visit_id", "ReferenceID", "joined_at", "checked_in",
      "checked_in_at",
    ],
  },
  {
    name: "notifications",
    label: "Notifications",
    columns: [
      "id", "ReferenceID", "type", "title", "message", "link_url",
      "thumb_url", "meta", "is_read", "read_at", "company_id", "created_at",
    ],
  },
  {
    name: "email_config",
    label: "Email configuration",
    // resend_api_key_enc is deliberately absent — see NEVER_EXPORT.
    columns: [
      "id", "company_id", "sender_email", "sender_name", "ob_recipients",
      "gps_recipients", "timesheet_recipients", "ob_subject_template",
      "ob_body_template", "auto_send_on_ob", "is_active", "updated_at",
      "created_at",
    ],
    note: "The Resend key is excluded; re-enter it after a restore.",
  },
  {
    name: "companies",
    label: "Companies",
    columns: ["id", "name", "plan", "status", "admin_email", "settings", "created_at"],
  },
  {
    name: "system_settings",
    label: "System settings",
    columns: [
      "type", "officeStartTime", "officeEndTime", "lunchStart", "lunchEnd",
      "gracePeriod", "themeColor", "logoUrl", "announcement",
      "geofenceLat", "geofenceLng", "geofenceRadius", "updatedAt",
    ],
  },
  {
    name: "meetings",
    label: "Meetings",
    // All lowercase in the live schema — NOT the capitalised names used
    // elsewhere, which is why the first version of this list 42703'd.
    columns: [
      "id", "referenceid", "tsm", "manager", "type_activity", "remarks",
      "start_date", "end_date", "location", "meeting_link", "attendees",
      "status", "outcome", "outcome_notes", "follow_up_date",
      "follow_up_notes", "is_cancelled", "cancellation_reason",
      "company_name", "date_created", "date_updated",
    ],
  },
  {
    name: "backups",
    label: "Backup history",
    columns: ["id", "filename", "size_bytes", "type", "schedule", "created_by", "created_at"],
  },
  {
    name: "api_keys",
    label: "API credentials",
    // key_hash is a SHA-256 digest, not a usable credential, but it is still
    // authentication material and has no business in a backup file.
    columns: ["id", "key_name", "key_prefix", "scopes", "rate_limit", "revoked", "revoked_at", "created_by", "created_at"],
    note: "key_hash is excluded; rotated keys must be re-issued after a restore.",
  },
];

/** Tables whose rows belong to a tenant. */
export const TENANT_TABLES = BACKUP_TABLES.filter((t) =>
  ["users", "tasklog", "gps_reports", "ob_requests", "group_visitations", "notifications", "email_config", "client_sites"].includes(t.name)
).map((t) => t.name);

export const BACKUP_VERSION = 2;