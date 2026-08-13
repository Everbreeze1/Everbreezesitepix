-- ASSIGNMENT — one relationship, spelled the same way on every kind of work.
--
-- Three tables hand work to a person: `project_checklists` (`assigned_to`),
-- `tasks` (`assignee_user_id`), and `project_workflows` — which carried no
-- assignee at all. Each recorded, at most, who the work went TO. None recorded
-- who sent it.
--
-- That missing half is why "whoever assigned this gets told when it's done"
-- could not be built: no column named them. `created_by` is a good enough guess
-- right up until a manager assigns work on a project someone else created,
-- which is the case the feature exists for.
--
-- So this migration adds `assigned_by` to all three, `assigned_to` to
-- workflows, and then states the rule the relationship exists to express:
--
--     the assignee marks it complete — the assignor is told, and can reopen it.
--
-- with a deliberate escape hatch: the assignor, and any workspace admin or
-- project manager, may also close it. A crew member goes unreachable mid-job
-- and the record still has to be closable by someone.
--
-- === WHY THE RULE LIVES HERE, NOT IN REACT =================================
-- The web app writes to these tables straight from the browser through the
-- Supabase client — there is no server handler in between (the RPC registry
-- carries only the two anonymous public-share readers). A check written in
-- React is therefore a check any user can skip with a single
-- `supabase.from('project_checklists').update({ completed_at: ... })` from the
-- console. The BEFORE UPDATE triggers below are the real rule. The UI mirrors
-- them so the button greys out before the write is refused, but the UI is the
-- mirror, not the lock.
--
-- Every guard is written `auth.uid() IS NOT NULL AND NOT allowed(...)`. Writes
-- made with the service-role key carry no JWT, so `auth.uid()` is NULL for
-- them — the backfills in this file, the public-share readers in
-- apps/api/src/domains/projects/field-records.ts, and any future admin tooling
-- must not be caught by a rule about which teammate did the tapping.
--
-- Idempotent, safe to re-run. Apply via the SitePix Supabase SQL editor
-- (project ulmgvtuqjlzzadlwtiog).

-- =========================================================================
-- 1. COLUMNS
-- =========================================================================

