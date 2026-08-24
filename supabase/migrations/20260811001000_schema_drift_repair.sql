-- Schema drift repair: re-apply the two migrations production never got.
--
-- An audit of the live database against this folder found that
-- 20260803010000_showcase_brochure.sql and 20260803020000_feedback_signals.sql
-- describe columns that do not exist in production, even though APPLY_PENDING.sql
-- claimed the first of them was applied. That file has been deleted rather than
-- corrected - a hand-maintained "what is applied" list is wrong the moment it
-- disagrees with the database, and it was.
--
-- NAMING, because the audit reported these by filename and the filenames lie:
--   * there is no `feedback_signals` TABLE. 20260803020000_feedback_signals.sql
--     converges public.issue_reports - kind/feature/sentiment/source/description
--     are the "feedback signals" it is named for. Nothing in the repo references
--     a table by that name.
--   * there is no `showcases.brochure_enabled` COLUMN.
--     20260803010000_showcase_brochure.sql adds intro_html/outro_html/
--     accent_color/show_contact and the showcase_sections table; "brochure" is
--     the feature, not a flag. Nothing in the repo references that column.
-- What follows is the actual payload of both files, not the names in the audit.
--
-- Split from 20260811000000 on purpose. That file is a security fix that should
-- go in the moment it is read; this one takes AccessExclusiveLock on `showcases`
-- and `showcase_items`, the two tables that have deadlocked every previous
-- attempt (see the header of 20260803010000). Keeping them apart means a
-- deadlock here can never delay the lockdown there.
--
-- Everything is IF NOT EXISTS / guarded, so re-running is a no-op - which is the
-- point, since it is genuinely unknown how much of each original file landed.
--
-- Apply via the Everlumen Supabase SQL editor. Safe to re-run.

-- Fail fast rather than queueing behind app traffic. If a PART errors with
-- "canceling statement due to lock timeout" nothing in it was applied - close
-- any open Everlumen tabs and run that PART again.
SET lock_timeout = '5s';


-- === PART 1 - 20260803020000: feedback columns on issue_reports ============
-- Source of truth stays 20260803020000_feedback_signals.sql; this is its
-- convergence restated, with the `message` -> `description` fold from
-- 20260803040001 folded in, because a database that missed 020000 may equally
-- have missed its repair.

CREATE TABLE IF NOT EXISTS public.issue_reports (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.issue_reports
  ADD COLUMN IF NOT EXISTS user_id     uuid,
  ADD COLUMN IF NOT EXISTS email       text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS url         text,
  ADD COLUMN IF NOT EXISTS user_agent  text,
  ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS kind        text NOT NULL DEFAULT 'bug',
  ADD COLUMN IF NOT EXISTS feature     text,
  ADD COLUMN IF NOT EXISTS sentiment   text,
  ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'page',
  ADD COLUMN IF NOT EXISTS created_at  timestamptz NOT NULL DEFAULT now();

-- A one-tap thumbs signal carries no text, so the text column must be nullable.
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

  -- `message` is the phantom column an early cut of 020000 created. Fold it
  -- across before dropping it so no feedback is lost on a database that ran it.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'issue_reports'
      AND column_name  = 'message'
  ) THEN
    UPDATE public.issue_reports
       SET description = message
     WHERE message IS NOT NULL
       AND message <> ''
       AND (description IS NULL OR description = '');

    ALTER TABLE public.issue_reports DROP COLUMN message;
  END IF;
END $$;

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

