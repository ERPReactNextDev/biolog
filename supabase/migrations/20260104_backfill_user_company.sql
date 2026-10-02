-- ============================================================================
-- BIOLOG — backfill users.company_id from the legacy free-text users."Company"
-- ----------------------------------------------------------------------------
-- THE GAP THIS FIXES
--   Two unrelated columns have always coexisted on public.users:
--     "Company"    free text, typed by an admin on the user form
--     company_id   FK -> public.companies, which the Companies tab counts
--   Nothing ever wrote company_id, so every user sat at NULL and the Companies
--   tab showed "0 users" for every company no matter how the free-text field was
--   filled in. app/admin/users now has a real company picker that writes the FK.
--
-- WHAT THIS DOES
--   Matches users."Company" to companies.name and sets company_id where the
--   match is unambiguous. Comparison is case-insensitive and ignores trailing
--   punctuation and surrounding whitespace, because the hand-typed column
--   disagrees with companies.name constantly — e.g. "Disruptive Solutions Inc."
--   vs the registered "Disruptive Solutions Inc".
--
--   Only UNAMBIGUOUS matches are applied. If two companies normalise to the
--   same string (possible — companies_name_key is on lower(name) only), NO user
--   matching that string is touched and a warning is printed. Guessing between
--   two same-named companies would silently file people under the wrong tenant.
--
-- RUN ORDER
--   1. STEP 0  register the companies that do not exist yet  <-- do this first
--   2. STEP 1  review what is unassigned
--   3. STEP 2  run the backfill
--   4. STEP 3  verify, then assign any stragglers by hand
--
-- ============================================================================
-- STEP 0 · REGISTER THE MISSING COMPANIES FIRST  (READ THIS)
-- ----------------------------------------------------------------------------
-- Measured against the live database while writing this:
--
--   users."Company" = "Ecoshift Corporation"  -> 136 users
--   users."Company" = "Disruptive Solutions Inc" (+ spelling variants) -> ~135
--   users."Company" = "Buildchem Solutions"    ->  39 users
--   users."Company" = "Disruptive"/"DSI"/"DIS"/"XYZ"/"Test company"/empty -> ~13
--
-- but companies contains ONE row: "Disruptive Solutions Inc".
--
-- So roughly 175 users name a company that is not registered, and a name-based
-- backfill alone leaves them unassigned. Register those companies FIRST (Admin
-- -> Companies, or uncomment below) and THEN run STEP 2, or the 136 Ecoshift and
-- 39 Buildchem users will simply not appear anywhere.
--
-- Uncomment and run this block to create them. Adjust the names to whatever you
-- actually want them called — they are taken from the users' own free-text
-- values, which is the best available guess.
--
-- INSERT INTO public.companies (name, plan, status) VALUES
--   ('Ecoshift Corporation',   'Enterprise', 'Active'),
--   ('Buildchem Solutions',    'Enterprise', 'Active')
-- ON CONFLICT DO NOTHING;
--
-- The ~13 users whose free text is junk ("DSI", "DIS", "Test company", "XYZ
-- Company") are deliberately NOT auto-mapped. A shorthand is not evidence of a
-- tenant, and guessing would file people under a company you may not want.
-- Assign those by hand in Admin -> Users.
-- ============================================================================


-- ── STEP 1 · report what is currently unassigned ──────────────────────────


-- ── STEP 1 · report what is currently unassigned ──────────────────────────

DO $$
DECLARE
  unassigned bigint;
  no_company bigint;
BEGIN
  SELECT count(*) INTO unassigned FROM public.users WHERE company_id IS NULL;
  SELECT count(*) INTO no_company FROM public.users WHERE company_id IS NULL AND (Company IS NULL OR btrim(Company) = '');

  RAISE NOTICE 'users with company_id NULL : %', unassigned;
  RAISE NOTICE '  ...and no free-text Company: % (nothing to match on)', no_company;
END $$;


-- ── STEP 2 · the backfill ─────────────────────────────────────────────────

DO $$
DECLARE
  v_matched  bigint;
  v_ambiguous bigint;
BEGIN
  WITH normalised_companies AS (
    SELECT
      c.id,
      -- Same normalisation the Companies tab and this script agree on.
      lower(regexp_replace(btrim(c.name), '[.,;]+$', '', 'g')) AS norm
    FROM public.companies c
  ),
  -- Keep only names that match exactly one company.
  unambiguous AS (
    SELECT nc.norm, min(nc.id) AS id
    FROM normalised_companies nc
    GROUP BY nc.norm
    HAVING count(*) = 1
  ),
  ambiguous_norms AS (
    SELECT nc.norm
    FROM normalised_companies nc
    GROUP BY nc.norm
    HAVING count(*) > 1
  ),
  candidates AS (
    SELECT
      u.id AS user_id,
      u."ReferenceID" AS ref,
      lower(regexp_replace(btrim(u."Company"), '[.,;]+$', '', 'g')) AS norm
    FROM public.users u
    WHERE u.company_id IS NULL
      AND u."Company" IS NOT NULL
      AND btrim(u."Company") <> ''
  )
  UPDATE public.users u
  SET company_id = a.id
  FROM candidates c
  JOIN unambiguous a ON a.norm = c.norm
  WHERE u.id = c.user_id;

  GET DIAGNOSTICS v_matched = ROW_COUNT;

  SELECT count(*) INTO v_ambiguous FROM ambiguous_norms;

  RAISE NOTICE 'users backfilled            : %', v_matched;
  RAISE NOTICE 'ambiguous company name(s)   : %', v_ambiguous;
  IF v_ambiguous > 0 THEN
    RAISE WARNING
      'Some company names normalise to more than one company; those users were LEFT UNASSIGNED on purpose. Rename one of the companies to disambiguate.';
  END IF;
END $$;


-- ── STEP 3 · verify ───────────────────────────────────────────────────────

SELECT
  c.name AS company,
  c.id,
  count(u.id) AS users_assigned
FROM public.companies c
LEFT JOIN public.users u ON u.company_id = c.id
GROUP BY c.name, c.id
ORDER BY c.id;

-- Anyone still NULL is either genuinely unassigned or their free-text Company
-- does not match a registered company. Assign them from Admin -> Users.
SELECT
  "ReferenceID",
  "Company" AS free_text_company,
  company_id
FROM public.users
WHERE company_id IS NULL
ORDER BY "ReferenceID"
LIMIT 50;


-- ── NOTE · the two columns can now disagree ───────────────────────────────
-- users."Company" is free text and users.company_id is the tenant. The admin
-- Users drawer mirrors a picker choice into the free-text column so they stay
-- in step, but nothing enforces it at the database level. Treat company_id as
-- the source of truth: it is what the Companies tab counts and what every
-- company_id filter reads. "Company" is only ever display text.