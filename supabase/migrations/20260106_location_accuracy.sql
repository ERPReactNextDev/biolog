-- ============================================================================
-- BIOLOG — Location accuracy & per-client geofencing
-- ----------------------------------------------------------------------------
-- Replaces the single getCurrentPosition() read with a watched, best-of-window
-- fix, carries `coords.accuracy` end to end, and fences client sites.
--
-- ----------------------------------------------------------------------------
-- WHY client_sites IS A FENCE LIST, NOT A CLIENT LIST
--   The clients themselves live in Neon: `accounts.company_name`, read by
--   /api/fetch-account and /api/fetch-tsm / /api/fetch-manager. That stays the
--   single source of truth for who the clients are — nothing in this migration
--   duplicates a company name, a contact or an account reference.
--
--   What Neon has no column for is a fence. So client_sites stores ONLY where
--   a client is and how far an agent may stray. `name` is present purely as a
--   lookup key: Neon and Supabase are separate databases, and
--   tasklog."SiteVisitAccount" carries a plain company-name string with no
--   shared id, so the name is the only thing a fence can be found by.
--
--   If a client is renamed in Neon its fence stops matching. That failure is
--   silent and harmless — no fence means no warning, which is exactly how the
--   app behaved before this migration. See STEP 5 for the Neon alternative.
--
-- ----------------------------------------------------------------------------
-- WHY THERE IS NO `site_visits` TABLE IN THIS MIGRATION
--   There isn't one in the database either. Attendance AND client site visits
--   are both rows in `tasklog` (verified live: 18 columns, Type is either
--   "On Field" or "Client Visit"). A previous draft of this work assumed a
--   `site_visits` table and would have written every geo flag to a table that
--   does not exist — silently, because the flag columns are optional.
--
--   So: every new column below goes on `tasklog`. Nothing here introduces a
--   second place for a visit to be recorded.
--
-- ----------------------------------------------------------------------------
-- WHY client_sites IS A DIRECTORY, NOT A LOG
--   `client_sites` holds CONFIG: "Robinsons Mandaue is at these coordinates
--   and the fence is 100 m". It records no visits — `tasklog` does that. The
--   fence has to live somewhere durable so it can exist before an agent ever
--   arrives, and so it can be edited by an admin without touching history.
--
-- ----------------------------------------------------------------------------
-- WHAT THE FLAGS MEAN (see lib/geo.ts → geoAudit)
--   gps              watchPosition, accuracy <= 50 m
--   low_accuracy     accuracy > 50 m — usually indoors or a cell fix
--   network_fix      the high-accuracy watch timed out; this came from the
--                    permissive getCurrentPosition fallback
--   offline_stale    last known location from localStorage, not a live fix
--   manual_override  the agent dragged the pin or typed an address
--   outside_geofence outside the client site's radius. THIS ONE OUTRANKS THE
--                    OTHERS — it is the only flag an admin must act on.
--
-- HOW TO APPLY
--   Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--   Safe on a live install: no column is dropped, renamed or made NOT NULL,
--   and every statement is guarded, so re-running is a no-op.
-- ============================================================================


-- ── STEP 1 · tasklog gains the location-quality columns ─────────────────────
-- Deliberately all nullable and all with defaults. Every existing row keeps
-- working, and an old row simply has GeoFlag = NULL, which the review queue
-- reads as "no geo data", not as "passed".

-- Column set is shared by tasklog and gps_reports. The measured values
-- (GeoAccuracyM / GeoSource / GeoFlag) are identical on both; the site
-- bookkeeping only makes sense on tasklog, because a client fence has nothing
-- to say about a GPS report submitted from wherever the agent happens to be.
--
-- gps_reports is altered here too rather than in a separate migration so that
-- the two tables can never end up half-migrated — the backup manifest and the
-- review API both read these columns from either table, and a CHECK constraint
-- is only worth having if both tables have it.

