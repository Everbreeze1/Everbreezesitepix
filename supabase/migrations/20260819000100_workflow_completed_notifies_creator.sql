-- Fix: a completed workflow told the wrong person, when nobody was assigned.
--
-- 20260819000000 gave checklists, tasks and workflows the same completion
-- notification, addressed to `COALESCE(assigned_by, <the record's owner>)` -
-- the assignor, or whoever created the thing if it was never handed over.
-- Checklists and tasks resolve that second half as `NEW.created_by`. Workflows
-- did not, because that migration was written believing `project_workflows` had
-- no `created_by` column and fell back to the *project* owner instead:
--
--     SELECT p.created_by INTO _owner FROM projects p WHERE p.id = NEW.project_id;
--
-- `project_workflows.created_by` has existed since 20260616050717 and is NOT
-- NULL. The claim in that comment was simply wrong.
--
-- What it costs: nothing while work is assigned, since `assigned_by` wins and
-- the fallback never runs. It only shows on an *unassigned* workflow - the case
-- where someone picks up a run nobody handed out. There the report went to
-- whoever owns the project rather than whoever set the workflow up, and on any
-- team where a manager applies workflows to jobs they did not create, those are
-- different people: the manager builds the run, the notification goes to the
-- project's owner, and the manager hears nothing.
--
-- It also broke the rule the feature exists to state - that this relationship
-- reads the same on every kind of work. Two records could be closed the same
-- way and notify different people for reasons nothing in the UI explained.
--
-- Same trigger, same signature; only the recipient expression changes, so the
-- AFTER trigger installed by 20260819000000 picks this up with no re-attach.
--
-- Idempotent. Apply via the SitePix Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.notify_workflow_completed() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    PERFORM public.create_notification(
      COALESCE(NEW.assigned_by, NEW.created_by),
      auth.uid(),
      'workflow_completed',
      'Workflow completed', NEW.name,
      '/projects/' || NEW.project_id, NEW.project_id, 'workflow', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- === VERIFY ================================================================
-- Expect `true` - the recipient is now the workflow's own creator, and the
-- projects lookup is gone.
SELECT pg_get_functiondef(oid) LIKE '%COALESCE(NEW.assigned_by, NEW.created_by)%'
         AS uses_workflow_creator,
       pg_get_functiondef(oid) NOT LIKE '%FROM public.projects%'
         AS projects_lookup_removed
FROM pg_proc
WHERE proname = 'notify_workflow_completed'
  AND pronamespace = 'public'::regnamespace;

-- And that all three kinds now address the same person the same way - expect 3.
SELECT count(*) AS consistent_notifiers
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('notify_checklist_completed', 'notify_task_completed', 'notify_workflow_completed')
  AND pg_get_functiondef(oid) LIKE '%COALESCE(NEW.assigned_by, NEW.created_by)%';
