-- PHOTO AUTO-TAGGING (Workflow Automation Spec #1).
--
-- A photo captured against a workflow step used to carry only a caption (the
-- step label) and `phase = 'workflow'`. That is a caption, not structured
-- metadata: nothing on the photo says which workflow or which phase it belongs
-- to, so the project gallery cannot group photos by phase/step without a person
-- hand-labelling them.
--
-- This migration gives a photo two structured pointers - `workflow_id` and
-- `workflow_phase_id` - and stamps them automatically the moment a photo is
-- linked to a workflow step, via a trigger on `project_workflow_items`. Because
-- the rule lives in the database, every capture path (web, mobile, and any
-- future one) gets the same tagging with no client change, and a step's photo
-- is always labelled with the phase it was captured against.
--
-- The step label itself is already recorded in the photo's `caption` by both
-- capture flows, so the three pieces the spec names - workflow, phase, step -
-- are all present: two as columns, one as the caption.
--
-- Idempotent, safe to re-run. Apply via the Everlumen Supabase SQL editor
-- (project ulmgvtuqjlzzadlwtiog) or `supabase db push`.

SET lock_timeout = '5s';

-- =========================================================================
-- 1. COLUMNS
-- =========================================================================
ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES public.project_workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workflow_phase_id uuid REFERENCES public.project_workflow_phases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS photos_workflow_phase_id_idx
  ON public.photos(workflow_phase_id) WHERE workflow_phase_id IS NOT NULL;

-- =========================================================================
-- 2. AUTO-TAG ON LINK
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tag_photo_with_workflow_step() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _workflow_id uuid;
BEGIN
  -- A photo that is no longer the step's photo loses its provenance, so a
  -- detached or re-taken photo does not keep pointing at the old phase.
  IF (TG_OP = 'DELETE')
     OR (TG_OP = 'UPDATE' AND OLD.photo_id IS NOT NULL AND OLD.photo_id IS DISTINCT FROM NEW.photo_id)
  THEN
    UPDATE public.photos
       SET workflow_id = NULL, workflow_phase_id = NULL
     WHERE id = OLD.photo_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.photo_id IS NULL THEN RETURN NEW; END IF;

  SELECT ph.workflow_id INTO _workflow_id
    FROM public.project_workflow_phases ph
   WHERE ph.id = NEW.phase_id;

  UPDATE public.photos
     SET workflow_id = _workflow_id,
         workflow_phase_id = NEW.phase_id
   WHERE id = NEW.photo_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflow_items_tag_photo ON public.project_workflow_items;
CREATE TRIGGER project_workflow_items_tag_photo
  AFTER INSERT OR UPDATE OF photo_id, phase_id ON public.project_workflow_items
  FOR EACH ROW EXECUTE FUNCTION public.tag_photo_with_workflow_step();

-- =========================================================================
-- VERIFY
-- =========================================================================
-- Columns - expect the two provenance pointers on photos.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'photos'
  AND column_name IN ('workflow_id', 'workflow_phase_id')
ORDER BY column_name;

-- Trigger - expect the auto-tag trigger installed on workflow items.
SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgname = 'project_workflow_items_tag_photo';
