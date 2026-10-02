/* ============================================================================
   In-app notifications
   ----------------------------------------------------------------------------
   One row per recipient — never a shared "broadcast" row — so an unread count
   can never leak one person's queue into another's.

   SCOPE RIGHT NOW
     ob_submitted → reviewers (one row per reviewer), drives the ADMIN bell
     ob_approved / ob_declined → the submitting agent, drives the AGENT bell
     gps_reviewed → reserved, unused today

   The admin bell deliberately shows ONLY ob_submitted, per the spec. The
   `types` filter on listFor() is the single place that decides this, so adding
   a second type to the bell later is a one-line change.
   ========================================================================== */

import { supabase } from "./supabase";
import { isSuperAdminRole, isAdminRole, canReviewObRole } from "./rbac";
import type { ObRequest } from "./ob-requests";

export type NotificationType =
  | "ob_approved"
  | "ob_declined"
  | "ob_submitted"
  | "gps_reviewed"
  | "group_visit";

export type AppNotification = {
  id: number | string;
  ReferenceID: string;
  type: NotificationType;
  title: string;
  message: string | null;
  link_url: string | null;
  thumb_url: string | null;
  meta: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
};

/** What the ADMIN bell shows. OB approvals only, for now. */
export const ADMIN_BELL_TYPES: NotificationType[] = ["ob_submitted"];

/**
 * What the AGENT bell shows.
 *
 * group_visit is included so an agent learns about a team visit they are
 * eligible for. It is NOT in ADMIN_BELL_TYPES, so group visits never appear in
 * the admin's OB approvals queue.
 */
export const AGENT_BELL_TYPES: NotificationType[] = [
  "ob_approved",
  "ob_declined",
  "group_visit",
];

/* ── Writing ─────────────────────────────────────────────────────────────── */

type NotifyInput = {
  referenceId: string;
  type: NotificationType;
  title: string;
  message?: string | null;
  linkUrl?: string | null;
  thumbUrl?: string | null;
  meta?: Record<string, unknown>;
  companyId?: number | string | null;
};

export async function insertNotification(input: NotifyInput): Promise<boolean> {
  if (!supabase || !input.referenceId) return false;

  const { error } = await supabase.from("notifications").insert({
    ReferenceID: input.referenceId,
    type: input.type,
    title: input.title.slice(0, 200),
    message: (input.message || "").slice(0, 500) || null,
    link_url: input.linkUrl || null,
    thumb_url: input.thumbUrl || null,
    meta: input.meta || {},
    is_read: false,
    created_at: new Date().toISOString(),
    company_id: input.companyId ?? null,
  });

  if (error) {
    // A failed bell insert must never fail the surrounding action — the record
    // is already saved and the email is the channel that matters most.
    console.error("[notifications] insert failed:", error);
    return false;
  }
  return true;
}

/**
 * Fan a notification out to every OB reviewer.
 *
 * The schema has no audience column, so this resolves the recipient list by
 * role and inserts one row each. Roles are filtered in JS with the same
 * predicates the API uses, so a reviewer who can open the queue is exactly a
 * reviewer who gets the bell.
 */
export async function notifyObReviewers(input: {
  title: string;
  message?: string | null;
  linkUrl?: string | null;
  thumbUrl?: string | null;
  meta?: Record<string, unknown>;
  companyId?: number | string | null;
}): Promise<number> {
  if (!supabase) return 0;

  const { data, error } = await supabase
    .from("users")
    .select('"ReferenceID", "Role"')
    .limit(2000);

  if (error || !Array.isArray(data)) {
    console.error("[notifications] could not resolve reviewers:", error);
    return 0;
  }

  const reviewers = data.filter((u) => {
    const role = (u as { Role?: string }).Role;
    return isSuperAdminRole(role) || isAdminRole(role) || canReviewObRole(role);
  });

  let sent = 0;
  for (const r of reviewers) {
    const ref = (r as { ReferenceID?: string }).ReferenceID;
    if (!ref) continue;
    // eslint-disable-next-line no-await-in-loop
    const ok = await insertNotification({
      referenceId: ref,
      type: "ob_submitted",
      companyId: input.companyId,
      ...input,
    });
    if (ok) sent += 1;
  }
  return sent;
}

/* ── A new OB request: reviewer bell + HRAD email ─────────────────────────── */

export type ObSubmitNotifyResult = {
  email: { attempted: boolean; sent: boolean; error?: string; recipients: string[] };
  notifiedReviewers: number;
};

/**
 * Side effects for a freshly filed OB request. Called from the create route
 * AFTER the row is committed, so a mail failure can never lose the request.
 *
 * Everything here is best effort: the caller logs the outcome onto the row's
 * EmailStatus columns and still returns 201 to the agent.
 */
