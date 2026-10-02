/* ============================================================================
   Group Visitation — domain logic
   ----------------------------------------------------------------------------
   THE SINGLE AUTHORITY ON WHO CAN SEE AND JOIN A GROUP VISIT.

   Every feed query and every join goes through here, so the UI can never be
   the only thing enforcing a restriction. The rule, verbatim from the spec:

     A group visit created by a Manager / TSM is TEAM-ONLY by default:
       visible + joinable only by the creator and the agents under them, where
       "under them" means
          users.TSM       = creator.ReferenceID
       OR users.Manager   = creator.ReferenceID
       OR users.TSMName   = creator full name      (fallback)
       OR users.ManagerName = creator full name    (fallback)

     A group visit created by an ordinary agent defaults to OPEN TO ALL.

   Both defaults carry an override, stored on the row, and an explicit override
   always wins.

   WHY THE TEAM INDEX IS LOADED WHOLE
   The obvious implementation resolves the team per group visit, which is an
   N+1 across the feed. Instead every user row needed for the decision is read
   ONCE and the relationships are resolved in memory — one extra query no
   matter how many group visits are on screen. At the current ~325 users that is
   far cheaper than 20 extra round trips.
   ========================================================================== */

import { supabase } from "./supabase";
import { isSuperAdminRole, isAdminRole } from "./rbac";

export type Visibility = "team_only" | "open_to_all";
export type GroupStatus = "Upcoming" | "Ongoing" | "Completed" | "Cancelled";

export type GroupVisit = {
  id: number | string;
  ReferenceID_creator: string;
  CreatorRole?: string | null;
  CreatorName?: string | null;
  CompanyName: string;
  CompanyAddress?: string | null;
  VisitDate: string;
  MeetupTime?: string | null;
  MeetingPoint?: string | null;
  Purpose?: string | null;
  MaxMembers?: number | null;
  Visibility: Visibility;
  Status: GroupStatus;
  GroupPhotoURL?: string | null;
  date_created?: string | null;
  company_id?: number | string | null;
};

export type Member = {
  ReferenceID: string;
  joined_at?: string | null;
  checked_in?: boolean | null;
  Firstname?: string | null;
  Lastname?: string | null;
  profilePicture?: string | null;
};

/* ── Roles ──────────────────────────────────────────────────────────────────
   "MANAGER" exists in the live data alongside "Manager", so this compares
   case-insensitively with collapsed whitespace — the same normalisation
   lib/rbac.ts applies. Matching on the exact string would silently exclude
   one real manager. */

const norm = (s?: string | null) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

const TEAM_LEADER_ROLES = ["manager", "territory sales manager", "tsm", "sales manager"];

/** Does this role make a team-only group the default? */
export function isTeamLeaderRole(role?: string | null): boolean {
  return TEAM_LEADER_ROLES.includes(norm(role));
}

/** Can this role see EVERY group visit regardless of visibility? */
export function isGroupOversightRole(role?: string | null): boolean {
  return isSuperAdminRole(role) || isAdminRole(role);
}

/** Default visibility for a creator with this role. */
export function defaultVisibilityFor(role?: string | null): Visibility {
  return isTeamLeaderRole(role) ? "team_only" : "open_to_all";
}

/* ── Team index ───────────────────────────────────────────────────────────── */

export type Person = {
  ReferenceID: string;
  Firstname?: string | null;
  Lastname?: string | null;
  Role?: string | null;
  Department?: string | null;
  Email?: string | null;
  profilePicture?: string | null;
  TSM?: string | null;
  Manager?: string | null;
  TSMName?: string | null;
  ManagerName?: string | null;
  company_id?: number | string | null;
};

export type TeamIndex = Map<string, Person>;

/**
 * Everyone who can be a member or a viewer, keyed by ReferenceID.
 *
 * Read once per request. Empty ReferenceIDs are skipped — they would collapse
 * distinct people into one key and make an unrelated person match everyone.
 */
export async function loadTeamIndex(): Promise<TeamIndex> {
  const idx: TeamIndex = new Map();
  if (!supabase) return idx;

  const { data, error } = await supabase
    .from("users")
    .select(
      '"ReferenceID","Firstname","Lastname","Role","Department","Email","profilePicture","TSM","Manager","TSMName","ManagerName",company_id'
    )
    .limit(5000);

  if (error) {
    console.error("[group-visits] team index error:", error);
    return idx;
  }

  for (const row of (data || []) as Person[]) {
    const ref = (row.ReferenceID || "").trim();
    if (!ref) continue;
    idx.set(ref, row);
  }
  return idx;
}

export function fullNameOf(p?: Person | null): string {
  if (!p) return "";
  return `${(p.Firstname || "").trim()} ${(p.Lastname || "").trim()}`.trim();
}

/**
 * ReferenceIDs of the people under `creator`.
 *
 * ReferenceID matching is primary because it is exact. The TSMName /
 * ManagerName clauses are a documented fallback for rows where the creator's
 * own TSM/Manager is blank — measured on the live DB, 244 of 325 users have a
 * TSM or Manager set while only ~136 have the denormalised *_Name fields, so
 * the name clauses alone would miss most of a team.
 *
 * Comparison is trimmed and case-insensitive because the name columns are
 * hand-entered and do not agree on casing or trailing spaces.
 */
