-- Admin dashboard: make `issue_reports.status` a real triage column.
--
-- The column has existed since 20260803020000, with a default of 'new' and no
-- constraint, no index, and - until the admin Feedback inbox - no code that
-- ever wrote it. That migration's own comment said "triage happens with the
-- service role"; the reader was never built, so every report a customer has
-- filed has been sitting in 'new' unread.
--
-- This adds the two things the queue needs and the table lacked: a constraint
-- so a typo in a status cannot quietly create a bucket nothing lists, and an
-- index for the query the inbox actually runs (one status, newest first).
--
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent. Safe to re-run.

-- 1. Normalise anything already outside the vocabulary before constraining it,
--    or the ALTER below fails on legacy rows. Nothing has ever written this
--    column, so in practice this touches nothing - it is here so the migration
--    is safe against a database where something did.
UPDATE public.issue_reports
   SET status = 'new'
 WHERE status IS NULL
    OR status NOT IN ('new', 'triaged', 'resolved', 'dismissed');

-- 2. The vocabulary, added once. Mirrors FEEDBACK_STATUSES in
--    apps/api/src/domains/admin/feedback.ts - keep the two in step, or the API
--    accepts a value the database rejects at write time.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_status_check') THEN
    ALTER TABLE public.issue_reports
      ADD CONSTRAINT issue_reports_status_check
      CHECK (status IN ('new', 'triaged', 'resolved', 'dismissed'));
  END IF;
END $$;

-- 3. The inbox's query: one status, newest first. The sibling indexes on
--    (feature, created_at) and (kind, created_at) already exist.
CREATE INDEX IF NOT EXISTS issue_reports_status_idx
  ON public.issue_reports(status, created_at DESC);

-- Access is unchanged: `authenticated` may still insert its own reports and
-- read them back, and triage stays service-role only. No new grants - the
-- admin API reaches this table through the service key like every other
-- platform-wide read.

-- Verify:
--   SELECT status, count(*) FROM public.issue_reports GROUP BY status;