export async function onObSubmitted(
  row: ObRequest,
  ctx: { companyId: number | string | null; appUrl: string }
): Promise<ObSubmitNotifyResult> {
  const result: ObSubmitNotifyResult = {
    email: { attempted: false, sent: false, recipients: [] },
    notifiedReviewers: 0,
  };

  const photos = Array.isArray(row.PhotoURL)
    ? (row.PhotoURL as string[]).filter((u) => typeof u === "string")
    : [];

  // ── In-app bell for reviewers (always on; not an email preference) ──────
  try {
    result.notifiedReviewers = await notifyObReviewers({
      title: `New OB request — ${row.Name || row.ReferenceID}`,
      message: [
        row.Destination || "Destination not stated",
        row.IsLateFiling ? "Late filing" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      linkUrl: "/admin/ob-approvals",
      thumbUrl: photos[0] || null,
      meta: {
        obRequestId: row.id,
        destination: row.Destination || "",
        isLateFiling: Boolean(row.IsLateFiling),
        referenceId: row.ReferenceID,
      },
      companyId: ctx.companyId,
    });
  } catch (err) {
    console.warn("[notifications] reviewer fan-out threw:", err);
  }

  // ── Email to HRAD (opt-in via auto_send_on_ob) ──────────────────────────
  try {
    const { loadEmailConfig, resolveApiKey, renderObTemplate, toSafeConfig } = await import(
      "@/lib/email-config"
    );
    const config = await loadEmailConfig(ctx.companyId);
    const safe = toSafeConfig(config);

    if (!safe.is_active) return result;
    if (!safe.auto_send_on_ob) return result;

    const recipients = safe.ob_recipients;
    if (recipients.length === 0) {
      result.email.error = "No HRAD recipients configured";
      return result;
    }

    const apiKey = await resolveApiKey(ctx.companyId);

    const vars = {
      Name: row.Name,
      Position: row.Position,
      Department: row.Department,
      Destination: row.Destination,
      DateOfOB: row.DateOfOB,
      Purpose: row.PurposeOfTravel,
      ReferenceID: row.ReferenceID,
    };

    const { sendObSubmittedEmail } = await import("@/lib/emails");
    const sent = await sendObSubmittedEmail(
      recipients,
      {
        Name: row.Name || row.ReferenceID,
        Position: row.Position,
        Department: row.Department,
        Destination: row.Destination,
        DateOfOB: row.DateOfOB,
        Purpose: row.PurposeOfTravel,
        ReferenceID: row.ReferenceID,
        IsLateFiling: Boolean(row.IsLateFiling),
        Justification: row.Justification,
        intro: renderObTemplate(safe.ob_body_template, vars),
        photos,
        reviewUrl: `${ctx.appUrl.replace(/\/$/, "")}/admin/ob-approvals`,
      },
      renderObTemplate(safe.ob_subject_template, vars),
      { apiKey, senderEmail: safe.sender_email, senderName: safe.sender_name }
    );

    result.email.attempted = true;
    result.email.recipients = recipients;
    result.email.sent = sent.ok;
    if (!sent.ok) result.email.error = sent.error;
  } catch (err: any) {
    console.warn("[emails] ob submit notification failed:", err);
    result.email.attempted = true;
    result.email.sent = false;
    result.email.error = err?.message || "Unknown error";
  }

  return result;
}

/* ── A decision on an OB request: agent bell ─────────────────────────────── */

export async function onObReviewed(row: {
  id: number | string;
  ReferenceID: string;
  Name?: string | null;
  Destination?: string | null;
  Status?: string | null;
  ReviewNotes?: string | null;
  ReviewedBy?: string | null;
}): Promise<void> {
  const approved = row.Status === "Approved";
  const destination = row.Destination?.trim() || "your OB request";

  try {
    await insertNotification({
      referenceId: row.ReferenceID,
      type: approved ? "ob_approved" : "ob_declined",
      title: approved
        ? `Your OB request to ${destination} was approved`
        : `Your OB request to ${destination} was declined`,
      message: row.ReviewNotes?.trim() || null,
      linkUrl: "/ob-request",
      meta: {
        obRequestId: row.id,
        destination: row.Destination || "",
        status: row.Status || "",
        reviewedBy: row.ReviewedBy || "",
      },
    });
  } catch (err) {
    console.warn("[notifications] agent bell insert threw:", err);
  }
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

export async function listFor(
  referenceId: string,
  types: NotificationType[],
  limit = 40
): Promise<{ items: AppNotification[]; unread: number }> {
  if (!supabase || !referenceId) return { items: [], unread: 0 };

  let q = supabase
    .from("notifications")
    .select("*")
    .eq("ReferenceID", referenceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  // An empty type list would match nothing under .in(); treat it as "no filter".
  if (types.length) q = q.in("type", types);

  const { data, error } = await q;

  if (error) {
    console.error("[notifications] list error:", error);
    return { items: [], unread: 0 };
  }

  const items = (data || []) as AppNotification[];
  return { items, unread: items.filter((n) => !n.is_read).length };
}

/**
 * Mark read. Omitting `id` marks all of the caller's notifications read, which
 * is what the dropdown footer does. Both paths are scoped to ReferenceID, so a
 * crafted id can only ever touch the caller's own rows.
 */
export async function markRead(
  referenceId: string,
  id?: number | string | null
): Promise<number> {
  if (!supabase || !referenceId) return 0;

  let q = supabase
    .from("notifications")
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("ReferenceID", referenceId)
    .eq("is_read", false);

  if (id !== undefined && id !== null && id !== "") q = q.eq("id", id);

  const { data, error } = await q.select("id");
  if (error) {
    console.error("[notifications] markRead error:", error);
    return 0;
  }
  return Array.isArray(data) ? data.length : 0;
}

/** Unread count only — cheaper than listFor() for the badge poll. */
export async function unreadCount(
  referenceId: string,
  types: NotificationType[]
): Promise<number> {
  if (!supabase || !referenceId) return 0;

  let q = supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("ReferenceID", referenceId)
    .eq("is_read", false);

  if (types.length) q = q.in("type", types);

  const { count, error } = await q;
  if (error) return 0;
  return count || 0;
}