export function teamOf(idx: TeamIndex, creatorRef: string): Set<string> {
  const out = new Set<string>();
  const creator = idx.get(creatorRef);
  if (!creatorRef) return out;

  const ref = creatorRef.trim();
  const name = fullNameOf(creator).toLowerCase();

  for (const person of idx.values()) {
    const matches =
      // Under them by reference — the reliable link.
      (person.TSM || "").trim().toLowerCase() === ref.toLowerCase() ||
      (person.Manager || "").trim().toLowerCase() === ref.toLowerCase() ||
      // By denormalised name — fallback only.
      (!!name &&
        (person.TSMName || "").trim().toLowerCase() === name) ||
      (!!name &&
        (person.ManagerName || "").trim().toLowerCase() === name);

    if (matches && person.ReferenceID) out.add(person.ReferenceID);
  }
  return out;
}

/* ── Visibility & eligibility ────────────────────────────────────────────── */

export type Viewer = {
  referenceId: string;
  role?: string | null;
  email?: string | null;
};

/** May this viewer see the group visit at all? */
export function canSee(idx: TeamIndex, gv: GroupVisit, viewer: Viewer): boolean {
  if (gv.Visibility === "open_to_all") return true;
  if (isGroupOversightRole(viewer.role)) return true;
  if (gv.ReferenceID_creator === viewer.referenceId) return true;
  return teamOf(idx, gv.ReferenceID_creator).has(viewer.referenceId);
}

export type JoinCheck = { ok: boolean; reason?: string };

/**
 * Server-side join gate. The disabled JOIN button in the UI is a convenience;
 * this is the boundary.
 */
export function canJoin(
  idx: TeamIndex,
  gv: GroupVisit,
  viewer: Viewer
): JoinCheck {
  // Derive rather than trusting the stored Status: a visit whose date has passed
  // is Completed even though nothing ever wrote that, and the feed must not
  // offer a Join button on it.
  const status = deriveStatus(gv);

  if (status === "Cancelled") {
    return { ok: false, reason: "This group visit was cancelled." };
  }
  if (status === "Completed") {
    return { ok: false, reason: "This group visit has already finished." };
  }

  if (gv.Visibility === "team_only" && !canSee(idx, gv, viewer)) {
    const creatorName =
      gv.CreatorName?.trim() ||
      fullNameOf(idx.get(gv.ReferenceID_creator)) ||
      "the organiser";
    return {
      ok: false,
      reason: `This group visit is restricted to ${creatorName}'s team.`,
    };
  }

  return { ok: true };
}

/** Is the group visit full? Unlimited (NULL) is never full. */
export function isFull(gv: GroupVisit, memberCount: number): boolean {
  return gv.MaxMembers != null && memberCount >= gv.MaxMembers;
}

/** How many more people may join. */
export function seatsLeft(gv: GroupVisit, memberCount: number): number | null {
  if (gv.MaxMembers == null) return null;
  return Math.max(0, gv.MaxMembers - memberCount);
}

/* ── Status derivation ──────────────────────────────────────────────────────
   Upcoming -> Ongoing (at meet-up) -> Completed (end of day). Derived on read
   so a visit never sits at "Upcoming" forever just because nobody pressed a
   button; the stored Status stays authoritative for Cancelled and for any
   manual override. */

export function deriveStatus(gv: GroupVisit, now: Date = new Date()): GroupStatus {
  if (gv.Status === "Cancelled") return "Cancelled";

  // Compare on calendar dates in Manila, matching the rest of the app.
  const todayKey = phDateKey(now);
  const visitKey = String(gv.VisitDate || "").slice(0, 10);

  if (visitKey < todayKey) return "Completed";
  if (visitKey > todayKey) return "Upcoming";

  // Same day as the visit.
  //
  // Meet-up times are WALL-CLOCK in Manila, so "now" must be read in Manila too.
  // Using the server's local hours would be an hour out for a UTC host — enough
  // to flip a visit between Upcoming and Ongoing at exactly the wrong moment.
  const { hour, minute } = phTimeOf(now);
  const minutesNow = hour * 60 + minute;

  if (gv.MeetupTime) {
    const [h, m] = String(gv.MeetupTime).split(":").map((n) => parseInt(n, 10) || 0);
    if (minutesNow >= h * 60 + m) {
      // Past the meet-up and past the end of the day.
      if (minutesNow >= 23 * 60 + 59) return "Completed";
      return "Ongoing";
    }
  } else if (minutesNow >= 23 * 60 + 59) {
    return "Completed";
  }

  return "Upcoming";
}

function phDateKey(d: Date): string {
  // en-CA yields YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function phTimeOf(d: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  // en-GB renders midnight as "24" in some engines.
  const hour = get("hour");
  return { hour: hour === 24 ? 0 : hour, minute: get("minute") };
}

/* ── Multi-tenant scoping ───────────────────────────────────────────────────
   Same conditional rule as lib/email-config.ts: company_id is nullable and, on
   installs that never ran the backfill, is NULL everywhere. Filtering
   unconditionally would return an empty feed and look like "no group visits". */

export function scopeToCompany<T extends { company_id?: number | string | null }>(
  rows: T[],
  companyId: number | string | null | undefined
): T[] {
  if (companyId === null || companyId === undefined) return rows;
  return rows.filter((r) => String(r.company_id ?? "") === String(companyId));
}