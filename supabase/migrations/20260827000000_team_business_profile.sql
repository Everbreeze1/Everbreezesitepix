-- What business is this, and what do they need from us.
--
-- Signing up asks for a name, an email and a password, and that is the right
-- amount to ask before someone has seen anything. The cost is that the moment
-- they are in, the product knows nothing about them: an electrician, a cleaning
-- contractor and a property manager all land on the same dashboard and the same
-- flat template library, and all three have to work out for themselves which of
-- thirty documents was written for their trade.
--
-- So the question moves rather than disappearing. The trial stays one form and
-- three fields; the business profile is asked once the account is worth setting
-- up properly, from a card on the dashboard and from Settings, and can be
-- skipped as many times as they like.
--
-- The answers live on `teams` rather than `profiles` because they are facts
-- about the company, not about the person: a crew member who joins later
-- inherits them, and a company with two admins cannot hold two contradictory
-- industries. `profiles.setup_prompt_dismissed_at` is the exception and belongs
-- exactly where it is - "not now" is one person's decision about one banner,
-- and their colleague should not have it made for them.
--
-- Every column is nullable with no default beyond the two arrays, so every
-- existing team stays valid and reads as "has not answered yet", which is the
-- truth. Nothing gates on them.
--
-- WRITES. `teams` is service-role-only since
-- 20260811002000_lock_down_team_billing_writes.sql - authenticated holds SELECT
-- and nothing else, deliberately, because `plan` and `is_internal` live on this
-- table. These columns inherit that, which is correct: they are set through the
-- `saveCompanyProfile` RPC, which checks the caller owns or admins the team
-- before touching the row. Do not re-grant UPDATE here to make the form
-- simpler; that is precisely the mistake that migration exists to undo.
--
-- Idempotent - ADD COLUMN IF NOT EXISTS throughout. Safe to re-run.
-- Apply manually in the Supabase SQL editor (or `supabase db push`).

ALTER TABLE public.teams
  -- The trade they picked. One of the ids in packages/shared/src/industries.ts,
  -- which is also what the RPC validates against. Text rather than an enum: the
  -- list will grow, and an enum makes adding a value a migration with a lock on
  -- a table the paywall reads.
  ADD COLUMN IF NOT EXISTS industry             TEXT,
  -- Other trades the same company also does, same id space as `industry`.
  -- Plenty of companies are two things - roofing and general construction,
  -- plumbing and HVAC - and forcing that into one answer is what makes people
  -- pick "Other" and tell us nothing.
  ADD COLUMN IF NOT EXISTS trades               TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS team_size            TEXT,
  ADD COLUMN IF NOT EXISTS project_volume       TEXT,
  -- What they are here to fix, multi-select. This is the column that answers
  -- "what concerns do they have", which is not derivable from anything else we
  -- store.
  ADD COLUMN IF NOT EXISTS goals                TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS heard_from           TEXT,
  -- Free text on purpose, and the only one: "Greater Manchester", "Tri-state",
  -- "within 50 miles of Denver" are all real answers and none of them fits a
  -- list we could write in advance.
  ADD COLUMN IF NOT EXISTS service_area         TEXT,
  ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMPTZ;

-- "Ask me later", per person. Nullable, and null means never asked to stop.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS setup_prompt_dismissed_at TIMESTAMPTZ;

-- The admin overview counts teams per industry and per size. Both are small,
-- low-cardinality columns on a small table, so one composite index covers the
-- grouping without earning its own maintenance cost twice over.
CREATE INDEX IF NOT EXISTS teams_industry_size_idx
  ON public.teams(industry, team_size)
  WHERE industry IS NOT NULL;

-- === VERIFY ================================================================
-- Expect nine rows: eight on teams, one on profiles.
--
-- SELECT table_name, column_name, data_type, is_nullable
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND ((table_name = 'teams'
--          AND column_name IN ('industry', 'trades', 'team_size', 'project_volume',
--                              'goals', 'heard_from', 'service_area',
--                              'profile_completed_at'))
--      OR (table_name = 'profiles' AND column_name = 'setup_prompt_dismissed_at'))
--  ORDER BY table_name, column_name;
--
-- Expect authenticated to still hold SELECT and nothing else.
--
-- SELECT has_table_privilege('authenticated', 'public.teams', 'SELECT') AS sel,
--        has_table_privilege('authenticated', 'public.teams', 'UPDATE') AS upd;
--
-- Who has answered, once the wizard is live.
--
-- SELECT industry, team_size, count(*)
--   FROM public.teams
--  WHERE profile_completed_at IS NOT NULL
--  GROUP BY 1, 2
--  ORDER BY 3 DESC;
