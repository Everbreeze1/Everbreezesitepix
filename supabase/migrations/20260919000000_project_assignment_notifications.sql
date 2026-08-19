-- ASSIGNING SOMEBODY TO A JOB IS NOW A THING THAT HAPPENS, SO IT NEEDS A ROW.
--
-- `project_assignments` has existed since 20260911000000, but only one screen
-- wrote to it - the Restricted member's "choose their jobs" picker in Team
-- Settings - and nothing told the person on the other end. The projects list
-- and the project page can staff a job now, which is where anyone would
-- actually do it, so the person being staffed gets told the same way they are
-- told about a task.
--
-- Two CHECK constraints stand in the way and both are widened here:
--   notifications.type        - needs 'project_assigned'
--   notifications.entity_type - needs 'project'
--
-- Nothing else changes. `project_assignments` itself, its RLS and
-- `member_can_reach_project()` are all unchanged: what an assignment MEANS is
-- still decided by the role at the other end of it (a fence for Restricted, a
-- crew list for everyone else), and that is deliberately not encoded here.
--
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent: safe to re-run.

SET lock_timeout = '5s';

-- ===========================================================================
-- 1. THE TYPE LIST
-- ===========================================================================
-- Restated in full, as every previous widening of this constraint has been.
-- The list is short and a DROP/ADD pair that names every value is far easier to
-- audit than an accumulated series of partial edits.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'task_assigned', 'checklist_assigned', 'photo_comment_mention', 'team_invite_accepted',
  'admin_announcement',
  'workflow_assigned',
  'task_completed', 'checklist_completed', 'workflow_completed',
  'task_comment', 'task_watching', 'task_updated',
  -- new in this migration
  'project_assigned'
));

-- ===========================================================================
-- 2. THE ENTITY LIST
-- ===========================================================================
-- Same discovery-by-what-it-constrains as 20260819000000 and 20260915000000:
-- the entity_type check was declared inline on the column in 20260728120000, so
-- Postgres named it. Guessing that name wrong fails in the worst way - the DROP
-- does nothing, the ADD succeeds under a fresh name, and the old constraint
-- stays behind rejecting every new row.

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
    entity_type IN (
      'task', 'checklist', 'photo_comment', 'team_invite', 'workflow', 'task_comment',
      -- new in this migration
      'project'
    )
  );
END $$;

-- ===========================================================================
-- 3. VERIFY
-- ===========================================================================
-- Both should come back with the new value present:
--
--   SELECT pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.notifications'::regclass
--      AND conname IN ('notifications_type_check', 'notifications_entity_type_check');
