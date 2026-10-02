import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard, canViewAll } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/admin/activity
 * query: ?from=ISO&to=ISO&type=all|login|logout|site_visit|meeting&q=text
 *        &referenceId=<exact>  (non-admin self-scope)
 *
 * ── SCHEMA NOTE ────────────────────────────────────────────────────────────
 * The addendum specified `public.site_visits` and `public.attendance_logs`.
 * Neither table exists in this project. Attendance and client visits are both
 * written to **`public.tasklog`** (see pages/api/ModuleSales/Activity/AddLog.ts),
 * distinguished by the `Type` column:
 *
 *   Clock In / Clock Out  Type = "On Field"      Status = Login / Logout
 *   Time In  / Time Out   Type = "Client Visit"  Status = Login / Logout
 *   Meeting               public.meetings
 *
 * So this route unions tasklog + meetings rather than querying the two table
 * names from the spec. No tables were created or renamed.
 */

const LOG_COLUMNS =
  'id, "ReferenceID", "Email", "Type", "Status", "Remarks", "TSM", "Manager", date_created, "SiteVisitAccount", "Location", "Latitude", "Longitude", "PhotoURL"';

type LogRow = Record<string, any>;

function startOfRange(from?: string, to?: string) {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = to ? new Date(to) : now;
  // Inclusive whole days.
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const user = await guard(req, res, "can_view_all");
  if (!user) return;

  if (!checkRateLimit(req, res, { limit: 120, windowMs: 60_000, scope: "admin-activity" })) {
    return;
  }

  if (!supabase) {
    return res.status(500).json({ success: false, message: "Database connection error" });
  }

  // Team-wide by default. Without can_view_all a caller can only ever read
  // their own rows — enforced here, not in the UI.
  const teamWide = canViewAll(user);
  const requestedRef = String(req.query.referenceId || "").trim();
  const scopeRef = teamWide ? requestedRef : user.referenceId;

  const { start, end } = startOfRange(
    req.query.from ? String(req.query.from) : undefined,
    req.query.to ? String(req.query.to) : undefined
  );

  const filter = String(req.query.type || "all").toLowerCase();
  const search = String(req.query.q || "").trim().toLowerCase();

  try {
    let query = supabase
      .from("tasklog")
      .select(LOG_COLUMNS)
      .gte("date_created", start.toISOString())
      .lte("date_created", end.toISOString())
      .order("date_created", { ascending: false })
      .limit(1000);

    if (scopeRef) query = query.eq("ReferenceID", scopeRef);

    // Type mapping — the addendum's chips are Login / Logout / Site Visit /
    // Meeting, but Login+Logout are a *Status* on two different Types.
    const FIELD = "Type";
    if (filter === "login") query = query.eq("Status", "Login").neq(FIELD, "Client Visit");
    else if (filter === "logout") query = query.eq("Status", "Logout").neq(FIELD, "Client Visit");
    else if (filter === "site_visit") query = query.eq(FIELD, "Client Visit");
    else if (filter === "meeting") query = query.eq(FIELD, "Meeting");

    const { data: logs, error } = await query;
    if (error) throw error;

    // Meetings live in their own table.
    let meetings: LogRow[] = [];
    if (filter === "all" || filter === "meeting") {
      let mq = supabase
        .from("meetings")
        .select("*")
        .order("StartDate", { ascending: false })
        .limit(500);
      if (scopeRef) mq = mq.eq("ReferenceID", scopeRef);
      const { data: mData } = await mq;
      meetings = (mData || []) as LogRow[];
    }

    // Names for the "who did it" column.
    const refs = new Set<string>();
    for (const r of [...(logs || []), ...meetings]) {
      const ref = r.ReferenceID;
      if (ref) refs.add(ref);
    }
    const { data: people } = await supabase
      .from("users")
      .select('"ReferenceID", "Firstname", "Lastname", "Email", "Department", "profilePicture"')
      .in("ReferenceID", refs.size ? Array.from(refs) : ["__none__"]);

    const byRef: Record<string, any> = {};
    for (const p of people || []) byRef[p.ReferenceID] = p;

    // Merge into one ordered activity list.
    const activity = [
      ...(logs || []).map((l: LogRow) => ({ kind: "log" as const, row: l })),
      ...meetings.map((m: LogRow) => ({ kind: "meeting" as const, row: m })),
    ]
      .map(({ kind, row }) => {
        const ts = kind === "meeting" ? row.StartDate || row.date_created : row.date_created;
        const person = byRef[row.ReferenceID] || null;
        return {
          id: String(kind === "meeting" ? row._id || row.id : row.id),
          kind,
          referenceId: row.ReferenceID || "",
          firstname: person?.Firstname || "",
          lastname: person?.Lastname || "",
          email: person?.Email || row.Email || "",
          department: person?.Department || "",
          profilePicture: person?.profilePicture || null,
          activityType: classify(kind, row),
          timestamp: ts || null,
          location: row.Location || row.Venue || "",
          latitude: row.Latitude ?? null,
          longitude: row.Longitude ?? null,
          clientType: row.SiteVisitAccount || "",
          photo: firstPhoto(row.PhotoURL),
          photos: photoList(row.PhotoURL),
          remarks: row.Remarks || row.Description || "",
        };
      })
      .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
      .filter((a) => {
        if (!search) return true;
        return (
          `${a.firstname} ${a.lastname}`.toLowerCase().includes(search) ||
          (a.email || "").toLowerCase().includes(search) ||
          (a.location || "").toLowerCase().includes(search) ||
          (a.referenceId || "").toLowerCase().includes(search)
        );
      });

    const totals = {
      all: activity.length,
      login: activity.filter((a) => a.activityType === "Login").length,
      logout: activity.filter((a) => a.activityType === "Logout").length,
      site_visit: activity.filter((a) => a.activityType === "Site Visit").length,
      meeting: activity.filter((a) => a.activityType === "Meeting").length,
    };

    return res.status(200).json({
      success: true,
      activity,
      totals,
      scope: teamWide ? (scopeRef ? scopeRef : "team") : "self",
      teamWide,
      range: { from: start.toISOString(), to: end.toISOString() },
    });
  } catch (err: any) {
    console.error("[admin/activity] error:", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Could not load activity." });
  }
}

/** One word for the Activity Type column, per the addendum's chips. */
function classify(kind: "log" | "meeting", row: LogRow): string {
  if (kind === "meeting") return "Meeting";
  const type = String(row.Type || "");
  if (type === "Client Visit") return "Site Visit";
  if (type === "Meeting") return "Meeting";
  return row.Status === "Login" ? "Login" : "Logout";
}

/** PhotoURL is jsonb on some tables and text on others — normalise. */
function photoList(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t || t === "[]") return [];
    if (t.startsWith("[")) {
      try {
        return photoList(JSON.parse(t));
      } catch {
        return [t];
      }
    }
    return [t];
  }
  if (Array.isArray(raw)) {
    return raw.map((v) => (typeof v === "string" ? v : (v as { url?: string })?.url || "")).filter(Boolean);
  }
  const url = (raw as { url?: string })?.url;
  return url ? [url] : [];
}

function firstPhoto(raw: unknown): string {
  return photoList(raw)[0] || "";
}