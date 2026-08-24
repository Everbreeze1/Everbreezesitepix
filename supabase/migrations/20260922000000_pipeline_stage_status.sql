-- ONE STATUS, NOT TWO: THE STAGE OWNS THE BUCKET.
--
-- The client, looking at a project header that showed both at once:
--
--   "Beside the statuses where Invoiced, Scheduled is, there is another status
--    also that says complete, Active or onhold. we have to reconcile between
--    these two statuses. The active onhold status is also on maps."
--
-- 20260917000000_pipeline_stages.sql listed this as an open question and
-- answered it "not here":
--
--   "Should pipeline_stage replace Active/Completed/Archived long-term?
--    Not here. `projects.status` is untouched and stays the big-picture
--    bucket; the stage tracks movement inside it. They are deliberately not
--    wired together, so neither one silently rewrites the other, and merging
--    them later stays a decision rather than an unpick."
--
-- This is that decision, and the client made it. The two fields were not
-- independent in practice, only unsynchronised: a job sitting at "Paid" is not
-- a live job, whatever `projects.status` says, and the map painted it a green
-- Active pin because nothing told it otherwise.
--
-- ===========================================================================
-- WHAT THIS ADDS
-- ===========================================================================
--   pipeline_stages.status  - which of the three buckets a project standing in
--                             this stage counts as. One of 'active',
--                             'on_hold', 'completed'. Editable per stage,
--                             because "Snagging" and "Awaiting parts" mean
--                             nothing to a rule written in code.
--
--   Two triggers that keep `projects.status` true of the stage, so the
--   invariant belongs to the data rather than to whichever client wrote last:
--     - moving a project into a stage sets its status from that stage;
--     - changing what a stage counts as re-stamps the projects standing in it.
--
-- `projects.status` itself is UNCHANGED and stays exactly what it was: the
-- three-value bucket behind the map's pin colours, the project list's filters
-- and counts, and the dashboard. A team with no pipeline still sets it
-- directly. Nothing that reads it needs to know any of this happened.
--
-- 'archived' is never overwritten. Archiving is a different lifecycle (it
-- takes the project off the active list and has its own menu item), and a job
-- being dragged between columns is not a reason to bring it back.
--
-- Apply via the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent: safe to re-run. The seeding and the backfill run ONLY on the
-- first application, so a second run never overwrites a mapping a team has
-- since edited.

-- ===========================================================================
-- 1. THE COLUMN, SEEDED FROM THE STAGE NAMES ALREADY IN USE
-- ===========================================================================
-- The CASE below is the SQL copy of defaultStatusForStageName() in
-- packages/shared/src/pipeline-stages.ts, and tests/pipeline-stages.test.ts
-- checks the two agree. It matches on the normalised name (lower case, letters
-- and digits only) for the same reason the unique index does: "On Hold",
-- "on-hold" and "ON HOLD" are one stage name typed three ways.

DO $$
DECLARE
  fresh boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pipeline_stages'
      AND column_name = 'status'
  ) INTO fresh;

  IF NOT fresh THEN
    RAISE NOTICE 'pipeline_stages.status already exists - leaving every mapping as it is';
    RETURN;
  END IF;

  ALTER TABLE public.pipeline_stages
    ADD COLUMN status text NOT NULL DEFAULT 'active';

  UPDATE public.pipeline_stages
  SET status = CASE
    WHEN regexp_replace(lower(name), '[^a-z0-9]', '', 'g') ~
         'hold|paused|pause|waiting|awaiting|blocked|snooze|stalled|parked'
      THEN 'on_hold'
    WHEN regexp_replace(lower(name), '[^a-z0-9]', '', 'g') ~
         'complete|finished|done|closed|cancelled|canceled|paid|invoiced|handover|delivered'
      THEN 'completed'
    ELSE 'active'
  END;

  -- The reconciliation, applied to the work that already exists. Every project
  -- standing in a stage takes that stage's bucket, so the map and the filters
  -- stop disagreeing with the project page the moment this runs.
  UPDATE public.projects p
  SET status = ps.status
  FROM public.pipeline_stages ps
  WHERE p.pipeline_stage_id = ps.id
    AND p.status IS DISTINCT FROM ps.status
    AND p.status <> 'archived';
END $$;

DO $$
BEGIN
  ALTER TABLE public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_status_check
    CHECK (status IN ('active', 'on_hold', 'completed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- 2. MOVING A PROJECT INTO A STAGE SETS ITS STATUS
-- ===========================================================================
-- Every path that moves a project goes through setProjectPipelineStage today,
-- and that service writes the status too. This trigger is here so the rule
-- survives the next path somebody adds: a bulk update in the SQL editor, an
-- import, a future RPC. A field that any writer can leave inconsistent is the
-- state we are coming out of.

CREATE OR REPLACE FUNCTION public.projects_status_follows_stage() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stage_status text;
BEGIN
  IF NEW.pipeline_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Leaving a project where it is, is not a move. Without this, any UPDATE
  -- whose SET list mentions pipeline_stage_id would re-stamp the status and
  -- quietly undo a deliberate change made in the same breath.
  IF TG_OP = 'UPDATE' AND NEW.pipeline_stage_id IS NOT DISTINCT FROM OLD.pipeline_stage_id THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'archived' THEN
    RETURN NEW;
  END IF;

  SELECT ps.status INTO stage_status
  FROM public.pipeline_stages ps
  WHERE ps.id = NEW.pipeline_stage_id;

  IF stage_status IS NOT NULL THEN
    NEW.status := stage_status;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS projects_status_follows_stage ON public.projects;
CREATE TRIGGER projects_status_follows_stage
  BEFORE INSERT OR UPDATE OF pipeline_stage_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_status_follows_stage();

-- ===========================================================================
-- 3. CHANGING WHAT A STAGE COUNTS AS RE-STAMPS THE JOBS STANDING IN IT
-- ===========================================================================
-- Otherwise "Invoiced counts as Completed" would only take effect for jobs
-- moved after the edit, and the team would be told the map was still wrong.

CREATE OR REPLACE FUNCTION public.pipeline_stages_restamp_projects() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  UPDATE public.projects
  SET status = NEW.status
  WHERE pipeline_stage_id = NEW.id
    AND status IS DISTINCT FROM NEW.status
    AND status <> 'archived';

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pipeline_stages_restamp_projects ON public.pipeline_stages;
CREATE TRIGGER pipeline_stages_restamp_projects
  AFTER UPDATE OF status ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.pipeline_stages_restamp_projects();
