/* ============================================================================
   Schema guard
   ----------------------------------------------------------------------------
   Features 6–8 depend on tables this process cannot create (the app holds the
   publishable/anon key only — no service_role, no migration runner). Rather
   than let PostgREST surface a raw

       42P01  relation "public.api_keys" does not exist

   these helpers turn it into an actionable 503 naming the migration file.

   All three functions are non-destructive: they only read.
   ========================================================================== */

import type { NextApiRequest, NextApiResponse } from "next";
import { supabase } from "@/lib/supabase";

export const MIGRATION_FILE = "supabase/migrations/20260101_admin_platform.sql";

/**
 * Missing-table signals, in the forms actually observed against this project:
 *   PGRST205 — PostgREST "Could not find the table in the schema cache" (this
 *              is what api.biolog.ph's Supabase returns for an unknown table)
 *   42P01    — the underlying Postgres "undefined_table" error code
 */
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01", "42703"]);

export function isUndefinedTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code && MISSING_TABLE_CODES.has(e.code)) return true;
  return /does not exist|could not find the table|schema cache/i.test(
    String(e.message || "")
  );
}

/**
 * Respond 503 when the table isn't there yet, and tell the caller exactly what
 * to run. Returns true when it handled the response.
 */
export function missingTable(res: NextApiResponse, table: string): boolean {
  res.status(503).json({
    success: false,
    code: "SCHEMA_MIGRATION_REQUIRED",
    message:
      `The "${table}" table has not been created yet. Apply ${MIGRATION_FILE} in the Supabase SQL Editor, then retry.`,
    table,
    migration: MIGRATION_FILE,
  });
  return true;
}

/**
 * Cheap existence probe. A plain `select * limit 1` rather than
 * information_schema, so it works with the publishable key regardless of
 * grants. PGRST205 is Supabase's "table not in the schema cache" response.
 */
export async function tableExists(table: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from(table).select("*").limit(1);
    return !isUndefinedTable(error);
  } catch {
    return false;
  }
}

/** Convenience wrapper for a route handler's first statement. */
export async function requireTable(res: NextApiResponse, table: string): Promise<boolean> {
  if (await tableExists(table)) return true;
  return missingTable(res, table);
}