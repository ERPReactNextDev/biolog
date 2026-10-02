import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard, canViewAll } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/admin/analytics?range=month|last_month|last_30|custom&from&to
 *
 * Feeds the Reports tab (per-agent attendance) and the Timesheet tab
 * (weekly hours grid).
 *
 * ── SCHEMA NOTE ────────────────────────────────────────────────────────────
 * The addendum's SQL referenced `public.attendance_logs`. That table does not
 * exist — attendance and site visits both live in `public.tasklog`, separated
 * by `Type` ("On Field" for the shift, "Client Visit" for client work) and
 * `Status` ("Login" / "Logout"). Everything below reads tasklog. No tables were
 * created or renamed.
 */

const COLUMNS =
  'id, "ReferenceID", "Email", "Type", "Status", date_created, "Location", "Latitude", "Longitude"';

/** Inclusive day bounds for a named range. */
function rangeOf(key: string, from?: string, to?: string) {
  const now = new Date();
  const mk = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOf = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  if (key === "custom" && from && to) return { start: mk(new Date(from)), end: endOf(new Date(to)) };
  if (key === "last_month") {
    const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { start: mk(s), end: endOf(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  if (key === "last_30") {
    const s = new Date(now);
    s.setDate(s.getDate() - 29);
    return { start: mk(s), end: endOf(now) };
  }
  // default: this month
  return { start: mk(new Date(now.getFullYear(), now.getMonth(), 1)), end: endOf(now) };
}

const dayKey = (d: string | Date) => new Date(d).toISOString().slice(0, 10);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const user = await guard(req, res, "can_view_all");
  if (!user) return;

  if (!checkRateLimit(req, res, { limit: 90, windowMs: 60_000, scope: "admin-analytics" })) {
    return;
  }

  if (!supabase) {
    return res.status(500).json({ success: false, message: "Database connection error" });
  }

  const teamWide = canViewAll(user);
  const scopeRef = teamWide ? String(req.query.referenceId || "").trim() : user.referenceId;

  const { start, end } = rangeOf(
    String(req.query.range || "month"),
    req.query.from ? String(req.query.from) : undefined,
    req.query.to ? String(req.query.to) : undefined
  );

  try {
    let query = supabase
      .from("tasklog")
      .select(COLUMNS)
      .gte("date_created", start.toISOString())
      .lte("date_created", end.toISOString())
      .limit(5000);

    if (scopeRef) query = query.eq("ReferenceID", scopeRef);

    const { data: logs, error } = await query;
    if (error) throw error;
    const rows = (logs || []) as any[];

    // ── Agents in scope ─────────────────────────────────────────────────────
    let uq = supabase
      .from("users")
      .select('"ReferenceID", "Firstname", "Lastname", "Email", "Department", "TSM", "Manager", "Status"')
      .limit(2000);
    if (scopeRef) uq = uq.eq("ReferenceID", scopeRef);
    const { data: users } = await uq;

    const activeRefs = new Set(rows.map((r) => r.ReferenceID));
    const agents = (users || []).filter(
      (u: any) => teamWide || u.ReferenceID === user.referenceId
    );

    const byRef: Record<string, any> = {};
    for (const a of agents as any[]) byRef[a.ReferenceID] = a;
    // Include anyone who logged but isn't in the users page range.
    for (const ref of activeRefs) {
      if (!byRef[ref]) byRef[ref] = { ReferenceID: ref, Firstname: "", Lastname: "", Department: "" };
    }

    // ── Per-agent aggregation ───────────────────────────────────────────────
    const days = eachDay(start, end);

    const perAgent = (agents as any[])
      .map((a: any) => {
        const mine = rows.filter((r) => r.ReferenceID === a.ReferenceID);
        const shiftRows = mine.filter((r) => String(r.Type) !== "Client Visit");
        const visits = mine.filter((r) => String(r.Type) === "Client Visit").length;

        // Present = distinct days with a shift Login.
        const presentDays = new Set(
          shiftRows.filter((r) => r.Status === "Login").map((r) => dayKey(r.date_created))
        ).size;
        const absentDays = Math.max(0, days.length - presentDays);

        const rate = days.length ? (presentDays / days.length) * 100 : 0;

        // Weekly grid: hours per day from the first Login to the first Logout.
        const grid: Record<string, number> = {};
        for (const d of days) grid[d] = 0;
        const byDay: Record<string, any[]> = {};
        for (const r of shiftRows) {
          const k = dayKey(r.date_created);
          (byDay[k] ||= []).push(r);
        }
        let totalHours = 0;
        let lateCount = 0;
        for (const [k, list] of Object.entries(byDay)) {
          const sorted = [...list].sort(
            (x, y) => new Date(x.date_created).getTime() - new Date(y.date_created).getTime()
          );
          const inAt = sorted.find((r) => r.Status === "Login");
          const outAt = [...sorted].reverse().find((r) => r.Status === "Logout");
          if (inAt && outAt) {
            const hrs =
              (new Date(outAt.date_created).getTime() - new Date(inAt.date_created).getTime()) /
              36e5;
            const clean = Math.max(0, Math.min(24, hrs));
            grid[k] = clean;
            totalHours += clean;
          } else if (inAt) {
            // Clock-in with no matching clock-out — counted as 0h so the UI can
            // flag it rather than silently inflating the total.
            grid[k] = 0;
          }
        }
        // Late = shift Login after 09:00 (config-free heuristic; the shift
        // start lives in system_settings and is not read here).
        for (const r of shiftRows) {
          if (r.Status !== "Login") continue;
          const h = new Date(r.date_created).getHours();
          if (h >= 9) lateCount++;
        }

        return {
          referenceId: a.ReferenceID,
          firstname: a.Firstname || "",
          lastname: a.Lastname || "",
          email: a.Email || "",
          department: a.Department || "",
          tsm: a.TSM || "",
          manager: a.Manager || "",
          presentDays,
          absentDays,
          visits,
          attendanceRate: Math.round(rate * 10) / 10,
          totalHours: Math.round(totalHours * 10) / 10,
          lateCount,
          grid,
        };
      })
      .sort((x, y) => y.attendanceRate - x.attendanceRate);

    const withData = perAgent.filter((a) => a.presentDays > 0 || a.visits > 0);
    const avgPresent = withData.length
      ? Math.round(
          (withData.reduce((s, a) => s + a.attendanceRate, 0) / withData.length) * 10
        ) / 10
      : 0;
    const avgAbsent = Math.round((100 - avgPresent) * 10) / 10;
    const totalVisits = perAgent.reduce((s, a) => s + a.visits, 0);
    const activeAgents = perAgent.filter((a) => a.presentDays > 0).length;

    return res.status(200).json({
      success: true,
      range: { key: String(req.query.range || "month"), from: start.toISOString(), to: end.toISOString() },
      days,
      agents: perAgent,
      totals: {
        avgPresent,
        avgAbsent,
        totalVisits,
        activeAgents,
        totalAgents: perAgent.length,
        totalHours: Math.round(perAgent.reduce((s, a) => s + a.totalHours, 0) * 10) / 10,
        totalLate: perAgent.reduce((s, a) => s + a.lateCount, 0),
        belowTen: perAgent.filter((a) => a.attendanceRate < 10 && a.attendanceRate > 0).length,
        zeroRate: perAgent.filter((a) => a.attendanceRate === 0).length,
      },
      scope: teamWide ? "team" : "self",
      teamWide,
    });
  } catch (err: any) {
    console.error("[admin/analytics] error:", err);
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Could not build the report." });
  }
}

function eachDay(start: Date, end: Date): string[] {
  const out: string[] = [];
  const d = new Date(start);
  while (d <= end) {
    out.push(dayKey(d));
    d.setDate(d.getDate() + 1);
  }
  // A single-day range still needs at least one column.
  return out.length ? out : [dayKey(start)];
}