CREATE INDEX IF NOT EXISTS issue_reports_feature_idx
  ON public.issue_reports(feature, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_reports_kind_idx
  ON public.issue_reports(kind, created_at DESC);

-- Feedback is written from the browser by a signed-in user; triage happens with
-- the service role, which bypasses RLS.
-- Revoke anon FIRST. Supabase's default privileges grant every new public
-- table to `anon`, and `CREATE TABLE IF NOT EXISTS` above will have done so on
-- any database where this table did not already exist. Feedback rows carry the
-- submitter's email, so the publishable key must not reach them. RLS already
-- restricts INSERT to `authenticated`, so this only closes the privilege layer
-- behind the policy - nothing that works today stops working.
REVOKE ALL ON public.issue_reports FROM anon, PUBLIC;
GRANT SELECT, INSERT ON public.issue_reports TO authenticated;
GRANT ALL ON public.issue_reports TO service_role;

ALTER TABLE public.issue_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users insert own issue reports" ON public.issue_reports;
CREATE POLICY "Users insert own issue reports" ON public.issue_reports
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users view own issue reports" ON public.issue_reports;
CREATE POLICY "Users view own issue reports" ON public.issue_reports
  FOR SELECT TO authenticated USING (user_id = auth.uid());


-- === PART 2 - 20260803010000: the showcase brochure columns ================
-- Most deadlock-prone statement in this file; `showcases` is read on every
-- Portfolio and Showcase load.
ALTER TABLE public.showcases
  ADD COLUMN IF NOT EXISTS intro_html   text,
  ADD COLUMN IF NOT EXISTS outro_html   text,
  ADD COLUMN IF NOT EXISTS accent_color text,
  ADD COLUMN IF NOT EXISTS show_contact boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.showcase_sections (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  showcase_id uuid NOT NULL REFERENCES public.showcases(id) ON DELETE CASCADE,
  -- Optional provenance, deliberately not a FK - see 20260803010000.
  project_id  uuid,
  title       text,
  body_html   text,
  position    int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS showcase_sections_showcase_id_idx
  ON public.showcase_sections(showcase_id, position);

ALTER TABLE public.showcase_items
  ADD COLUMN IF NOT EXISTS section_id uuid
    REFERENCES public.showcase_sections(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS showcase_items_section_id_idx
  ON public.showcase_items(section_id, position);

-- Same reasoning as issue_reports above. The public showcase page does not need
-- anon access: getPublicShowcaseService runs on getSupabaseAdmin() (service
-- role), which bypasses both RLS and these grants.
REVOKE ALL ON public.showcase_sections FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.showcase_sections TO authenticated;
GRANT ALL ON public.showcase_sections TO service_role;

ALTER TABLE public.showcase_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members view showcase sections" ON public.showcase_sections;
CREATE POLICY "Team members view showcase sections" ON public.showcase_sections
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.showcases s
      JOIN public.team_members tm ON tm.team_id = s.team_id AND tm.user_id = auth.uid()
      WHERE s.id = showcase_sections.showcase_id
    )
  );

DROP POLICY IF EXISTS "Manage sections on your own showcases" ON public.showcase_sections;
CREATE POLICY "Manage sections on your own showcases" ON public.showcase_sections
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.showcases s
      JOIN public.team_members tm ON tm.team_id = s.team_id AND tm.user_id = auth.uid()
      WHERE s.id = showcase_sections.showcase_id
        AND (s.created_by = auth.uid() OR tm.role IN ('owner', 'admin'))
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.showcases s
      JOIN public.team_members tm ON tm.team_id = s.team_id AND tm.user_id = auth.uid()
      WHERE s.id = showcase_sections.showcase_id
        AND (s.created_by = auth.uid() OR tm.role IN ('owner', 'admin'))
    )
  );


-- === PART 3 - migration history bookkeeping ================================
-- 20260803040000 was used twice (issue_reports_description_fix and
-- starter_project_sharing). Two files cannot share a version - the CLI's history
-- table is keyed on it - so the description fix has been renamed to
-- 20260803040001 (it repairs 20260803020000, so it is the one that must sort
-- later; starter_project_sharing is independent of both and keeps the original
-- stamp, which also matches the order they were written in).
--
-- The rename is history-only: both are already applied in production. This block
-- records the new version as applied so `supabase db push` does not try to
-- re-run it. It is a no-op on a database whose history is not CLI-tracked, and
-- the file itself is idempotent anyway, so a re-run would be harmless either
-- way - this just avoids the surprise.
DO $$
BEGIN
  -- Two separate steps, and the INSERT goes through EXECUTE, because PL/pgSQL
  -- plans a whole boolean expression at once: testing for the history table and
  -- reading it in the same IF would still fail with 42P01 on a database that
  -- has no such table.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
  ) THEN
    RAISE NOTICE 'no CLI-tracked migration history - nothing to record';
    RETURN;
  END IF;

  -- Only claim the new version if the old one is actually in the history;
  -- otherwise this database never ran the file under either name and marking it
  -- applied would skip it forever.
  EXECUTE $q$
    INSERT INTO supabase_migrations.schema_migrations (version)
    SELECT '20260803040001'
    WHERE EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260803040000'
    )
    ON CONFLICT DO NOTHING
  $q$;

  RAISE NOTICE 'migration history checked for 20260803040001';
END $$;


-- === VERIFY ================================================================
-- Expect: issue_reports listing description/kind/feature/sentiment/source and NO
-- `message`; showcases_brochure_ready and showcase_sections_ready both true.

SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'issue_reports'
ORDER BY ordinal_position;

SELECT
  (SELECT count(*) = 4 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'showcases'
      AND column_name IN ('intro_html', 'outro_html', 'accent_color', 'show_contact'))
    AS showcases_brochure_ready,
  (SELECT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'showcase_sections'))
    AS showcase_sections_ready,
  (SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'showcase_items'
      AND column_name = 'section_id'))
    AS showcase_items_section_ready;
