/* ============================================================================
   OB REQUEST — shared domain logic
   ----------------------------------------------------------------------------
   Request for Official Business Trip (ROBT), image-first.

   The signed paper form is the artifact: an agent photographs it, the photo is
   the approval basis, and no digital signature fields exist. Everything in this
   file is pure and side-effect free so the submit form, the history list, the
   detail screen, the admin queue and the API routes all agree on what "late
   filing" means and how a status is coloured.

   Imported from BOTH client and server — keep it free of node-only imports.
   ========================================================================== */

import { toDateKeyPH, formatPHDate, formatPHDateTime } from "./ph-time";

/* ── Status ────────────────────────────────────────────────────────────────
   The four values the DB CHECK constraint accepts. Treat as a closed set: the
   migration rejects anything else, so a status arriving from the database that
   is not in here means someone edited a row by hand.

   "For COO Approval" is RESERVED and currently unreachable. The approval chain
   today is Agent → HRAD, so nothing writes it and nothing can move a row into
   or out of it. It is kept in the enum (and in the CHECK) because COO sign-off
   on late filings is the next phase; activating it means adding a transition
   below, a button, and removing the `next: []` terminal marker. */

export const OB_STATUS = {
  PENDING: "Pending Review",
  APPROVED: "Approved",
  DECLINED: "Declined",
  FOR_COO: "For COO Approval",
} as const;

export type ObStatus = (typeof OB_STATUS)[keyof typeof OB_STATUS];

export const OB_STATUSES: ObStatus[] = [
  OB_STATUS.PENDING,
  OB_STATUS.APPROVED,
  OB_STATUS.DECLINED,
  OB_STATUS.FOR_COO,
];

/**
 * What a reviewer is allowed to move a row to.
 *
 * `next: []` marks a terminal status — the API rejects any transition out of it,
 * so the admin UI cannot offer a button that the server will refuse.
 */
export const OB_REVIEW_ACTIONS: Record<ObStatus, { next: ObStatus[]; label: string }> = {
  [OB_STATUS.PENDING]: { next: [OB_STATUS.APPROVED, OB_STATUS.DECLINED], label: "Pending Review" },
  [OB_STATUS.APPROVED]: { next: [], label: "Approved" },
  [OB_STATUS.DECLINED]: { next: [], label: "Declined" },
  // Reserved for COO sign-off. Terminal until that phase lands.
  [OB_STATUS.FOR_COO]: { next: [], label: "For COO Approval" },
};

/**
 * The notification email for a decision is derived from the status being moved
 * TO, not from where it came from — otherwise "escalated" would leak back in as
 * an email variant the moment COO sign-off is enabled.
 */
export type ObReviewOutcome = "approved" | "declined";

export function obReviewOutcome(target: ObStatus): ObReviewOutcome {
  return target === OB_STATUS.APPROVED ? "approved" : "declined";
}

/* ── Row shape ───────────────────────────────────────────────────────────────
   Mirrors public.ob_requests. Kept as a single interface so the client never
   re-declares the columns and drifts from the migration. */

export interface ObRequest {
  id: number | string;
  ReferenceID: string;
  Name?: string | null;
  Position?: string | null;
  Department?: string | null;
  Destination?: string | null;
  DateOfOB?: string | null;
  PurposeOfTravel?: string | null;
  IsLateFiling?: boolean | null;
  Justification?: string | null;
  /** Array of image URLs — same convention as gps_reports.PhotoURL. */
  PhotoURL?: string[] | null;
  Status?: string | null;
  ReviewedBy?: string | null;
  ReviewNotes?: string | null;
  ReviewedAt?: string | null;
  date_created?: string | null;
  company_id?: number | string | null;
}

/* ── Limits ───────────────────────────────────────────────────────────────── */

export const MAX_OB_PHOTOS = 3;
export const MAX_OB_PHOTO_BYTES = 8 * 1024 * 1024;

/* ── Late filing ─────────────────────────────────────────────────────────────
   Guideline 1 of the form: filing must be at least ONE day in advance. So a
   trip dated today or tomorrow counts as late, and anything further out is
   fine. Compared on whole calendar days in Manila time, not on raw millisecond
   offsets — otherwise a 9pm submission for tomorrow morning trips the warning
   purely because of the hour.

   `filedOn` is the date the form was submitted, which is what the guideline is
   actually written against. */

export const MIN_ADVANCE_DAYS = 1;

export function daysUntil(dateOfOB?: string | null, filedOn?: Date | string): number | null {
  if (!dateOfOB) return null;
  // A bare "YYYY-MM-DD" parses as UTC midnight, which can read as the previous
  // day in Manila. Compare date KEYS instead of Date objects to sidestep that.
  const target = toDateKeyPH(dateOfOB);
  const filed = toDateKeyPH(filedOn ?? new Date());
  if (!target || !filed) return null;

  const [ty, tm, td] = target.split("-").map(Number);
  const [fy, fm, fd] = filed.split("-").map(Number);
  const targetUtc = Date.UTC(ty, tm - 1, td);
  const filedUtc = Date.UTC(fy, fm - 1, fd);
  if ([ty, tm, td, fy, fm, fd].some((n) => !Number.isFinite(n))) return null;

  return Math.round((targetUtc - filedUtc) / 86_400_000);
}

export function computeLateFiling(dateOfOB?: string | null, filedOn?: Date | string): boolean {
  const days = daysUntil(dateOfOB, filedOn);
  if (days === null) return false;
  return days < MIN_ADVANCE_DAYS;
}

