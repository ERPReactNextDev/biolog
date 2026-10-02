-- ============================================================================
-- BIOLOG — admin platform migration
--   Feature 6: API Credentials      (companies, api_keys, api_call_log)
--   Feature 7: Backup & Restore     (backups)
--   Feature 8: Multi-company        (companies + company_id everywhere)
-- ----------------------------------------------------------------------------
-- WHY THIS FILE IS HAND-WRITTEN AND NOT AUTO-APPLIED
--   The app connects with the *publishable* (anon) key only — there is no
--   service_role key in .env.local and no migration tooling in the repo
--   (no supabase/migrations, no drizzle, no *.sql). PostgREST cannot execute
--   DDL, so schema changes cannot be applied from the running app.
--
-- HOW TO APPLY
--   Supabase Dashboard -> SQL Editor -> paste -> Run. It is idempotent
--   (IF NOT EXISTS everywhere), so re-running is safe.
--
-- SAFETY
--   company_id is added as NULLABLE with no backfill and no NOT NULL. Nothing
--   existing breaks, and single-tenant behaviour is unchanged until you backfill.
--   Read the "STEP 2" note before enabling tenant filtering.
-- ============================================================================


-- ── STEP 1 · companies ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.companies (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'Starter'
              CHECK (plan IN ('Starter','Growth','Enterprise')),
  status      text NOT NULL DEFAULT 'Active'
              CHECK (status IN ('Active','Trial','Suspended')),
  admin_email text,
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS companies_name_key
  ON public.companies (lower(name));


-- ── STEP 2 · company_id on every tenant-scoped table ──────────────────────
-- Nullable on purpose. Existing rows stay NULL and remain fully visible to
-- Super Admin. Backfill with a single-tenant install:
--
--   INSERT INTO public.companies (name, plan, status)
--   VALUES ('Biolog', 'Enterprise', 'Active') ON CONFLICT DO NOTHING;
--
--   UPDATE public.users        SET company_id = (SELECT id FROM public.companies LIMIT 1);
--   UPDATE public.tasklog      SET company_id = (SELECT id FROM public.companies LIMIT 1);
--   UPDATE public.gps_reports  SET company_id = (SELECT id FROM public.companies LIMIT 1);
--
-- Only then add the NOT NULL + FK constraints below.

ALTER TABLE public.users       ADD COLUMN IF NOT EXISTS company_id bigint;
ALTER TABLE public.tasklog     ADD COLUMN IF NOT EXISTS company_id bigint;
ALTER TABLE public.gps_reports ADD COLUMN IF NOT EXISTS company_id bigint;

-- NOTE: public.site_visits and public.attendance_logs do NOT exist in this
-- project — attendance and client visits both live in public.tasklog. Those
-- two are created here so the API surface in the spec can be honoured, and
-- left empty until you decide whether to split them out.
--
-- CREATE TABLE IF NOT EXISTS public.site_visits (
--   id          bigserial PRIMARY KEY,
--   "ReferenceID" text NOT NULL,
--   "CompanyID"   text,
--   "AccountName" text,
--   "ClientType"  text,
--   date_created  timestamptz NOT NULL DEFAULT now(),
--   "Location"    text,
--   "Latitude"    text,
--   "Longitude"   text,
--   "PhotoURL"    text
-- );
--
-- CREATE TABLE IF NOT EXISTS public.attendance_logs (
--   id          bigserial PRIMARY KEY,
--   "ReferenceID" text NOT NULL,
--   "CompanyID"   text,
--   "UserId"     text,
--   "Type"       text,
--   "Status"     text,
--   date_created timestamptz NOT NULL DEFAULT now(),
--   "Location"   text,
--   "Latitude"   text,
--   "Longitude"  text,
--   "PhotoURL"   text
-- );

-- Indexed on company_id because every tenant query filters by it.
CREATE INDEX IF NOT EXISTS idx_users_company        ON public.users (company_id);
CREATE INDEX IF NOT EXISTS idx_tasklog_company      ON public.tasklog (company_id);
CREATE INDEX IF NOT EXISTS idx_gps_reports_company  ON public.gps_reports (company_id);

-- Foreign keys added last so the column adds succeed on a live database.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_company_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies (id) ON DELETE SET NULL;
  END IF;
END $$;


-- ── STEP 3 · API credentials ───────────────────────────────────────────────
-- Only the SHA-256 HASH is stored. The plaintext key is returned once at
-- creation and is unrecoverable afterwards.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id          bigserial PRIMARY KEY,
  key_name    text NOT NULL,
  key_hash    text NOT NULL UNIQUE,          -- sha256 hex of the plaintext
  key_prefix  text NOT NULL,                 -- "blg_live_ab12…" for display
  scopes      text[] NOT NULL DEFAULT '{}',
  rate_limit  int  NOT NULL DEFAULT 100,      -- requests per minute
  revoked     boolean NOT NULL DEFAULT false,
  revoked_at  timestamptz,
  revoked_by  text,
  last_used   timestamptz,
  last_used_ip text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_active ON public.api_keys (revoked, created_at DESC);

-- Every authenticated API call lands here.
CREATE TABLE IF NOT EXISTS public.api_call_log (
  id          bigserial PRIMARY KEY,
  key_id      bigint REFERENCES public.api_keys (id) ON DELETE SET NULL,
  endpoint    text,
  method      text,
  ip          text,
  status_code int,
  denied      boolean NOT NULL DEFAULT false,  -- scope/limit rejection
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_call_log_key    ON public.api_call_log (key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_call_log_recent ON public.api_call_log (created_at DESC);


-- ── STEP 4 · backups ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.backups (
  id          bigserial PRIMARY KEY,
  filename    text NOT NULL,
  storage_key text,                            -- path in Cloudinary/object store
  size_bytes  bigint,
  type        text NOT NULL DEFAULT 'Manual'
              CHECK (type IN ('Auto','Manual')),
  schedule    text,                            -- 'daily' | 'weekly'
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backups_recent ON public.backups (created_at DESC);


-- ── STEP 5 · RLS note ─────────────────────────────────────────────────────
-- The app talks to Supabase with the ANON key and does all authorisation in
-- API routes (lib/rbac.ts), so tables are currently reachable by anon.
-- If you enable RLS later, these tables need policies or the admin console
-- will start returning empty results rather than errors — which is far
-- harder to debug than an explicit 401.
--
-- Recommended before exposing anything publicly:
--   REVOKE ALL ON public.api_keys, public.api_call_log FROM anon;
--   (api_keys holds only hashes, but it is still not anon-readable.)