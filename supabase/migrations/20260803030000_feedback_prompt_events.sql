-- Funnel telemetry for the in-app feedback prompt.
--
-- `issue_reports` records what people SAID. This records whether they were
-- willing to say anything at all - which is the other half of the question
-- "is this prompt earning its place, and which features do people care enough
-- about to answer for?".
--
-- Deliberately a separate table rather than more rows in `issue_reports`:
--   * an impression is not feedback, and mixing them would mean every triage
--     query needs a `WHERE kind <> 'shown'` filter forever;
--   * this table is append-only, high-volume and disposable, while
--     `issue_reports` is a work queue someone actually reads.
--
-- Three events per prompt lifecycle:
--   shown     - the prompt appeared
--   dismissed - X'd out, or "Not now"
--   answered  - a thumbs signal, bug or idea was submitted
--
-- so the rates are one GROUP BY, with `shown` as the denominator:
--
--   SELECT feature,
--          count(*) FILTER (WHERE event = 'shown')     AS shown,
--          count(*) FILTER (WHERE event = 'answered')  AS answered,
--          count(*) FILTER (WHERE event = 'dismissed') AS dismissed,
--          round(100.0 * count(*) FILTER (WHERE event = 'answered')
--                / nullif(count(*) FILTER (WHERE event = 'shown'), 0), 1) AS response_rate
--   FROM public.feedback_prompt_events
--   GROUP BY feature ORDER BY shown DESC;
--
-- No message content is stored here - only who, which surface, and what they
-- did with the prompt.
--
-- Apply via the Everlumen Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.feedback_prompt_events (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature    text NOT NULL,
  event      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feedback_prompt_events_event_check'
  ) THEN
    ALTER TABLE public.feedback_prompt_events
      ADD CONSTRAINT feedback_prompt_events_event_check
      CHECK (event IN ('shown', 'dismissed', 'answered'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS feedback_prompt_events_feature_idx
  ON public.feedback_prompt_events(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_prompt_events_event_idx
  ON public.feedback_prompt_events(event, created_at DESC);

GRANT SELECT, INSERT ON public.feedback_prompt_events TO authenticated;
GRANT ALL ON public.feedback_prompt_events TO service_role;

ALTER TABLE public.feedback_prompt_events ENABLE ROW LEVEL SECURITY;

-- Users write their own events and can read back only their own. Analysis runs
-- with the service role, which bypasses RLS.
DROP POLICY IF EXISTS "Users insert own prompt events" ON public.feedback_prompt_events;
CREATE POLICY "Users insert own prompt events" ON public.feedback_prompt_events
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own prompt events" ON public.feedback_prompt_events;
CREATE POLICY "Users view own prompt events" ON public.feedback_prompt_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
