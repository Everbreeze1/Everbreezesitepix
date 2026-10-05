-- Checklists: Severity and Condition answer types, measurement units, and a
-- per-item "photo required" switch.
--
-- * `severity`  - 1 (Minor) to 5 (Critical): how bad an issue is. The existing
--                 `rating` runs the other way (5 = excellent), so it could not
--                 say "this is a 5, fix it now".
-- * `condition` - Good / Fair / Poor.
-- * `unit`      - what a Number item measures in (ft, in, sq ft, %, psi...).
--                 Null for every other type and for a unitless count.
-- * `photo_required` - the item is not done until a photo is attached, and the
--                 checklist cannot be completed while one is missing.
--
-- Idempotent, safe to re-run. Apply via the Everlumen Supabase SQL editor
-- (project ulmgvtuqjlzzadlwtiog) BEFORE the code that reads these columns
-- goes live.

SET lock_timeout = '5s';

-- 1) New columns, on the library template items and on project items alike.
ALTER TABLE public.checklist_template_items
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS photo_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_checklist_items
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS photo_required boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklist_template_items_unit_length'
  ) THEN
    ALTER TABLE public.checklist_template_items
      ADD CONSTRAINT checklist_template_items_unit_length CHECK (char_length(unit) <= 16);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_checklist_items_unit_length'
  ) THEN
    ALTER TABLE public.project_checklist_items
      ADD CONSTRAINT project_checklist_items_unit_length CHECK (char_length(unit) <= 16);
  END IF;
END $$;

-- 2) Widen the answer-type vocabulary.
ALTER TABLE public.checklist_template_items
  DROP CONSTRAINT IF EXISTS checklist_template_items_item_type_check;
ALTER TABLE public.checklist_template_items
  ADD CONSTRAINT checklist_template_items_item_type_check
  CHECK (item_type IN ('checkbox','rating','text','pass_fail','numeric','yes_no','severity','condition'));

ALTER TABLE public.project_checklist_items
  DROP CONSTRAINT IF EXISTS project_checklist_items_item_type_check;
ALTER TABLE public.project_checklist_items
  ADD CONSTRAINT project_checklist_items_item_type_check
  CHECK (item_type IN ('checkbox','rating','text','pass_fail','numeric','yes_no','severity','condition'));

-- 3) The unit and the photo switch are checklist structure, so only the people
--    who may author a checklist may change them. Same function as
--    20261008000000, with the two new columns added to the structure test.
CREATE OR REPLACE FUNCTION public.enforce_project_checklist_item_authoring()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      NEW.checklist_id IS DISTINCT FROM OLD.checklist_id
      OR NEW.position IS DISTINCT FROM OLD.position
      OR NEW.label IS DISTINCT FROM OLD.label
      OR NEW.required IS DISTINCT FROM OLD.required
      OR NEW.item_type IS DISTINCT FROM OLD.item_type
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.unit IS DISTINCT FROM OLD.unit
      OR NEW.photo_required IS DISTINCT FROM OLD.photo_required
    ) THEN
      RETURN NEW;
    END IF;

    IF NEW.checklist_id IS DISTINCT FROM OLD.checklist_id
       AND NOT public.can_author_checklist(auth.uid(), OLD.checklist_id) THEN
      RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit checklist structure.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  _target := CASE WHEN TG_OP = 'DELETE' THEN OLD.checklist_id ELSE NEW.checklist_id END;
  IF NOT public.can_author_checklist(auth.uid(), _target) THEN
    RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit checklist structure.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
