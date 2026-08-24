-- Make blueprint provenance durable, readable by the whole team, and
-- attributable per item.
--
-- Three defects in 20260810000000, all found by auditing why a project never
-- shows which blueprint set it up:
--
--   1. THE LEDGER IS INVISIBLE TO TEAMMATES. The SELECT policy gates on being
--      able to see the parent BLUEPRINT:
--          pt.created_by = auth.uid()
--          OR (pt.team_id IS NOT NULL AND <member of pt.team_id>)
--      but `project_templates.team_id` is NULLABLE (20260622052525) and the
--      Templates screen creates blueprints with `team_id: team?.id ?? null`. So a
--      blueprint authored by someone without a team is visible only to its
--      author, while the PROJECT it was applied to is visible to every teammate
--      via are_teammates(). The teammate sees the project and zero ledger rows -
--      identical, on screen, to a project no blueprint ever touched.
--      Provenance is a fact about the PROJECT, so it is now gated on the
--      project, matching `projects` own RLS.
--
--   2. DELETING A BLUEPRINT ERASES THE HISTORY. `blueprint_id` is NOT NULL
--      REFERENCES project_templates ON DELETE CASCADE, so removing a blueprint
--      silently deletes every record of everywhere it was ever applied. That is
--      the opposite of what a ledger is for, and it contradicts the reasoning
--      already written two lines below it in that file, where `applied_by` is
--      deliberately ON DELETE SET NULL because "history outlives the person who
--      made it". The same argument applies to the blueprint. The id becomes
--      nullable + SET NULL, and `blueprint_name` is denormalised onto the row so
--      the history can still say WHAT was applied after the blueprint is gone.
--
--   3. PRE-LEDGER PROJECTS HAVE NO ORIGIN AT ALL. Every project set up before
--      20260810000000 landed has no row and never will. Those can be partially
--      reconstructed from project_checklists.template_id /
--      project_workflows.template_id - see the companion backfill file
--      20260812000100_backfill_blueprint_origin.sql. Reconstructed rows are
--      inferences, not observations, so `origin` marks them and the UI says
--      "Detected from its checklists" rather than asserting an apply happened.
--
-- Also adds `project_reports.source_template`, the last missing piece of
-- per-item provenance: project_checklists, project_workflows and project_pages
-- already record the template each came from, reports did not.
--
-- ANON GRANTS ARE REVOKED EXPLICITLY. Supabase ships
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon`, so a
-- newly created public table is readable by the publishable key - which is in
-- the browser bundle - the moment it exists. That is how `walkthroughs` and
-- `team_invites` leaked (see 20260811000000). This ledger names project ids and
-- blueprint names, so anon must not reach it.
--
-- Self-sufficient: re-declares the table, so this file also repairs an
-- environment that never received 20260810000000.
--
-- Apply via the Everlumen Supabase SQL editor. Idempotent - safe to re-run.

SET lock_timeout = '5s';

-- === PART 1 - the table, for a database that never got 20260810000000 =======

CREATE TABLE IF NOT EXISTS public.project_blueprint_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid REFERENCES public.project_templates(id) ON DELETE SET NULL,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  applied_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  counts       jsonb NOT NULL DEFAULT '{}'::jsonb,
  failed_count integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- === PART 2 - durability: name survives deletion, id survives deletion ======

ALTER TABLE public.project_blueprint_applications
  ADD COLUMN IF NOT EXISTS blueprint_name text,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'applied';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_blueprint_applications_origin_check'
  ) THEN
    ALTER TABLE public.project_blueprint_applications
      ADD CONSTRAINT project_blueprint_applications_origin_check
      CHECK (origin IN ('applied', 'inferred'));
  END IF;
END $$;

-- Drop NOT NULL and swap CASCADE for SET NULL on blueprint_id. Guarded
-- individually because a database created by PART 1 above already has the right
-- shape, while one created by 20260810000000 does not.
DO $$
DECLARE
  fk_name text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'project_blueprint_applications'
      AND column_name  = 'blueprint_id'
      AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.project_blueprint_applications
      ALTER COLUMN blueprint_id DROP NOT NULL;
  END IF;

  -- Find the FK by what it points at rather than by name - the name is only
  -- predictable when Postgres generated it.
  SELECT con.conname INTO fk_name
    FROM pg_constraint con
    JOIN pg_class rel  ON rel.oid = con.conrelid
    JOIN pg_class frel ON frel.oid = con.confrelid
   WHERE con.contype = 'f'
     AND rel.relname  = 'project_blueprint_applications'
     AND frel.relname = 'project_templates'
     AND con.confdeltype = 'c'      -- 'c' = ON DELETE CASCADE
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.project_blueprint_applications DROP CONSTRAINT %I', fk_name);
    ALTER TABLE public.project_blueprint_applications
      ADD CONSTRAINT project_blueprint_applications_blueprint_id_fkey
      FOREIGN KEY (blueprint_id) REFERENCES public.project_templates(id) ON DELETE SET NULL;
    RAISE NOTICE 'blueprint_id FK switched from CASCADE to SET NULL';
  END IF;
END $$;

-- Backfill the denormalised name for rows written before this column existed,
-- while their blueprints are still around to read it from.
UPDATE public.project_blueprint_applications a
   SET blueprint_name = pt.name
  FROM public.project_templates pt
 WHERE pt.id = a.blueprint_id
   AND a.blueprint_name IS NULL;

-- === PART 3 - grants, then RLS gated on the PROJECT ========================

REVOKE ALL ON public.project_blueprint_applications FROM anon, PUBLIC;
GRANT SELECT ON public.project_blueprint_applications TO authenticated;
GRANT ALL ON public.project_blueprint_applications TO service_role;

ALTER TABLE public.project_blueprint_applications ENABLE ROW LEVEL SECURITY;

-- Rows are written by the API with the service role, so there is deliberately
-- still no INSERT/UPDATE/DELETE policy - a client must not fabricate history.
DROP POLICY IF EXISTS "Read blueprint applications via parent"
  ON public.project_blueprint_applications;
DROP POLICY IF EXISTS "Read blueprint applications via project"
  ON public.project_blueprint_applications;
CREATE POLICY "Read blueprint applications via project"
  ON public.project_blueprint_applications FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_blueprint_applications.project_id
      -- Mirrors `projects` own RLS (20260612191404 / 20260803040000).
      -- are_teammates self-matches (_a = _b), so this covers the creator too.
      AND public.are_teammates(auth.uid(), p.created_by)
  ));

CREATE INDEX IF NOT EXISTS project_blueprint_applications_blueprint_idx
  ON public.project_blueprint_applications(blueprint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_blueprint_applications_project_idx
  ON public.project_blueprint_applications(project_id, created_at DESC);

-- === PART 4 - per-item provenance for reports ==============================
-- project_checklists.template_id (20260611000428), project_workflows.template_id
-- (20260616050717) and project_pages.source_template already exist. Reports were
-- the one blueprint output with no pointer back to what created them, so a
-- report could not carry a "from <blueprint>" badge like its siblings.
ALTER TABLE public.project_reports
  ADD COLUMN IF NOT EXISTS source_template uuid;

CREATE INDEX IF NOT EXISTS project_reports_source_template_idx
  ON public.project_reports(source_template)
  WHERE source_template IS NOT NULL;

-- === VERIFY ================================================================
-- Expect: blueprint_id nullable with SET NULL, blueprint_name and origin
-- present, one SELECT policy named "... via project", source_template on
-- project_reports.

SELECT column_name, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'project_blueprint_applications'
 ORDER BY ordinal_position;

SELECT con.conname, con.confdeltype
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
 WHERE rel.relname = 'project_blueprint_applications' AND con.contype = 'f';

SELECT polname FROM pg_policy
 WHERE polrelid = 'public.project_blueprint_applications'::regclass;

SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'project_reports'
     AND column_name = 'source_template'
) AS report_source_template_ready;
