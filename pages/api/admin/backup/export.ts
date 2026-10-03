import { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";
import { guard } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";
import { BACKUP_TABLES, BACKUP_VERSION } from "@/lib/backup-manifest";

/* ============================================================================
   GET /api/admin/backup/export

   Dumps every table in lib/backup-manifest.ts as one JSON object. Replaces the
   four hand-rolled fetches the Backup page used to make, so a new table is
   covered by adding one line to the manifest instead of editing the page.

   Guarded by `can_manage_settings` — a backup is a full database read, which
   is the most sensitive thing this console can do.

   TWO THINGS THIS ROUTE DELIBERATELY DOES NOT DO
     · Never SELECT *. Columns are named in the manifest so a secret column
       added later cannot start leaking by default.
     · Never fail the whole export. A table that does not exist on this install
       is reported in `skipped` and the export continues, because losing the
       safety net is worse than losing one section of it.
   ========================================================================== */

/**
 * Why a table produced nothing.
 *
 * 42P01 / PGRST205 = the table itself is absent (migration not applied yet).
 * 42703 / PGRST204 = the table exists but a column in the manifest does not —
 *   a DRIFT between this file and the schema. That is a bug in the manifest and
 *   must not be reported to an admin as "table not installed", or they will go
 *   looking for a migration that does not need running.
 */
function describeFailure(message: string): { reason: string; drift: boolean } {
  if (/PGRST205|42P01|does not exist|relation .* does not exist/i.test(message)) {
    return { reason: "table does not exist on this install", drift: false };
  }
  if (/PGRST204|42703|column .* does not exist/i.test(message)) {
    return { reason: `SCHEMA DRIFT — manifest lists a column this table lacks: ${message}`, drift: true };
  }
  return { reason: message || "read failed", drift: false };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ success: false, message: "Method not allowed." });
  }

  if (!supabase) {
    return res.status(500).json({ success: false, message: "Database connection error." });
  }

  // A backup is a whole-database read; keep it to a sane cadence.
  if (!checkRateLimit(req, res, { limit: 6, windowMs: 60_000, scope: "backup-export" })) return;

  const admin = await guard(req, res, "can_manage_settings");
  if (!admin) return;

  // Tenant scoping: only export rows belonging to the caller's company. company_id
  // is nullable and NULL on an un-backfilled install, so those rows are kept —
  // an unscoped admin still gets a complete backup.
  const { data: me } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", admin.id)
    .maybeSingle();
  const companyId = (me?.company_id as number | string | null) ?? null;

  const data: Record<string, unknown[]> = {};
  const skipped: { table: string; reason: string }[] = [];
  const counts: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    let query = supabase
      .from(table.name)
      // Named columns, never "*" — see the header note.
      .select(table.columns.join(","))
      .limit(table.limit ?? 50_000);

    if (table.tenantScoped && companyId !== null) {
      // `.or()` rather than `.eq()`: company_id is NULL for un-backfilled rows
      // and those must still be captured or the backup is incomplete.
      query = query.or(`company_id.eq.${companyId},company_id.is.null`);
    }

    const { data: rows, error } = await query;

    if (error) {
      // A missing table is expected on installs behind a migration. A column
      // mismatch is NOT — that is manifest drift and gets logged loudly so it
      // gets fixed rather than silently leaving a section of the backup empty.
      const { reason, drift } = describeFailure(error.message || "");
      if (drift) {
        console.error(
          `[backup/export] SCHEMA DRIFT on "${table.name}": ${error.message}. ` +
            `Update lib/backup-manifest.ts to match the live columns.`
        );
      }
      skipped.push({ table: table.name, reason });
      data[table.name] = [];
      continue;
    }

    data[table.name] = rows || [];
    counts[table.name] = rows?.length ?? 0;
  }

  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);

  return res.status(200).json({
    success: true,
    export: {
      backup_version: BACKUP_VERSION,
      exported_at: new Date().toISOString(),
      exported_by: admin.email,
      company_id: companyId,
      total_rows: totalRows,
      tables_included: BACKUP_TABLES.length,
      tables_skipped: skipped.length,
      skipped,
      counts,
      // Redactions applied, recorded IN the file so whoever reads it later
      // knows those columns are absent by design and not by accident.
      redacted: {
        "users.Password": "bcrypt hashes are never exported",
        "email_config.resend_api_key_enc": "encrypted key is never exported; re-enter it after a restore",
        "api_keys.key_hash": "credential digest is never exported; re-issue keys after a restore",
      },
      data,
    },
  });
}