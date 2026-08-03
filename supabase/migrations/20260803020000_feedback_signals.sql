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
-- The table predates the migrations folder, so everything here is additive and
-- defensive. Apply via the SitePix Supabase SQL editor. Idempotent.

ALTER TABLE public.issue_reports
  ADD COLUMN IF NOT EXISTS kind      text NOT NULL DEFAULT 'bug',
  ADD COLUMN IF NOT EXISTS feature   text,
  ADD COLUMN IF NOT EXISTS sentiment text,
  ADD COLUMN IF NOT EXISTS source    text NOT NULL DEFAULT 'page';

-- `message` is required for typed reports but meaningless for a one-tap thumbs
-- signal, so it has to accept the empty string.
ALTER TABLE public.issue_reports ALTER COLUMN message DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_kind_check'
  ) THEN
    ALTER TABLE public.issue_reports
      ADD CONSTRAINT issue_reports_kind_check
      CHECK (kind IN ('bug', 'idea', 'praise'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_sentiment_check'
  ) THEN
    ALTER TABLE public.issue_reports
      ADD CONSTRAINT issue_reports_sentiment_check
      CHECK (sentiment IS NULL OR sentiment IN ('good', 'bad'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_source_check'
  ) THEN
    ALTER TABLE public.issue_reports
      ADD CONSTRAINT issue_reports_source_check
      CHECK (source IN ('page', 'prompt'));
  END IF;
END $$;

-- The reporting queries this exists to serve: newest-first within a feature,
-- and newest-first within a kind.
CREATE INDEX IF NOT EXISTS issue_reports_feature_idx
  ON public.issue_reports(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_kind_idx
  ON public.issue_reports(kind, created_at DESC);
