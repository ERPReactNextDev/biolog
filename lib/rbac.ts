/* ============================================================================
   RBAC — server-side role resolution
   ----------------------------------------------------------------------------
   Role decisions are made HERE, on the server, from the session cookie. The UI
   may hide things for convenience, but nothing is trusted: every admin route
   re-checks, because a hidden button is not an access control.

   Session chain (matches pages/api/check-session.ts):
     cookie "session" -> sessions.token -> sessions.userId -> users.id

   Why this exists: `pages/api/gps-report/update.ts` originally had NO
   authorization at all — any anonymous caller could approve or decline any
   GPS report and forge `reviewedBy`. Both that route and the admin user CRUD
   now call `requirePermission` before doing anything.
   ========================================================================== */

import { parse } from "cookie";
import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

/* ── Roles ──────────────────────────────────────────────────────────────────
   Compared case-insensitively and with whitespace collapsed, because the
   users table is hand-edited and "Super Admin" / "SuperAdmin" / "superadmin"
   all appear in real data. */

export const ROLE_SUPER_ADMIN = "Super Admin";
export const ROLE_ADMIN = "Admin";
export const ROLE_TSA = "Territory Sales Associate";

const norm = (s: string | null | undefined) => (s || "").trim().replace(/\s+/g, " ").toLowerCase();

export type SessionUser = {
  id: number | string;
  email: string;
  role: string;
  referenceId: string;
  department: string | null;
  /** Raw jsonb from users.permissions — shape varies by row, so read defensively. */
  permissions: Record<string, unknown> | null;
};

export type Permission =
  | "can_manage_users"
  | "can_manage_settings"
  | "can_view_reports"
  | "can_review_gps"
  | "can_review_ob"
  | "can_view_all"
  | "can_create_sales_attendance"
  | "can_lookup_clients"
  | "can_create_attendance";

/* ── Role predicates ─────────────────────────────────────────────────────── */

export function isSuperAdminRole(role: string | null | undefined): boolean {
  const r = norm(role);
  return r === "super admin" || r === "superadmin";
}

export function isAdminRole(role: string | null | undefined): boolean {
  const r = norm(role);
  return r === "admin" || r === "administrator" || r === "admin / it";
}

/** Manager — sees the whole team's data but not necessarily user management. */
export function isManagerRole(role: string | null | undefined): boolean {
  const r = norm(role);
  return r === "manager" || r === "sales manager" || r === "area manager";
}

/** True for anyone entitled to see every agent's records. */
export function canViewAll(user: SessionUser | null): boolean {
  if (!user) return false;
  return (
    isSuperAdminRole(user.role) ||
    isAdminRole(user.role) ||
    isManagerRole(user.role) ||
    permFlag(user, "can_view_all")
  );
}

/** Territory Sales Associate — the role that unlocks the sales attendance drawer. */
export function isTsaRole(role: string | null | undefined): boolean {
  return norm(role) === norm(ROLE_TSA);
}

/**
 * Approvers for Official Business Trip (ROBT) requests.
 *
 * The ROBT is reviewed by HRAD only. The paper form is also signed by the
 * employee and the Department Head, but the approval step goes straight to
 * HRAD, and COO approval for late filings is a later phase that is not granted
 * here yet.
 *
 * Matched case-insensitively and on whitespace-collapsed names, for the same
 * reason as the other predicates — the table is hand-edited and real data
 * contains "HRAD", "H.R.A.D.", "HR Admin" and "Human Resources".
 */
export function canReviewObRole(role: string | null | undefined): boolean {
  const r = norm(role).replace(/[./]/g, ""); // "h.r.a.d." -> "hrad"
  if (!r) return false;
  return (
    r === "hrad" ||
    r === "hr admin" ||
    r === "hr" ||
    r === "human resources" ||
    r === "human resources and administration division"
  );
}

/** Flag read from the users.permissions jsonb column, tolerant of odd shapes. */
function permFlag(user: SessionUser | null, key: string): boolean {
  return permFlagRaw(user, key) === true;
}

/**
 * TRI-STATE flag read: true / false / undefined(never set).
 *
 * Needed where an admin's explicit choice must be able to say "no" as well as
 * "yes". `permFlag` collapses an absent key and `false` to the same value, so it
 * cannot express "the admin chose basic over sales" — which is exactly the
 * attendance-drawer decision in the Users screen.
 */
export function permFlagRaw(
  user: SessionUser | null,
  key: string
): boolean | undefined {
  const p = user?.permissions;
  if (!p || typeof p !== "object") return undefined;
  if (!Object.prototype.hasOwnProperty.call(p, key)) return undefined;

  const v = (p as Record<string, unknown>)[key];
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  return undefined;
}

/**
 * Effective permission check. Super Admin and Admin pass everything; otherwise
 * the users.permissions jsonb column decides.
 */