/* ── Guidelines (verbatim from the paper ROBT form) ──────────────────────── */

export const OB_GUIDELINES = [
  "Filing of ROBT should be at least one (1) day in advance and must be approved by Department Head.",
  "Unfiled ROBT will be considered absent and subject to salary deduction.",
  "Late filing is subject for COO approval with justification.",
] as const;

export const OB_PHOTO_HINT =
  "Siguraduhing nakikita ang lahat ng pirma (signatories) at malinaw ang form. Ang larawan ang magiging basehan ng approval.";

/* ── Status presentation ────────────────────────────────────────────────────
   Amber / green / red / purple per spec. Each entry carries explicit colours
   rather than relying on a Tone, because "For COO Approval" needs purple and
   the shared <Pill> palette only ships mint / clay / alert / info / neutral. */

export type ObTone = {
  label: string;
  fg: string;
  bg: string;
  dot: string;
  Icon: "clock" | "check" | "x" | "flag";
};

export const OB_STATUS_TONE: Record<ObStatus, ObTone> = {
  [OB_STATUS.PENDING]: { label: "Pending Review", fg: "#92400e", bg: "#fef3c7", dot: "#f59e0b", Icon: "clock" },
  [OB_STATUS.APPROVED]: { label: "Approved", fg: "#096b4c", bg: "var(--mint-soft)", dot: "var(--mint)", Icon: "check" },
  [OB_STATUS.DECLINED]: { label: "Declined", fg: "var(--alert-ink)", bg: "var(--alert-soft)", dot: "var(--alert)", Icon: "x" },
  [OB_STATUS.FOR_COO]: { label: "For COO Approval", fg: "#5b21b6", bg: "#ede9fe", dot: "#7c3aed", Icon: "flag" },
};

/** Narrow an arbitrary string from the DB to a known status. */
/**
 * Parse a status a REVIEWER is asking for.
 *
 * Strict — returns null for anything that is not an explicit decision. This is
 * deliberately different from normaliseObStatus() below, which coerces
 * unrecognised input to PENDING for display purposes: a review action that
 * silently degraded to "Pending Review" would report success while changing
 * nothing. Accepts the legacy "rejected" spelling.
 */
export function parseObReviewAction(value?: string | null): ObStatus | null {
  const v = (value || "").trim().toLowerCase();
  if (v === "approved" || v === "approve") return OB_STATUS.APPROVED;
  if (v === "declined" || v === "decline" || v === "rejected") return OB_STATUS.DECLINED;
  if (v === "for coo approval" || v === "for coo" || v === "coo") return OB_STATUS.FOR_COO;
  return null;
}

/**
 * Is `target` a legal destination from ANY status? Used to validate an incoming
 * action before we know the row's current state.
 *
 * Note the direction: OB_REVIEW_ACTIONS is keyed by the CURRENT status and
 * lists what it may become, so the target is validated by scanning for it
 * rather than by indexing. Indexing with the target would read a terminal
 * entry and reject every real approval.
 */
export function isValidObReviewTarget(target: ObStatus): boolean {
  return OB_STATUSES.some((from) => OB_REVIEW_ACTIONS[from].next.includes(target));
}

/** For display only. Unknown input becomes PENDING — never for a write path. */
export function normaliseObStatus(value?: string | null): ObStatus {
  return parseObReviewAction(value) ?? OB_STATUS.PENDING;
}

export function obStatusTone(status?: string | null): ObTone {
  return OB_STATUS_TONE[normaliseObStatus(status)];
}

export const isOpenStatus = (s?: string | null) =>
  normaliseObStatus(s) === OB_STATUS.PENDING || normaliseObStatus(s) === OB_STATUS.FOR_COO;

/* ── Formatting ──────────────────────────────────────────────────────────────
   Everything renders in Philippine time, matching the rest of the app. */

export function formatObDate(value?: string | null): string {
  if (!value) return "—";
  return formatPHDate(value, { month: "short", day: "numeric", year: "numeric" });
}

export function formatObDateTime(value?: string | null): string {
  if (!value) return "—";
  return formatPHDateTime(value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "Today" / "Yesterday" / "Mar 3" — for a list that is sorted newest first. */
export function obRelativeDay(value?: string | null): string {
  if (!value) return "—";
  const key = toDateKeyPH(value);
  const today = toDateKeyPH(new Date());
  if (key === today) return "Today";
  const yesterday = new Date(Date.now() - 86_400_000);
  if (key === toDateKeyPH(yesterday)) return "Yesterday";
  return formatPHDate(value, { month: "short", day: "numeric" });
}

/** Normalise jsonb → string[] without ever throwing on a malformed row. */
export function obPhotos(row: ObRequest | null | undefined): string[] {
  const raw = row?.PhotoURL;
  if (Array.isArray(raw)) return raw.filter((u): u is string => typeof u === "string" && u.length > 0);
  // jsonb can round-trip as a string when it was written as a JSON-encoded
  // array. Tolerate that instead of rendering a blank viewer.
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((u): u is string => typeof u === "string" && u.length > 0);
    } catch {
      /* fall through */
    }
  }
  return [];
}

/** Human label for the admin export + detail screens. */
export function obEmployeeName(row: ObRequest): string {
  const n = (row.Name || "").trim();
  return n || row.ReferenceID || "Unknown";
}

export function obEmployeeInitials(row: ObRequest): string {
  return (
    obEmployeeName(row)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("") || "?"
  );
}