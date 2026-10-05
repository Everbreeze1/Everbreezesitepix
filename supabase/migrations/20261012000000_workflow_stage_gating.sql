-- Workflow stages that wait for their proof.
--
-- A workflow's phases are the job's stages. Until now a stage counted as done
-- on its own the moment every step happened to be filled in, photo steps were
-- optional unless someone flipped them, stages could be worked in any order,
-- and a workflow could be closed with stages still open. This makes stages
-- real gates:
--
-- * A stage is done when someone marks it done (`completed_at`), and the
--   database refuses that while a required step or the sign-off is missing, or
--   while an earlier stage is still open (unless a manager unlocked it).
-- * Taking a requirement away again (removing the photo, reopening the linked
--   checklist, clearing the sign-off) takes "done" back.
-- * A workflow cannot be closed while any stage is open.
-- * A new `checklist` step links a checklist to a stage. Applying the workflow
--   creates that checklist on the project, and the step is done when the
--   checklist is completed.
-- * A manager can unlock a stage early (`unlocked_at`).
--
-- Walkthrough runs share these tables but are shot lists, so they keep working
-- exactly as before.
--
-- Idempotent, safe to re-run. Apply via the Everlumen Supabase SQL editor
-- (project ulmgvtuqjlzzadlwtiog) BEFORE the code that reads these columns
-- goes live. Self-contained: it also creates the phase columns from
-- 20261009000000 if that file was never run.

SET lock_timeout = '5s';

-- =========================================================================
-- 1. COLUMNS
-- =========================================================================

ALTER TABLE public.project_workflow_phases
  ADD COLUMN IF NOT EXISTS phase_type text NOT NULL DEFAULT 'actionable',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unlocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS unlocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.workflow_template_phases
  ADD COLUMN IF NOT EXISTS phase_type text NOT NULL DEFAULT 'actionable';

-- The checklist a `checklist` step links: a library template on the template
-- step, and the project checklist made from it on the project step.
ALTER TABLE public.workflow_template_items
  ADD COLUMN IF NOT EXISTS checklist_template_id uuid
    REFERENCES public.checklist_templates(id) ON DELETE SET NULL;

ALTER TABLE public.project_workflow_items
  ADD COLUMN IF NOT EXISTS checklist_template_id uuid
    REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checklist_id uuid
    REFERENCES public.project_checklists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS project_workflow_items_checklist_id_idx
  ON public.project_workflow_items(checklist_id) WHERE checklist_id IS NOT NULL;

-- Widen the step kinds.
ALTER TABLE public.workflow_template_items
  DROP CONSTRAINT IF EXISTS workflow_template_items_kind_check;
ALTER TABLE public.workflow_template_items
  ADD CONSTRAINT workflow_template_items_kind_check
  CHECK (kind IN ('check', 'photo', 'note', 'checklist'));

ALTER TABLE public.project_workflow_items
  DROP CONSTRAINT IF EXISTS project_workflow_items_kind_check;
ALTER TABLE public.project_workflow_items
  ADD CONSTRAINT project_workflow_items_kind_check
  CHECK (kind IN ('check', 'photo', 'note', 'checklist'));

-- =========================================================================
-- 2. WHAT A STAGE STILL NEEDS
-- =========================================================================
-- "2 photos, 1 check and sign-off", or NULL when nothing is missing. Same
-- wording and order as `describeMissing` in packages/shared/src/workflow-stages.ts.
-- Only required steps block. A checklist step whose checklist was deleted has
-- nothing left to wait for.

