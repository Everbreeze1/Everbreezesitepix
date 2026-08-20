-- WHO LAST EDITED A PROJECT ITEM.
--
-- 20260924000000 answered "who created this and which blueprint made it".
-- The other half of the same request was "and who edited it", which nothing in
-- this schema could answer: `updated_by` existed on none of these tables, and
-- `updated_at` only on project_reports and project_pages.
--
-- Done with triggers rather than by changing every write path. There are more
-- ways to edit these rows than any one audit of the codebase would find, and a
-- forgotten path is worse than no attribution at all - it would show a stale
-- name with total confidence. The database is the one place every write has to
-- pass through.
--
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent: safe to re-run, and a no-op once it has run.

-- ---------------------------------------------------------------------------
-- 1. Columns.
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL: a departed employee's account going away must not delete
-- the checklist they last touched.
ALTER TABLE public.project_checklists
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.project_workflows
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- These two already carry updated_at (20260618230000 / 20260729010000).
ALTER TABLE public.project_reports
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.project_pages
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.project_checklists.updated_by IS
  'Last person to change this checklist or any of its items. NULL when only server-side writes have touched it.';

-- ---------------------------------------------------------------------------
-- 2. The attribution trigger.
-- ---------------------------------------------------------------------------
-- Deliberately NOT a change to public.handle_updated_at(): several other tables
-- run that function and have no updated_by column, so redefining it would make
-- every one of their updates fail on a missing field.
CREATE OR REPLACE FUNCTION public.handle_updated_attribution()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  -- auth.uid() is NULL for service_role writes: the blueprint apply, the
  -- backfills, anything running from the API's admin client. Those must not
  -- erase a real person's name with a blank, so the column is only overwritten
  -- when there is somebody to credit.
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_checklists_updated_attribution ON public.project_checklists;
CREATE TRIGGER project_checklists_updated_attribution
  BEFORE UPDATE ON public.project_checklists
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_attribution();

DROP TRIGGER IF EXISTS project_workflows_updated_attribution ON public.project_workflows;
CREATE TRIGGER project_workflows_updated_attribution
  BEFORE UPDATE ON public.project_workflows
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_attribution();

DROP TRIGGER IF EXISTS project_reports_updated_attribution ON public.project_reports;
CREATE TRIGGER project_reports_updated_attribution
  BEFORE UPDATE ON public.project_reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_attribution();

DROP TRIGGER IF EXISTS project_pages_updated_attribution ON public.project_pages;
CREATE TRIGGER project_pages_updated_attribution
  BEFORE UPDATE ON public.project_pages
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_attribution();

DROP TRIGGER IF EXISTS tasks_updated_attribution ON public.tasks;
CREATE TRIGGER tasks_updated_attribution
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_attribution();

-- ---------------------------------------------------------------------------
-- 3. Editing a checklist means ticking its ITEMS.
-- ---------------------------------------------------------------------------
-- A trigger on the parent alone would almost never fire for checklists and
-- workflows: nobody updates the `project_checklists` row, they tick a
-- `project_checklist_items` row. Without these, "who edited it" would answer
-- "nobody, ever" for the two kinds people actually work on daily.
--
-- SECURITY DEFINER because RLS on the parent is written for the ways the app
-- edits it, and a crew member ticking an item must not be able to fail on a
-- permission check for a bookkeeping write they did not ask for. The reach is
-- bounded by the foreign key: this can only touch the parent of the row that
-- was just written. search_path is pinned, as it must be on any definer
-- function, so the body cannot be captured by a shadowing schema.
CREATE OR REPLACE FUNCTION public.touch_checklist_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.project_checklists
     SET updated_at = now(),
         updated_by = COALESCE(auth.uid(), updated_by)
   WHERE id = COALESCE(NEW.checklist_id, OLD.checklist_id);
  RETURN NULL; -- AFTER trigger: the return value is discarded.
END;
$$;

DROP TRIGGER IF EXISTS project_checklist_items_touch_parent ON public.project_checklist_items;
CREATE TRIGGER project_checklist_items_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.project_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_checklist_from_item();

-- Workflow items hang off a phase, so the workflow is two hops away.
CREATE OR REPLACE FUNCTION public.touch_workflow_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.project_workflows w
     SET updated_at = now(),
         updated_by = COALESCE(auth.uid(), w.updated_by)
    FROM public.project_workflow_phases ph
   WHERE ph.id = COALESCE(NEW.phase_id, OLD.phase_id)
     AND w.id = ph.workflow_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS project_workflow_items_touch_parent ON public.project_workflow_items;
CREATE TRIGGER project_workflow_items_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.project_workflow_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_workflow_from_item();

-- Report sections are the body of the report, so editing one is editing it.
CREATE OR REPLACE FUNCTION public.touch_report_from_section()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.project_reports
     SET updated_at = now(),
         updated_by = COALESCE(auth.uid(), updated_by)
   WHERE id = COALESCE(NEW.report_id, OLD.report_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS project_report_sections_touch_parent ON public.project_report_sections;
CREATE TRIGGER project_report_sections_touch_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.project_report_sections
  FOR EACH ROW EXECUTE FUNCTION public.touch_report_from_section();

-- ---------------------------------------------------------------------------
-- 4. Say what landed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  trg integer;
BEGIN
  SELECT count(*) INTO trg
  FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgname IN (
      'project_checklists_updated_attribution',
      'project_workflows_updated_attribution',
      'project_reports_updated_attribution',
      'project_pages_updated_attribution',
      'tasks_updated_attribution',
      'project_checklist_items_touch_parent',
      'project_workflow_items_touch_parent',
      'project_report_sections_touch_parent'
    );
  RAISE NOTICE 'edit attribution: % of 8 triggers in place.', trg;
END $$;
