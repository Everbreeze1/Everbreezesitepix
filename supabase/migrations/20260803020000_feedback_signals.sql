-- Turn `issue_reports` into a general product-feedback table.
--
-- It only ever held free-text bug reports typed on the Report an issue page.
-- Two things are now needed on top of that:
--   1. "Suggest a feature" — ideas belong next to bugs, not in a separate silo,
--      so one queue can be triaged and one query answers "what are users
--      asking for?".
--   2. An occasional in-app prompt on the surface a user is actually using,
--      to catch problems that never show up in testing and to gauge interest
--      per feature.
--
-- Hence `kind` (what sort of feedback), `feature` (which surface it is about),
-- `sentiment` (the quick thumbs signal) and `source` (typed deliberately on the
-- feedback page vs. captured by the in-app prompt). Keeping them on one table
-- means "bugs per feature", "ideas per feature" and "sentiment per feature" are
-- all one GROUP BY.
--
-- This table predates the migrations folder and the checked-in generated types
-- (packages/db/src/database.ts) do NOT match what is actually deployed — a
-- first cut of this migration assumed `message` existed and failed with
-- 42703. So everything below is written to CONVERGE the table to the shape the
-- app writes, whatever state it starts in: create it if absent, add every
-- column if missing, and only alter what actually exists.
--
-- Apply via the SitePix Supabase SQL editor. Safe to re-run.

-- 1. Table, if this is a fresh environment.
CREATE TABLE IF NOT EXISTS public.issue_reports (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Every column the client writes (see submitFeedback in
--    apps/web/src/lib/feedback.ts). ADD COLUMN IF NOT EXISTS is a no-op when
--    the column is already there, so this repairs a partially-shaped table
--    without knowing which columns it currently has.
ALTER TABLE public.issue_reports
  ADD COLUMN IF NOT EXISTS user_id     uuid,
  ADD COLUMN IF NOT EXISTS email       text,
  -- The text column is `description`. An earlier cut of this file said
  -- `message`, which does not exist on the deployed table — see 20260803040000.
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS url        text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS status     text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS kind       text NOT NULL DEFAULT 'bug',
  ADD COLUMN IF NOT EXISTS feature    text,
  ADD COLUMN IF NOT EXISTS sentiment  text,
  ADD COLUMN IF NOT EXISTS source     text NOT NULL DEFAULT 'page',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- 3. The text column must be nullable: a one-tap thumbs signal has no text.
--    Guarded so this stays re-runnable and never touches a column that is
--    already nullable.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'issue_reports'
      AND column_name  = 'description'
      AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.issue_reports ALTER COLUMN description DROP NOT NULL;
  END IF;
END $$;

-- 4. Value constraints, added only once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_kind_check') THEN
    ALTER TABLE public.issue_reports
      ADD CONSTRAINT issue_reports_kind_check
      CHECK (kind IN ('bug', 'idea', 'praise'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_sentiment_check') THEN
    ALTER TABLE public.issue_reports
      ADD CONSTRAINT issue_reports_sentiment_check
      CHECK (sentiment IS NULL OR sentiment IN ('good', 'bad'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_source_check') THEN
    ALTER TABLE public.issue_reports
      ADD CONSTRAINT issue_reports_source_check
      CHECK (source IN ('page', 'prompt'));
  END IF;
END $$;

-- 5. The reporting queries this exists to serve: newest-first within a feature,
--    and newest-first within a kind.
CREATE INDEX IF NOT EXISTS issue_reports_feature_idx
  ON public.issue_reports(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_kind_idx
  ON public.issue_reports(kind, created_at DESC);

-- 6. Access. Feedback is written from the browser by a signed-in user, so the
--    table needs an INSERT policy; users may read back only their own rows.
--    Triage happens with the service role, which bypasses RLS.
GRANT SELECT, INSERT ON public.issue_reports TO authenticated;
GRANT ALL ON public.issue_reports TO service_role;

ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own issue reports" ON public.issue_reports;
CREATE POLICY "Users insert own issue reports" ON public.issue_reports
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own issue reports" ON public.issue_reports;
CREATE POLICY "Users view own issue reports" ON public.issue_reports
  FOR SELECT TO authenticated USING (user_id = auth.uid());