ALTER TABLE public.project_checklists
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Workflows become assignable for the first time. `assigned_to` mirrors the
-- checklist column name rather than the task one (`assignee_user_id`); two
-- spellings already exist and a third would be worse than picking the majority.
ALTER TABLE public.project_workflows
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS project_workflows_assigned_to_idx
  ON public.project_workflows(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_checklists_assigned_to_idx
  ON public.project_checklists(assigned_to) WHERE assigned_to IS NOT NULL;

COMMENT ON COLUMN public.project_checklists.assigned_by IS
  'Who handed this checklist to assigned_to. Notified on completion; may reopen it.';
COMMENT ON COLUMN public.tasks.assigned_by IS
  'Who handed this task to assignee_user_id. Notified on completion; may reopen it.';
COMMENT ON COLUMN public.project_workflows.assigned_by IS
  'Who handed this workflow to assigned_to. Notified on completion; may reopen it.';

-- Backfill: work that is already assigned has an assignor, and on every row
-- that exists today it can only have been the person who created the record —
-- nothing else was ever written. Rows with no assignee get no assignor, so the
-- column stays honest: NULL means "never handed to anyone".
UPDATE public.project_checklists
   SET assigned_by = created_by
 WHERE assigned_to IS NOT NULL AND assigned_by IS NULL;

UPDATE public.tasks
   SET assigned_by = created_by
 WHERE assignee_user_id IS NOT NULL AND assigned_by IS NULL;

-- =========================================================================
-- 2. WORKFLOW RLS — teammates, which workflows never got
-- =========================================================================
-- 20260612191404_teams.sql gave every shared table an additive "Teammates ..."
-- policy. It predates workflows (20260616050717) by four days and no later
-- migration filled the gap, so `project_workflows` and its children are still
-- gated on `projects.created_by = auth.uid()` alone — exactly the bug that
-- 20260728120000 had to fix for `tasks`.
--
-- Left alone, assigning a workflow would be a no-op with a notification
-- attached: the assignee opens the project and the workflow is not there. So
-- the assignability added above requires these policies to mean anything.
--
-- Additive. The owner-only policies remain and RLS unions them.
--
-- SELECT and UPDATE only, deliberately — the exact pair `tasks` was given, and
-- NOT `FOR ALL`.
--
-- A permissive `FOR ALL` policy here would have carried its own `WITH CHECK`,
-- and because RLS ORs permissive policies together for a command, that second
-- INSERT path would have satisfied inserts that the first one refuses. The
-- first one is 20260724010000_workflows_team_plan.sql, which restricts creating
-- a workflow to Team-plan workspaces. Adding `FOR ALL` would therefore have
-- quietly repealed the plan gate as a side effect of making workflows
-- assignable. Running one is not creating one, so the narrower grant is also
-- the correct one: a crew member ticks steps, signs off phases and attaches
-- photos, all of which are UPDATEs.

DROP POLICY IF EXISTS "Teammates manage team workflows" ON public.project_workflows;
DROP POLICY IF EXISTS "Teammates view team workflows" ON public.project_workflows;
CREATE POLICY "Teammates view team workflows" ON public.project_workflows
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_workflows.project_id
        AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

DROP POLICY IF EXISTS "Teammates update team workflows" ON public.project_workflows;
CREATE POLICY "Teammates update team workflows" ON public.project_workflows
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_workflows.project_id
        AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

DROP POLICY IF EXISTS "Teammates manage team workflow phases" ON public.project_workflow_phases;
DROP POLICY IF EXISTS "Teammates view team workflow phases" ON public.project_workflow_phases;
CREATE POLICY "Teammates view team workflow phases" ON public.project_workflow_phases
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflows w
      JOIN public.projects p ON p.id = w.project_id
      WHERE w.id = project_workflow_phases.workflow_id
        AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

DROP POLICY IF EXISTS "Teammates update team workflow phases" ON public.project_workflow_phases;
CREATE POLICY "Teammates update team workflow phases" ON public.project_workflow_phases
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflows w
      JOIN public.projects p ON p.id = w.project_id
      WHERE w.id = project_workflow_phases.workflow_id
        AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

DROP POLICY IF EXISTS "Teammates manage team workflow items" ON public.project_workflow_items;
DROP POLICY IF EXISTS "Teammates view team workflow items" ON public.project_workflow_items;
CREATE POLICY "Teammates view team workflow items" ON public.project_workflow_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflow_phases ph
      JOIN public.project_workflows w ON w.id = ph.workflow_id
      JOIN public.projects p ON p.id = w.project_id
      WHERE ph.id = project_workflow_items.phase_id
        AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

DROP POLICY IF EXISTS "Teammates update team workflow items" ON public.project_workflow_items;
CREATE POLICY "Teammates update team workflow items" ON public.project_workflow_items
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflow_phases ph
      JOIN public.project_workflows w ON w.id = ph.workflow_id
      JOIN public.projects p ON p.id = w.project_id
      WHERE ph.id = project_workflow_items.phase_id
        AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

-- =========================================================================
-- 3. WHO MAY CLOSE A PIECE OF WORK
-- =========================================================================

-- Workspace admin ('owner') or project manager ('admin') — the two roles the
-- Settings page labels as management. `is_team_admin` already exists but takes
-- a team id the callers here do not have, and has never been used by a policy.
CREATE OR REPLACE FUNCTION public.is_team_manager(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members m
    WHERE m.user_id = _user_id AND m.role IN ('owner', 'admin')
  );
$$;

/*
 * The completion rule, in one place so checklists, tasks and workflows cannot
 * drift apart — the client's requirement was that the assignor/assignee
 * relationship read the same across every feature that has one.
 *
 * Allowed to close:
 *   - nobody is assigned      — unassigned work belongs to whoever picks it up
 *   - the assignee            — they did it, and it timestamps to them
 *   - the assignor            — they own the outcome and can already reopen it
 *   - a manager               — the override, for when a tech is unavailable
 */
CREATE OR REPLACE FUNCTION public.may_complete_assignment(
  _assigned_to uuid,
  _assigned_by uuid,
  _actor uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _actor IS NOT NULL
     AND (
       _assigned_to IS NULL
       OR _assigned_to = _actor
       OR _assigned_by = _actor
       OR public.is_team_manager(_actor)
     );
$$;

GRANT EXECUTE ON FUNCTION public.is_team_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.may_complete_assignment(uuid, uuid, uuid) TO authenticated;

-- =========================================================================
-- 4. ENFORCEMENT — BEFORE UPDATE, so a refused close never lands
-- =========================================================================
-- Only the transition into completion is guarded. Reopening is deliberately
-- left open to anyone with write access: the assignor must be able to reopen
-- (that is the reviewing half of the feature), and a crew member who closed
-- something by mistake should be able to take it back without finding a
-- manager. Nothing is lost by reopening — the checklist snapshot is rebuilt on
-- the next close.
--
-- The guard reads OLD, not NEW. An UPDATE can change several columns at once,
-- so judging by NEW would let one statement hand the work to yourself and close
-- it in the same breath — `SET assigned_to = me, completed_at = now()` passes a
-- NEW-based check trivially, and RLS has no opinion about who may reassign. OLD
-- asks the question that actually matters: whose was this before you touched
-- it? No legitimate path is affected, because assigning and completing are
-- separate writes in every surface that does them.

CREATE OR REPLACE FUNCTION public.enforce_checklist_completer() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL
     AND auth.uid() IS NOT NULL
     AND NOT public.may_complete_assignment(OLD.assigned_to, OLD.assigned_by, auth.uid()) THEN
    RAISE EXCEPTION 'Only the assignee, the person who assigned it, or a manager can mark this checklist complete.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checklists_enforce_completer ON public.project_checklists;
CREATE TRIGGER checklists_enforce_completer
  BEFORE UPDATE OF completed_at ON public.project_checklists
  FOR EACH ROW EXECUTE FUNCTION public.enforce_checklist_completer();

-- Tasks carry both a status enum and a redundant `completed_at` kept in sync by
-- the client, so 'done' is the authority here and the timestamp follows it.
CREATE OR REPLACE FUNCTION public.enforce_task_completer() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done'
     AND auth.uid() IS NOT NULL
     AND NOT public.may_complete_assignment(OLD.assignee_user_id, OLD.assigned_by, auth.uid()) THEN
    RAISE EXCEPTION 'Only the assignee, the person who assigned it, or a manager can mark this task done.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_enforce_completer ON public.tasks;
CREATE TRIGGER tasks_enforce_completer
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_completer();

CREATE OR REPLACE FUNCTION public.enforce_workflow_completer() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL
     AND auth.uid() IS NOT NULL
     AND NOT public.may_complete_assignment(OLD.assigned_to, OLD.assigned_by, auth.uid()) THEN
    RAISE EXCEPTION 'Only the assignee, the person who assigned it, or a manager can mark this workflow complete.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflows_enforce_completer ON public.project_workflows;
CREATE TRIGGER workflows_enforce_completer
  BEFORE UPDATE OF completed_at ON public.project_workflows
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workflow_completer();

-- =========================================================================
-- 5. NOTIFICATION TYPES
-- =========================================================================
-- Full re-statement of the list, following 20260728170000: the constraint is
-- dropped and rebuilt rather than amended, so this file has to carry every
-- value that came before it.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'task_assigned', 'checklist_assigned', 'photo_comment_mention', 'team_invite_accepted',
  'admin_announcement',
  -- new: workflows are assignable, and all three report back when closed
  'workflow_assigned',
  'task_completed', 'checklist_completed', 'workflow_completed'
));

