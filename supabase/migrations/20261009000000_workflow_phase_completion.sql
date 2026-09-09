-- WORKFLOW PHASES BECOME A REAL, DETECTABLE EVENT.
--
-- The Workflow Automation Spec's prerequisite (its section 2): workflows today
-- are a checklist, not automation. A phase's "done-ness" is computed in the
-- browser (web `ProjectWorkflows.tsx`, mobile `workflow-state.ts`) and never
-- written anywhere, so nothing can fire when a phase completes - "phase
-- complete" is a status a human toggles by feel rather than an event a trigger
-- can hang off. Every trigger in the rest of the spec depends on this event.
--
-- This migration gives a phase a persisted `completed_at`, maintained by a
-- trigger that recomputes it from the phase's items using the same rule both
-- clients already agree on:
--
--   * a `photo` step is done when a photo is attached,
--   * a `note` step when it has non-blank text,
--   * a `check` step when it is ticked (`completed_at` is set),
--   * sign-off, when required, must also be present,
--   * and every step - not just the required ones - must be done.
--
-- It also records the two phase types the spec asks the editor to distinguish:
-- `marker` (informational only - no required step - nothing to automate) and
-- `actionable` (has at least one required step). Automation keys off "has a
-- required step" rather than trusting the flag, so a phase the editor left on
-- the default can never silently start firing. A marker phase keeps
-- `completed_at` NULL: there is nothing measurable to detect, exactly as the
-- spec asks, and it stays exactly as it works today.
--
-- Finally, an actionable phase completing raises a `workflow_phase_advanced`
-- notification to whoever the workflow is assigned to (or its creator), naming
-- the next phase. Internal only - in-app and email, never a customer-facing
-- touchpoint and never Twilio/SMS.
--
-- Idempotent, safe to re-run. Apply via the Everlumen Supabase SQL editor
-- (project ulmgvtuqjlzzadlwtiog) or `supabase db push`.

SET lock_timeout = '5s';

-- =========================================================================
-- 1. COLUMNS
-- =========================================================================

-- Template phases: the editor distinguishes marker vs actionable.
ALTER TABLE public.workflow_template_phases
  ADD COLUMN IF NOT EXISTS phase_type text NOT NULL DEFAULT 'actionable';
ALTER TABLE public.workflow_template_phases
  DROP CONSTRAINT IF EXISTS workflow_template_phases_phase_type_check;
ALTER TABLE public.workflow_template_phases
  ADD CONSTRAINT workflow_template_phases_phase_type_check
  CHECK (phase_type IN ('marker', 'actionable'));

-- Project phases: the same flag, plus the persisted completion signal.
ALTER TABLE public.project_workflow_phases
  ADD COLUMN IF NOT EXISTS phase_type text NOT NULL DEFAULT 'actionable';
ALTER TABLE public.project_workflow_phases
  DROP CONSTRAINT IF EXISTS project_workflow_phases_phase_type_check;
ALTER TABLE public.project_workflow_phases
  ADD CONSTRAINT project_workflow_phases_phase_type_check
  CHECK (phase_type IN ('marker', 'actionable'));
ALTER TABLE public.project_workflow_phases
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- =========================================================================
-- 2. BACKFILL - a phase with no required step is a marker
-- =========================================================================
-- New rows keep the default `actionable`, which is safe: the completion trigger
-- below still keys off the live item count rather than this flag, so a phase
-- the editor never labelled cannot start firing on its own.

UPDATE public.workflow_template_phases p
   SET phase_type = CASE WHEN EXISTS (
     SELECT 1 FROM public.workflow_template_items i
      WHERE i.phase_id = p.id AND i.required
   ) THEN 'actionable' ELSE 'marker' END;

UPDATE public.project_workflow_phases p
   SET phase_type = CASE WHEN EXISTS (
     SELECT 1 FROM public.project_workflow_items i
      WHERE i.phase_id = p.id AND i.required
   ) THEN 'actionable' ELSE 'marker' END;

-- =========================================================================
-- 3. RECOMPUTE PHASE COMPLETION
-- =========================================================================

