-- Auto Report usage ledger.
--
-- "Auto Reports" are the AI reports generated from a walkthrough (spoken
-- transcript + photos captured during the walk -> LLM-written report; see
-- generateWalkthroughReportService in apps/api/src/domains/walkthroughs/service.ts).
-- They are a Pro/Team feature, metered per user per calendar month:
--   Pro  -> 100 / user / month
--   Team -> unlimited
--
-- generateWalkthroughReportService overwrites walkthroughs.summary_markdown in
-- place, so the walkthrough row itself records only the latest generation --
-- there is nothing there to count. This ledger records one row per successful
-- generation so the quota can be enforced server-side and shown in Settings >
-- Billing. Regenerating a report on the same walkthrough is intentionally a
-- new row: it is another LLM call, so it costs another unit of quota.
--
-- Mirrors the ai_analyses shape (20260725010000_ai_analyses.sql): a
-- created_by + created_at DESC index is what the month-to-date count query
-- rides on. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.auto_report_generations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  walkthrough_id UUID NOT NULL REFERENCES public.walkthroughs(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Plan at generation time, so a later upgrade/downgrade never rewrites
  -- history when auditing what a month's usage was actually billed against.
  plan TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auto_report_generations_created_by_idx
  ON public.auto_report_generations(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS auto_report_generations_walkthrough_idx
  ON public.auto_report_generations(walkthrough_id, created_at DESC);

GRANT SELECT, INSERT ON public.auto_report_generations TO authenticated;
GRANT ALL ON public.auto_report_generations TO service_role;

ALTER TABLE public.auto_report_generations ENABLE ROW LEVEL SECURITY;

-- A user reads only their own usage: the quota is per user, and Settings >
-- Billing counts exactly these rows for the signed-in user.
DROP POLICY IF EXISTS "Users view own auto_report_generations" ON public.auto_report_generations;
CREATE POLICY "Users view own auto_report_generations" ON public.auto_report_generations
  FOR SELECT TO authenticated USING (created_by = auth.uid());

-- Rows are written by the API with the service role after the quota check.
-- This policy exists only so the client-side realtime subscription in
-- use-subscription.tsx can attach; it can never be used to inflate someone
-- else's usage.
DROP POLICY IF EXISTS "Users insert own auto_report_generations" ON public.auto_report_generations;
CREATE POLICY "Users insert own auto_report_generations" ON public.auto_report_generations
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

-- Live usage counter in Settings > Billing. Without publication membership the
-- client's postgres_changes subscription silently never fires -- which is the
-- state the equivalent ai_analyses subscription in use-subscription.tsx has
-- always been in, since that table was never added here.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.auto_report_generations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