CREATE OR REPLACE FUNCTION public.workflow_stage_missing(
  _phase_id uuid,
  _requires_signoff boolean,
  _signed_off_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _photos int;
  _checks int;
  _notes int;
  _lists int;
  _parts text[] := '{}';
  _n int;
BEGIN
  SELECT
    count(*) FILTER (WHERE i.kind = 'photo' AND i.photo_id IS NULL),
    count(*) FILTER (WHERE i.kind = 'check' AND i.completed_at IS NULL),
    count(*) FILTER (WHERE i.kind = 'note' AND (i.note_text IS NULL OR btrim(i.note_text) = '')),
    count(*) FILTER (WHERE i.kind = 'checklist' AND i.checklist_id IS NOT NULL AND i.completed_at IS NULL)
    INTO _photos, _checks, _notes, _lists
  FROM public.project_workflow_items i
  WHERE i.phase_id = _phase_id AND i.required;

  IF _photos > 0 THEN
    _parts := _parts || (_photos || CASE WHEN _photos = 1 THEN ' photo' ELSE ' photos' END);
  END IF;
  IF _checks > 0 THEN
    _parts := _parts || (_checks || CASE WHEN _checks = 1 THEN ' check' ELSE ' checks' END);
  END IF;
  IF _notes > 0 THEN
    _parts := _parts || (_notes || CASE WHEN _notes = 1 THEN ' note' ELSE ' notes' END);
  END IF;
  IF _lists > 0 THEN
    _parts := _parts || (_lists || CASE WHEN _lists = 1 THEN ' checklist' ELSE ' checklists' END);
  END IF;
  IF _requires_signoff AND _signed_off_at IS NULL THEN
    _parts := _parts || 'sign-off'::text;
  END IF;

  _n := cardinality(_parts);
  IF _n = 0 THEN RETURN NULL; END IF;
  IF _n = 1 THEN RETURN _parts[1]; END IF;
  RETURN array_to_string(_parts[1:_n - 1], ', ') || ' and ' || _parts[_n];
END;
$$;

REVOKE ALL ON FUNCTION public.workflow_stage_missing(uuid, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workflow_stage_missing(uuid, boolean, timestamptz) TO authenticated;

-- =========================================================================
-- 3. MARKING A STAGE DONE, AND CLOSING A WORKFLOW
-- =========================================================================

CREATE OR REPLACE FUNCTION public.guard_workflow_stage_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _run_kind text;
  _missing text;
  _waiting text;
BEGIN
  IF NEW.completed_at IS NULL OR OLD.completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(to_jsonb(w) ->> 'source_kind', 'workflow') INTO _run_kind
    FROM public.project_workflows w
   WHERE w.id = NEW.workflow_id;
  IF _run_kind = 'walkthrough' THEN
    RETURN NEW;
  END IF;

  _missing := public.workflow_stage_missing(NEW.id, NEW.requires_signoff, NEW.signed_off_at);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'This stage still needs %.', _missing
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.unlocked_at IS NULL THEN
    SELECT ph.name INTO _waiting
      FROM public.project_workflow_phases ph
     WHERE ph.workflow_id = NEW.workflow_id
       AND ph.id <> NEW.id
       AND ph.position < NEW.position
       AND ph.completed_at IS NULL
     ORDER BY ph.position
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Finish "%" first.', _waiting
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflow_phases_guard_done ON public.project_workflow_phases;
CREATE TRIGGER project_workflow_phases_guard_done
  BEFORE UPDATE OF completed_at ON public.project_workflow_phases
  FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_stage_done();

CREATE OR REPLACE FUNCTION public.guard_workflow_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _open text;
BEGIN
  IF NEW.completed_at IS NULL OR OLD.completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF coalesce(to_jsonb(NEW) ->> 'source_kind', 'workflow') = 'walkthrough' THEN
    RETURN NEW;
  END IF;

  SELECT ph.name INTO _open
    FROM public.project_workflow_phases ph
   WHERE ph.workflow_id = NEW.id
     AND ph.completed_at IS NULL
   ORDER BY ph.position
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Mark "%" done before closing this workflow.', _open
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflows_guard_close ON public.project_workflows;
CREATE TRIGGER project_workflows_guard_close
  BEFORE UPDATE OF completed_at ON public.project_workflows
  FOR EACH ROW EXECUTE FUNCTION public.guard_workflow_close();

-- =========================================================================
-- 4. RECOMPUTE: STAGES ARE MARKED BY HAND, BUT LOSE "DONE" ON THEIR OWN
-- =========================================================================
-- Replaces the 20261009000000 version, which set `completed_at` the moment the
-- last step was filled. A staged run now only ever has "done" taken back here,
-- when a requirement stops being met. Walkthrough runs keep the old rule.

CREATE OR REPLACE FUNCTION public.recompute_phase_completion(_phase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _phase record;
  _req_total  bigint;
  _req_done   bigint;
  _item_total bigint;
  _item_done  bigint;
  _complete   boolean;
  _now        timestamptz := now();
BEGIN
  IF _phase_id IS NULL THEN RETURN; END IF;

  SELECT p.id, p.requires_signoff, p.signed_off_at, p.completed_at,
         coalesce(to_jsonb(w) ->> 'source_kind', 'workflow') AS run_kind
    INTO _phase
    FROM public.project_workflow_phases p
    JOIN public.project_workflows w ON w.id = p.workflow_id
   WHERE p.id = _phase_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF _phase.run_kind <> 'walkthrough' THEN
    IF _phase.completed_at IS NOT NULL
       AND public.workflow_stage_missing(_phase_id, _phase.requires_signoff, _phase.signed_off_at) IS NOT NULL THEN
      UPDATE public.project_workflow_phases
         SET completed_at = NULL, completed_by = NULL
       WHERE id = _phase_id;
    END IF;
    RETURN;
  END IF;

  -- Walkthrough runs: unchanged from 20261009000000.
  SELECT
    count(*) FILTER (WHERE i.required),
    count(*) FILTER (WHERE i.required AND i.done),
    count(*),
    count(*) FILTER (WHERE i.done)
    INTO _req_total, _req_done, _item_total, _item_done
  FROM (
    SELECT
      i.required,
      (i.kind = 'photo' AND i.photo_id IS NOT NULL)
      OR (i.kind = 'note' AND i.note_text IS NOT NULL AND btrim(i.note_text) <> '')
      OR (i.kind = 'check' AND i.completed_at IS NOT NULL) AS done
    FROM public.project_workflow_items i
    WHERE i.phase_id = _phase_id
  ) i;

  IF _req_total = 0 THEN
    _complete := false;
  ELSE
    _complete := _req_done = _req_total
             AND _item_done = _item_total
             AND (NOT _phase.requires_signoff OR _phase.signed_off_at IS NOT NULL);
  END IF;

  UPDATE public.project_workflow_phases
     SET completed_at = CASE WHEN _complete THEN _now ELSE NULL END,
         completed_by = CASE WHEN _complete THEN auth.uid() ELSE NULL END
   WHERE id = _phase_id
     AND (CASE WHEN _complete THEN _now ELSE NULL END) IS DISTINCT FROM completed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_phase_after_item_change() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_phase_completion(OLD.phase_id);
    RETURN OLD;
  END IF;

  PERFORM public.recompute_phase_completion(NEW.phase_id);
  IF TG_OP = 'UPDATE' AND OLD.phase_id IS DISTINCT FROM NEW.phase_id THEN
    PERFORM public.recompute_phase_completion(OLD.phase_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflow_items_recompute_phase ON public.project_workflow_items;
CREATE TRIGGER project_workflow_items_recompute_phase
  AFTER INSERT OR UPDATE OR DELETE ON public.project_workflow_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_phase_after_item_change();

CREATE OR REPLACE FUNCTION public.recompute_phase_after_signoff() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_phase_completion(OLD.id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_phase_completion(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflow_phases_recompute_completion ON public.project_workflow_phases;
CREATE TRIGGER project_workflow_phases_recompute_completion
  AFTER UPDATE OF signed_off_at, requires_signoff ON public.project_workflow_phases
  FOR EACH ROW EXECUTE FUNCTION public.recompute_phase_after_signoff();

-- A marker stage (no required step) can now be marked done too. It still gets
-- no drafted phase report, as before: there is nothing in it to report on.
CREATE OR REPLACE FUNCTION public.enqueue_phase_report() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL
     AND coalesce(to_jsonb(NEW) ->> 'phase_type', 'actionable') <> 'marker' THEN
    INSERT INTO public.workflow_automation (kind, project_id, workflow_id, phase_id, payload)
    SELECT 'phase_report', w.project_id, w.id, NEW.id,
           jsonb_build_object('phase_name', NEW.name, 'workflow_name', w.name)
      FROM public.project_workflows w
     WHERE w.id = NEW.workflow_id;
  END IF;
  RETURN NEW;
END;
$$;

-- =========================================================================
-- 5. CHECKLIST STEPS
-- =========================================================================
-- Applying a workflow copies each `checklist` step with its library template
-- id. This makes the project checklist from that template and links it, so
-- every way a workflow lands on a job (web, app, blueprint) gets the same
-- checklist. Runs as the caller (no SECURITY DEFINER): the caller must be able
-- to read the template and add checklists to this project, exactly as when
-- they add the checklist by hand. The blueprint service runs as the service
-- role and is unaffected.

CREATE OR REPLACE FUNCTION public.attach_workflow_step_checklist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  _wf record;
  _tpl record;
  _new uuid;
BEGIN
  IF NEW.kind <> 'checklist' OR NEW.checklist_id IS NOT NULL OR NEW.checklist_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT w.project_id, w.created_by, w.assigned_to, w.assigned_by INTO _wf
    FROM public.project_workflow_phases ph
    JOIN public.project_workflows w ON w.id = ph.workflow_id
   WHERE ph.id = NEW.phase_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT t.id, t.name INTO _tpl
    FROM public.checklist_templates t
   WHERE t.id = NEW.checklist_template_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.project_checklists
    (project_id, template_id, name, created_by, assigned_to, assigned_by)
  VALUES
    (_wf.project_id, _tpl.id, _tpl.name, coalesce(auth.uid(), _wf.created_by),
     _wf.assigned_to, CASE WHEN _wf.assigned_to IS NULL THEN NULL ELSE _wf.assigned_by END)
  RETURNING id INTO _new;

  INSERT INTO public.project_checklist_items
    (checklist_id, position, label, required, item_type, description, unit, photo_required)
  SELECT _new,
         (row_number() OVER (ORDER BY i.position, i.created_at) - 1)::int,
         i.label, i.required, i.item_type, i.description, i.unit, i.photo_required
    FROM public.checklist_template_items i
   WHERE i.template_id = _tpl.id;

  NEW.checklist_id := _new;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflow_items_attach_checklist ON public.project_workflow_items;
CREATE TRIGGER project_workflow_items_attach_checklist
  BEFORE INSERT ON public.project_workflow_items
  FOR EACH ROW EXECUTE FUNCTION public.attach_workflow_step_checklist();

-- The step mirrors its checklist: completing the checklist completes the step,
-- reopening it reopens the step (and with it the stage, via the recompute).
CREATE OR REPLACE FUNCTION public.sync_workflow_checklist_steps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.project_workflow_items
     SET completed_at = NEW.completed_at,
         completed_by = CASE WHEN NEW.completed_at IS NULL THEN NULL ELSE NEW.completed_by END
   WHERE checklist_id = NEW.id
     AND completed_at IS DISTINCT FROM NEW.completed_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_checklists_sync_workflow_steps ON public.project_checklists;
CREATE TRIGGER project_checklists_sync_workflow_steps
  AFTER UPDATE OF completed_at ON public.project_checklists
  FOR EACH ROW EXECUTE FUNCTION public.sync_workflow_checklist_steps();

-- Handing the workflow to someone hands them its linked checklists too, so a
-- crew member who only sees assigned work can open the checklist their stage
-- is waiting on. Only checklists nobody else was given are moved.
CREATE OR REPLACE FUNCTION public.sync_workflow_checklist_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN
    RETURN NEW;
  END IF;
  UPDATE public.project_checklists c
     SET assigned_to = NEW.assigned_to,
         assigned_by = CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE NEW.assigned_by END
   WHERE c.id IN (
           SELECT i.checklist_id
             FROM public.project_workflow_items i
             JOIN public.project_workflow_phases ph ON ph.id = i.phase_id
            WHERE ph.workflow_id = NEW.id
              AND i.checklist_id IS NOT NULL
         )
     AND c.completed_at IS NULL
     AND (c.assigned_to IS NULL OR c.assigned_to IS NOT DISTINCT FROM OLD.assigned_to);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_workflows_sync_checklist_assignee ON public.project_workflows;
CREATE TRIGGER project_workflows_sync_checklist_assignee
  AFTER UPDATE OF assigned_to ON public.project_workflows
  FOR EACH ROW EXECUTE FUNCTION public.sync_workflow_checklist_assignee();

-- =========================================================================
-- 6. WHO MAY CHANGE WHAT
-- =========================================================================
-- Unlocking a stage early is a manager's call, so `unlocked_at` joins the
-- phase structure that only Owners, Admins and Managers may change. Which
-- checklist a step links is step structure. Same functions as
-- 20261008000000 with those columns added.

CREATE OR REPLACE FUNCTION public.enforce_project_workflow_phase_authoring()
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
      NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
      OR NEW.position IS DISTINCT FROM OLD.position
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.requires_signoff IS DISTINCT FROM OLD.requires_signoff
      OR NEW.unlocked_at IS DISTINCT FROM OLD.unlocked_at
      OR NEW.unlocked_by IS DISTINCT FROM OLD.unlocked_by
    ) THEN
      RETURN NEW;
    END IF;

    IF NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
       AND NOT public.can_author_workflow(auth.uid(), OLD.workflow_id) THEN
      RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  _target := CASE WHEN TG_OP = 'DELETE' THEN OLD.workflow_id ELSE NEW.workflow_id END;
  IF NOT public.can_author_workflow(auth.uid(), _target) THEN
    RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_project_workflow_item_authoring()
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
      NEW.phase_id IS DISTINCT FROM OLD.phase_id
      OR NEW.position IS DISTINCT FROM OLD.position
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.label IS DISTINCT FROM OLD.label
      OR NEW.required IS DISTINCT FROM OLD.required
      OR NEW.checklist_template_id IS DISTINCT FROM OLD.checklist_template_id
      -- A deleted checklist nulls this through its foreign key; that is not
      -- someone editing the step.
      OR (NEW.checklist_id IS DISTINCT FROM OLD.checklist_id AND NEW.checklist_id IS NOT NULL)
    ) THEN
      RETURN NEW;
    END IF;

    IF NEW.phase_id IS DISTINCT FROM OLD.phase_id
       AND NOT public.can_author_workflow_phase(auth.uid(), OLD.phase_id) THEN
      RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  _target := CASE WHEN TG_OP = 'DELETE' THEN OLD.phase_id ELSE NEW.phase_id END;
  IF NOT public.can_author_workflow_phase(auth.uid(), _target) THEN
    RAISE EXCEPTION 'Only an Owner, Admin, or Manager on Pro or Team can edit workflow structure.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