-- `entity_type`'s check was declared inline on the column in 20260728120000, so
-- its name was generated by Postgres rather than chosen. `notifications_type_check`
-- is known-good — 20260728170000 dropped it by that name and succeeded — but
-- nothing has ever proven the entity_type one, and guessing wrong here fails
-- silently in the worst way: the DROP does nothing, the ADD succeeds under a
-- fresh name, and the old constraint stays behind to reject every 'workflow'
-- row. So it is found by what it constrains instead of by what it is called.
DO $$
DECLARE
  _name text;
BEGIN
  FOR _name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.notifications'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%entity_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', _name);
  END LOOP;

  ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check CHECK (
    entity_type IN ('task', 'checklist', 'photo_comment', 'team_invite', 'workflow')
  );
END $$;

-- =========================================================================
-- 6. NOTIFY THE ASSIGNEE — workflows, matching tasks and checklists
-- =========================================================================

CREATE OR REPLACE FUNCTION public.notify_workflow_assignee() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM COALESCE(OLD.assigned_to, NULL) THEN
    PERFORM public.create_notification(
      NEW.assigned_to, auth.uid(), 'workflow_assigned',
      'New workflow assigned to you', NEW.name,
      '/projects/' || NEW.project_id, NEW.project_id, 'workflow', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflows_notify_assignee ON public.project_workflows;
CREATE TRIGGER workflows_notify_assignee
  AFTER INSERT OR UPDATE OF assigned_to ON public.project_workflows
  FOR EACH ROW EXECUTE FUNCTION public.notify_workflow_assignee();

-- =========================================================================
-- 7. NOTIFY THE ASSIGNOR — the review-or-reopen half of the loop
-- =========================================================================
-- Recipient is `assigned_by`, falling back to `created_by` for work that was
-- never formally handed over. `create_notification` drops the row when the
-- recipient is the actor, so a manager closing their own override notifies
-- nobody, and unassigned work someone closed themselves stays silent.
--
-- The link goes to the record, not the project: the point of the notification
-- is to review what was filled in.

CREATE OR REPLACE FUNCTION public.notify_checklist_completed() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    PERFORM public.create_notification(
      COALESCE(NEW.assigned_by, NEW.created_by),
      COALESCE(NEW.completed_by, auth.uid()),
      'checklist_completed',
      'Checklist completed', NEW.name,
      '/projects/' || NEW.project_id || '/checklists/' || NEW.id,
      NEW.project_id, 'checklist', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checklists_notify_completed ON public.project_checklists;
CREATE TRIGGER checklists_notify_completed
  AFTER UPDATE OF completed_at ON public.project_checklists
  FOR EACH ROW EXECUTE FUNCTION public.notify_checklist_completed();

CREATE OR REPLACE FUNCTION public.notify_task_completed() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    PERFORM public.create_notification(
      COALESCE(NEW.assigned_by, NEW.created_by),
      auth.uid(),
      'task_completed',
      'Task completed', NEW.title,
      '/projects/' || NEW.project_id, NEW.project_id, 'task', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_notify_completed ON public.tasks;
CREATE TRIGGER tasks_notify_completed
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_completed();

CREATE OR REPLACE FUNCTION public.notify_workflow_completed() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    -- `project_workflows` has no `created_by`; the project's owner is the
    -- nearest equivalent for a workflow nobody explicitly handed over.
    SELECT p.created_by INTO _owner FROM public.projects p WHERE p.id = NEW.project_id;
    PERFORM public.create_notification(
      COALESCE(NEW.assigned_by, _owner),
      auth.uid(),
      'workflow_completed',
      'Workflow completed', NEW.name,
      '/projects/' || NEW.project_id, NEW.project_id, 'workflow', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflows_notify_completed ON public.project_workflows;
CREATE TRIGGER workflows_notify_completed
  AFTER UPDATE OF completed_at ON public.project_workflows
  FOR EACH ROW EXECUTE FUNCTION public.notify_workflow_completed();

-- =========================================================================
-- VERIFY
-- =========================================================================
-- Columns — expect one row per table, all three `assigned_by` present.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'project_checklists' AND column_name IN ('assigned_to', 'assigned_by'))
    OR (table_name = 'tasks'              AND column_name IN ('assignee_user_id', 'assigned_by'))
    OR (table_name = 'project_workflows'  AND column_name IN ('assigned_to', 'assigned_by')))
ORDER BY table_name, column_name;

-- Triggers — expect 6 enforce/notify-completed rows plus the assignee notifiers.
SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgname IN (
    'checklists_enforce_completer', 'tasks_enforce_completer', 'workflows_enforce_completer',
    'checklists_notify_completed', 'tasks_notify_completed', 'workflows_notify_completed',
    'workflows_notify_assignee'
  )
ORDER BY c.relname, t.tgname;

-- Teammate reach into workflows — expect 6 rows: a view and an update policy on
-- each of the three workflow tables, and `cmd` never INSERT or ALL (see the
-- note in section 2 about the Team-plan gate).
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('project_workflows', 'project_workflow_phases', 'project_workflow_items')
  AND policyname LIKE 'Teammates%'
ORDER BY tablename, cmd;

-- And the gate those policies must not have widened — expect exactly one
-- INSERT policy on project_workflows, still carrying is_team_plan().
SELECT policyname, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'project_workflows'
  AND cmd IN ('INSERT', 'ALL');

-- Assignment coverage — `assigned_by` must be non-NULL wherever work is assigned.
SELECT 'checklists' AS kind,
       count(*) FILTER (WHERE assigned_to IS NOT NULL)                          AS assigned,
       count(*) FILTER (WHERE assigned_to IS NOT NULL AND assigned_by IS NULL)  AS missing_assignor
FROM public.project_checklists
UNION ALL
SELECT 'tasks',
       count(*) FILTER (WHERE assignee_user_id IS NOT NULL),
       count(*) FILTER (WHERE assignee_user_id IS NOT NULL AND assigned_by IS NULL)
FROM public.tasks;