export function hasPermission(user: SessionUser | null, perm: Permission): boolean {
  if (!user) return false;
  if (isSuperAdminRole(user.role) || isAdminRole(user.role)) return true;

  switch (perm) {
    case "can_manage_users":
      return permFlag(user, "can_manage_users");
    case "can_manage_settings":
      return permFlag(user, "can_manage_settings");
    case "can_view_reports":
      return permFlag(user, "can_view_reports");
    case "can_view_all":
      // Team-wide visibility: everyone else's attendance, site visits and
      // timesheets. Granted to Super Admin / Admin / Manager, or by flag.
      return isManagerRole(user.role) || permFlag(user, "can_view_all");
    case "can_review_gps":
      return permFlag(user, "can_review_gps");
    case "can_review_ob":
      // HRAD is the approver; Super Admin and Admin already returned true above.
      return canReviewObRole(user.role) || permFlag(user, "can_review_ob");
    case "can_create_sales_attendance": {
      // An admin's explicit choice in Admin -> Users WINS, in both directions.
      // Only when they have never touched it does the role decide (a TSA gets
      // the sales drawer by default). Previously the role was OR-ed in, so a
      // TSA could not be moved onto the basic drawer at all.
      const explicit = permFlagRaw(user, "can_create_sales_attendance");
      if (explicit !== undefined) return explicit;
      return isTsaRole(user.role);
    }
    case "can_lookup_clients":
      // Only meaningful for the sales drawer. Defaults to ON so existing
      // sales users keep the New/Existing client picker until told otherwise.
      return permFlagRaw(user, "can_lookup_clients") ?? true;
    case "can_create_attendance":
      /* Everyone signed in can log attendance; an explicit deny still wins.

         This MUST be the tri-state read. The old boolean version collapsed an
         ABSENT key to false, so `false !== false` denied every user who had
         never been explicitly granted or denied — and /api/attendance/drawer
         answered 403 for the whole install. */
      return permFlagRaw(user, "can_create_attendance") !== false;
    default:
      return false;
  }
}

/* ── Session lookup ──────────────────────────────────────────────────────── */

/**
 * Resolves the signed-in user from the session cookie.
 * Returns null for missing/invalid/expired sessions. Never throws.
 */
export async function getSessionUser(req: NextApiRequest): Promise<SessionUser | null> {
  if (!supabase) return null;

  const cookies = parse(req.headers.cookie || "");
  const token = cookies.session;
  if (!token) return null;

  /* `select("*")` on purpose. Naming the columns here once caused a 401 for
     every signed-in user: the sessions table has no `expiresAt` column, and
     PostgREST rejects the ENTIRE query when one selected column is unknown —
     so the guard failed closed and logged everybody out of the admin API even
     though /api/check-session (which uses select("*")) said the session was
     fine. Expiry, if the table ever grows it, is read defensively below. */
  const { data: session, error: sessionErr } = await supabase
    .from("sessions")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (sessionErr || !session) return null;

  // Honour an expiry column only if one actually exists on the row.
  const expiresAt = (session as { expiresAt?: unknown }).expiresAt;
  if (typeof expiresAt === "string" && expiresAt) {
    const exp = new Date(expiresAt).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) return null;
  }

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select('id, "Email", "Role", "ReferenceID", "Department", permissions')
    .eq("id", session.userId)
    .maybeSingle();

  if (userErr || !user) return null;

  return {
    id: user.id,
    email: user.Email || "",
    role: user.Role || "",
    referenceId: user.ReferenceID || "",
    department: user.Department || null,
    permissions: (user.permissions as Record<string, unknown>) || null,
  };
}

/* ── Route guards ────────────────────────────────────────────────────────── */

/** 401 when there is no valid session. */
export function requireSession(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<SessionUser | null> {
  return getSessionUser(req).then((user) => {
    if (!user) {
      res.status(401).json({ success: false, message: "Sign in to continue." });
      return null;
    }
    return user;
  });
}

/**
 * 403 when the session lacks `perm`. Call AFTER requireSession and inside the
 * same request so the user is only looked up once.
 */
export function requirePermission(
  user: SessionUser | null,
  res: NextApiResponse,
  perm: Permission
): boolean {
  if (hasPermission(user, perm)) return true;
  res.status(403).json({
    success: false,
    message: "You do not have permission to do that.",
  });
  return false;
}

/**
 * Convenience for the common `requireUser` + permission check in one call.
 * Returns the user, or null after having already written the response.
 */
export async function guard(
  req: NextApiRequest,
  res: NextApiResponse,
  perm: Permission
): Promise<SessionUser | null> {
  const user = await requireSession(req, res);
  if (!user) return null;
  if (!requirePermission(user, res, perm)) return null;
  return user;
}

/**
 * Which attendance drawer this role is allowed to open. The client asks before
 * rendering, so the correct form is chosen even if the UI guesses wrong — and
 * the matching POST route refuses anything else.
 */
export function attendanceDrawerFor(user: SessionUser | null): "sales" | "basic" {
  if (user && hasPermission(user, "can_create_sales_attendance")) return "sales";
  return "basic";
}

/**
 * May this user pick/search a client in the sales attendance drawer?
 *
 * Defaults to true when the admin has never set it, so turning the toggle off
 * is always an explicit act and existing sales users are unaffected. Only
 * consulted when the drawer is "sales" — the basic drawer has no client field.
 */
export function canLookupClientsFor(user: SessionUser | null): boolean {
  return user ? hasPermission(user, "can_lookup_clients") : false;
}

/* ── Account lockout ─────────────────────────────────────────────────────── */

export const MAX_LOGIN_ATTEMPTS = 5;

/**
 * An account is locked once attempts reach the threshold and either no
 * LockUntil is set or it is still in the future.
 */
export function isAccountLocked(user: {
  LoginAttempts?: number | null;
  LockUntil?: string | null;
}): boolean {
  const attempts = Number(user.LoginAttempts ?? 0);
  if (attempts < MAX_LOGIN_ATTEMPTS) return false;
  if (!user.LockUntil) return true;
  const until = new Date(user.LockUntil).getTime();
  if (Number.isNaN(until)) return true;
  return until > Date.now();
}

/** Human label for the admin table's Status column. */
export function accountStateLabel(user: {
  Status?: string | null;
  LoginAttempts?: number | null;
  LockUntil?: string | null;
}): "Active" | "Inactive" | "Locked" {
  if (isAccountLocked(user)) return "Locked";
  if ((user.Status || "").trim().toLowerCase() !== "active") return "Inactive";
  return "Active";
}