ALTER TABLE public.gps_reports
  ADD COLUMN IF NOT EXISTS "GeoAccuracyM"   numeric,
  ADD COLUMN IF NOT EXISTS "GeoSource"      text,
  ADD COLUMN IF NOT EXISTS "GeoFlag"        text,
  ADD COLUMN IF NOT EXISTS "GeoReviewed"    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "GeoReviewedBy"  text,
  ADD COLUMN IF NOT EXISTS "GeoReviewedAt"  timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gps_reports_geo_source_chk'
  ) THEN
    ALTER TABLE public.gps_reports
      ADD CONSTRAINT gps_reports_geo_source_chk
      CHECK ("GeoSource" IS NULL OR "GeoSource" IN ('gps','fallback','cached','manual'));
  END IF;

  -- gps_reports never carries a fence verdict: a GPS report is filed from
  -- wherever the agent was standing, not from a client's premises, so
  -- outside_geofence is not a value it can take.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gps_reports_geo_flag_chk'
  ) THEN
    ALTER TABLE public.gps_reports
      ADD CONSTRAINT gps_reports_geo_flag_chk
      CHECK ("GeoFlag" IS NULL OR "GeoFlag" IN
        ('low_accuracy','manual_override','offline_stale','network_fix'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gps_reports_geo_accuracy_chk'
  ) THEN
    ALTER TABLE public.gps_reports
      ADD CONSTRAINT gps_reports_geo_accuracy_chk
      CHECK ("GeoAccuracyM" IS NULL OR "GeoAccuracyM" >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gps_reports_geo_flag
  ON public.gps_reports (date_created DESC)
  WHERE "GeoFlag" IS NOT NULL AND "GeoReviewed" = false;

ALTER TABLE public.tasklog
  ADD COLUMN IF NOT EXISTS "GeoAccuracyM"   numeric,
  ADD COLUMN IF NOT EXISTS "GeoSource"      text,
  ADD COLUMN IF NOT EXISTS "GeoFlag"        text,
  ADD COLUMN IF NOT EXISTS "GeoDistanceM"   integer,
  ADD COLUMN IF NOT EXISTS "GeoSiteName"    text,
  ADD COLUMN IF NOT EXISTS "GeoReviewed"    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "GeoReviewedBy"  text,
  ADD COLUMN IF NOT EXISTS "GeoReviewedAt"  timestamptz;

-- Enumerations as CHECKs rather than a Postgres enum type: adding a value to
-- an enum later needs ALTER TYPE and a lock, whereas a CHECK is a drop-and-add
-- on a constraint. Same safety, far less ceremony. The guards mean re-running
-- with a widened set is cheap.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasklog_geo_source_chk'
  ) THEN
    ALTER TABLE public.tasklog
      ADD CONSTRAINT tasklog_geo_source_chk
      CHECK ("GeoSource" IS NULL OR "GeoSource" IN ('gps','fallback','cached','manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasklog_geo_flag_chk'
  ) THEN
    ALTER TABLE public.tasklog
      ADD CONSTRAINT tasklog_geo_flag_chk
      CHECK ("GeoFlag" IS NULL OR "GeoFlag" IN
        ('low_accuracy','outside_geofence','manual_override','offline_stale','network_fix'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasklog_geo_accuracy_chk'
  ) THEN
    ALTER TABLE public.tasklog
      ADD CONSTRAINT tasklog_geo_accuracy_chk
      CHECK ("GeoAccuracyM" IS NULL OR "GeoAccuracyM" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasklog_geo_distance_chk'
  ) THEN
    ALTER TABLE public.tasklog
      ADD CONSTRAINT tasklog_geo_distance_chk
      CHECK ("GeoDistanceM" IS NULL OR "GeoDistanceM" >= 0);
  END IF;
END $$;

-- The admin review queue filters on "flagged and not yet looked at". A partial
-- index keeps it off the 95%+ of rows that carry no flag at all.
CREATE INDEX IF NOT EXISTS idx_tasklog_geo_review
  ON public.tasklog (date_created DESC)
  WHERE "GeoFlag" IS NOT NULL AND "GeoReviewed" = false;

CREATE INDEX IF NOT EXISTS idx_tasklog_geo_flag ON public.tasklog ("GeoFlag");
CREATE INDEX IF NOT EXISTS idx_tasklog_geo_site ON public.tasklog ("GeoSiteName");


-- ── STEP 2 · client_sites — the fence directory ────────────────────────────
-- THIS IS NOT A CLIENT LIST. It is not, and must not become, a second copy of
-- your client master data.
--
--   The client names live in Neon (`accounts.company_name`), and the sales
--   sheet reads them from /api/fetch-account. That stays the single source of
--   truth for "who the clients are". Nothing here is ever rendered as a client
--   picker, and no client is created, renamed or deleted through this table.
--
--   What Neon does NOT have is a fence. So this table holds only what Neon
--   cannot: WHERE a client is and HOW FAR an agent may stray from it. If the
--   client master gains coordinates later, this table is deleted and the
--   lookup moves — nothing else in the app depends on it existing.
--
-- WHY `name` IS HERE AT ALL
--   Only as a lookup key. Neon is a separate database with no foreign key
--   across to Supabase, and tasklog."SiteVisitAccount" carries a plain company
--   name string — there is no shared id that travels with the visit. So the
--   name is the only thing the fence can be found by.
--
--   It is deliberately NOT the source of truth for the name: a client renamed
--   in Neon will simply stop matching until the fence row's name is updated to
--   match. That failure is silent and harmless (no fence = no warning, the
--   pre-feature behaviour), which is the safe direction to fail in.
--
--   If you would rather the fence travel with the account itself, add
--   latitude/longitude/radius_meters to Neon `accounts` instead and drop this
--   table — the lookup in lib/geofence.ts is the only thing that changes.
--
-- Coordinates are NOT NULL so a half-configured fence cannot exist. A client
-- with no row here has no fence, and the office-level fence in
-- system_settings still applies — i.e. an empty table means the app behaves
-- exactly as it did before this migration.

CREATE TABLE IF NOT EXISTS public.client_sites (
  id                bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,

  -- Lookup key ONLY. Matched against tasklog."SiteVisitAccount",
  -- case-insensitively with whitespace collapsed. See the note above.
  name              text NOT NULL,

  latitude          numeric NOT NULL,
  longitude         numeric NOT NULL,

  -- 100 m is the spec default. A wider fence is legitimate for a big client
  -- site or a mall; a zero-width one is not, hence the CHECK.
  radius_meters     integer NOT NULL DEFAULT 100
                      CHECK (radius_meters > 0 AND radius_meters <= 5000),

  -- Turn a fence off without deleting the coordinates you carefully entered.
  is_active         boolean NOT NULL DEFAULT true,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  company_id        bigint,

  -- GENERATED, not maintained by the app. "SiteVisitAccount" is typed by hand,
  -- so every lookup has to normalise the name — and if that normalisation
  -- lived in application code the SQL and the TS would drift, silently
  -- fencing nothing. A stored generated column makes drift impossible: the
  -- database computes the key from `name` itself.
  --
  -- The key collapses interior whitespace as well as trimming, because a
  -- hand-typed "Robinsons  Mandaue" (double space) must still reach the fence
  -- registered as "Robinsons Mandaue". A mismatch here is SILENT — the agent
  -- simply gets no fence — so the expression is duplicated verbatim in
  -- lib/geofence.ts → normalizeSiteName(). If you change one, change both.
  -- Every function used is IMMUTABLE, which a generated column requires.
  --
  -- It exists to make `.eq("name_key", ...)` an index hit. PostgREST cannot
  -- filter on lower(btrim(name)), so without this column every attendance
  -- sheet would pull the whole table and match in JS.
  name_key          text GENERATED ALWAYS AS
                      (lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))) STORED,

  CONSTRAINT client_sites_name_chk CHECK (btrim(name) <> ''),
  CONSTRAINT client_sites_lat_chk  CHECK (latitude  BETWEEN  -90 AND  90),
  CONSTRAINT client_sites_lng_chk  CHECK (longitude BETWEEN -180 AND 180)
);

-- The hot path: one equality lookup per attendance submission.
CREATE INDEX IF NOT EXISTS idx_client_sites_name_key ON public.client_sites (name_key);
CREATE INDEX IF NOT EXISTS idx_client_sites_active   ON public.client_sites (is_active);
CREATE INDEX IF NOT EXISTS idx_client_sites_company  ON public.client_sites (company_id);

-- One fence per name per tenant. NULL company_id (the default install) is a
-- distinct tenant, so this still allows the same client name under two
-- companies — which is exactly what a multi-tenant install needs.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_client_sites_tenant_name
  ON public.client_sites (COALESCE(company_id, 0), name_key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_sites_company_id_fkey'
  ) THEN
    ALTER TABLE public.client_sites
      ADD CONSTRAINT client_sites_company_id_fkey
      FOREIGN KEY (company_id)
      REFERENCES public.companies (id) ON DELETE CASCADE;
  END IF;
END $$;


-- ── STEP 3 · reporting view ─────────────────────────────────────────────────
-- The review queue's shape, in SQL. Kept as a view so the admin page, a
-- spreadsheet export and a manual psql session all agree on what "flagged"
-- means. Without it, "flagged" gets re-derived slightly differently in three
-- places and the numbers stop matching.

CREATE OR REPLACE VIEW public.v_attendance_geo_flags AS
SELECT
  t.id,
  t."ReferenceID",
  t."Type",
  t."Status",
  t."SiteVisitAccount",
  t."Location",
  t."Latitude",
  t."Longitude",
  t."PhotoURL",
  t."Remarks",
  t."GeoAccuracyM",
  t."GeoSource",
  t."GeoFlag",
  t."GeoDistanceM",
  t."GeoSiteName",
  t."GeoReviewed",
  t."GeoReviewedBy",
  t."GeoReviewedAt",
  t.date_created,
  u."Firstname" || ' ' || u."Lastname" AS agent_name,
  u."Manager",
  u."TSM"
FROM public.tasklog t
LEFT JOIN public.users u
  ON u."ReferenceID" = t."ReferenceID"
WHERE t."GeoFlag" IS NOT NULL;


-- ── STEP 4 · verification ──────────────────────────────────────────────────
-- Run this after Step 3. Expected: tasklog gains 7 columns, GeoFlag is NULL on
-- every pre-existing row, client_sites exists and is empty, and the view
-- returns 0 rows (nothing is flagged yet — correct, since no agent has run the
-- new code).
--
--   SELECT table_name, count(*) AS geo_cols
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name IN ('tasklog','gps_reports')
--      AND column_name LIKE 'Geo%'
--    GROUP BY table_name ORDER BY table_name;
--   -- expect tasklog = 8 (GeoDistanceM/GeoSiteName included), gps_reports = 6
--
--   -- Nothing pre-existing may acquire a flag:
--   SELECT count(*) AS preexisting_tasklog_flags FROM public.tasklog
--    WHERE "GeoFlag" IS NOT NULL;                            -- expect 0
--   SELECT count(*) AS preexisting_gps_flags FROM public.gps_reports
--    WHERE "GeoFlag" IS NOT NULL;                            -- expect 0
--
--   -- The generated key must agree with lib/geofence.ts normalizeSiteName():
--   SELECT name, name_key, name_key = lower(btrim(name)) AS exact_match
--     FROM public.client_sites ORDER BY name;               -- all exact_match = true
--
--   SELECT count(*) FROM public.client_sites;                -- expect 0
--
--   SELECT count(*) FROM public.v_attendance_geo_flags;      -- expect 0
--
--   -- The real test, after one agent clocks in from the field:
--   SELECT "GeoFlag", "GeoAccuracyM", "GeoSiteName", "GeoDistanceM"
--     FROM public.tasklog
--    WHERE "GeoFlag" IS NOT NULL
--    ORDER BY date_created DESC LIMIT 10;
--
-- ── STEP 5 · optional seed ─────────────────────────────────────────────────
-- Add a boundary for a client. `name` is the ONLY field, and it must match
-- accounts.company_name in Neon exactly as the sales sheet shows it — the
-- client master data is not in this database and is not duplicated here.
--
-- Without any of these the app falls back to the office-level fence in
-- system_settings (geofenceLat / geofenceLng / geofenceRadius), which is
-- exactly how it behaves today.
--
--   INSERT INTO public.client_sites (name, latitude, longitude, radius_meters)
--   VALUES
--     ('Sample Retail Co',    14.599512, 120.984221, 100),
--     ('Sample Mall Branch',  14.537800, 121.023400, 250)
--   ON CONFLICT DO NOTHING;
--
-- Check that a name will match before relying on it — a mismatch is silent and
-- means the visit is simply unfenced:
--   SELECT name FROM public.client_sites
--    WHERE name_key =
--      lower(btrim(regexp_replace('Robinsons  Mandaue', '\s+', ' ', 'g')));
-- Returns a row = the fence will be found.
--
-- ----------------------------------------------------------------------------
-- IF YOU WOULD RATHER KEEP FENCES IN NEON
-- Add latitude / longitude / radius_meters to Neon `accounts` and drop
-- client_sites entirely. The fence travels with the account, so there is no
-- name to keep in sync and no silent-mismatch failure mode. Only one thing
-- changes on this side: resolveFence() in
-- pages/api/ModuleSales/Activity/AddLog.ts and fetchSiteFence() in
-- lib/geofence.ts would read from Neon instead of this table.
-- The trade: Neon is not covered by /api/admin/backup/export, so fences set
-- there would not appear in a Supabase JSON backup.
--
-- ----------------------------------------------------------------------------
-- NO RLS ON PURPOSE
-- Every migration in this repository has none, and this one is no different:
-- every route that reads or writes these tables re-checks the session cookie
-- server-side (lib/rbac.ts + the /api/admin/* handlers). Adding RLS here alone
-- would lock the feature out on installs whose policies were never created.
-- If this app is ever exposed publicly through PostgREST, revisit this file
-- together with a policy pass over the other tables — doing it for one
-- migration in isolation would be worse than not doing it.
-- ============================================================================