CREATE OR REPLACE FUNCTION public.recompute_phase_completion(_phase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req_total  bigint;
  _req_done   bigint;
  _item_total bigint;
  _item_done  bigint;
  _needs_signoff boolean;
  _signed_off     boolean;
  _complete   boolean;
  _now        timestamptz := now();
  _actor      uuid := auth.uid();
BEGIN
  IF _phase_id IS NULL THEN RETURN; END IF;

  -- "is this item done" matches isItemComplete in the clients: photo -> has a
  -- photo, note -> has non-blank text, check -> ticked.
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

  -- A marker phase (no required step) has nothing measurable; leave it NULL so
  -- no automation fires off it.
  IF _req_total = 0 THEN
    _complete := false;
  ELSE
    SELECT p.requires_signoff, (p.signed_off_at IS NOT NULL)
      INTO _needs_signoff, _signed_off
      FROM public.project_workflow_phases p
     WHERE p.id = _phase_id;

    _complete := _req_done = _req_total
             AND _item_done = _item_total
             AND (NOT _needs_signoff OR _signed_off);
  END IF;

  UPDATE public.project_workflow_phases
     SET completed_at = CASE WHEN _complete THEN _now ELSE NULL END,
         completed_by = CASE WHEN _complete THEN _actor ELSE NULL END
   WHERE id = _phase_id
     AND (CASE WHEN _complete THEN _now ELSE NULL END) IS DISTINCT FROM completed_at;
END;
$$;

-- Item writes are the most common way a phase completes, but they are the only
-- path that can also un-complete it (un-tick a required check), so the rule is
-- recomputed on every item change rather than only on the "done" direction.
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

-- Sign-off (and flipping whether it is required) also decides completion, so a
-- phase whose last missing piece is a signature completes the moment it is
-- signed rather than the next time an item happens to be touched.
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

-- =========================================================================
-- 4. NOTIFY ON PHASE ADVANCE
-- =========================================================================
-- Spec trigger #7: when a phase closes, tell whoever is on the job which phase
-- is now active. Internal only; the recipient is the workflow's assignee, or
-- its creator when nobody was handed the job.
CREATE OR REPLACE FUNCTION public.notify_phase_advanced() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _workflow  record;
  _next_name text;
  _recipient uuid;
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    SELECT w.* INTO _workflow
      FROM public.project_workflows w
     WHERE w.id = NEW.workflow_id;
    IF NOT FOUND THEN RETURN NEW; END IF;

    SELECT ph.name INTO _next_name
      FROM public.project_workflow_phases ph
     WHERE ph.workflow_id = NEW.workflow_id
       AND ph.position > NEW.position
       AND ph.completed_at IS NULL
     ORDER BY ph.position ASC
     LIMIT 1;

    _recipient := COALESCE(_workflow.assigned_to, _workflow.created_by);

    PERFORM public.create_notification(
      _recipient,
      COALESCE(NEW.completed_by, auth.uid()),
      'workflow_phase_advanced',
      'Phase completed',
      CASE WHEN _next_name IS NOT NULL
        THEN 'Next phase: ' || _next_name
        ELSE 'Final phase complete.'
      END,
      '/projects/' || _workflow.project_id,
      _workflow.project_id, 'workflow', _workflow.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflows_notify_phase_advanced ON public.project_workflow_phases;
CREATE TRIGGER workflows_notify_phase_advanced
  AFTER UPDATE OF completed_at ON public.project_workflow_phases
  FOR EACH ROW EXECUTE FUNCTION public.notify_phase_advanced();

-- =========================================================================
-- 5. WIDEN THE NOTIFICATION TYPE CHECK
-- =========================================================================
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'task_assigned', 'checklist_assigned', 'photo_comment_mention', 'team_invite_accepted',
  'admin_announcement',
  'workflow_assigned',
  'task_completed', 'checklist_completed', 'workflow_completed',
  'task_comment', 'task_watching', 'task_updated',
  'project_assigned',
  -- new: a workflow phase advanced on its own
  'workflow_phase_advanced'
));

-- =========================================================================
-- VERIFY
-- =========================================================================
-- Columns - expect phase_type on both phase tables and the completion columns
-- on project phases.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'workflow_template_phases' AND column_name = 'phase_type')
    OR (table_name = 'project_workflow_phases' AND column_name IN ('phase_type', 'completed_at', 'completed_by')))
ORDER BY table_name, column_name;

-- Triggers - expect the two recompute triggers and the notify trigger.
SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgname IN ('project_workflow_items_recompute_phase', 'project_workflow_phases_recompute_completion', 'workflows_notify_phase_advanced')
ORDER BY c.relname, t.tgname;

-- Notification type widened - expect workflow_phase_advanced in the list.
SELECT pg_get_constraintdef(oid) AS type_check
FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass
  AND conname = 'notifications_type_check';


