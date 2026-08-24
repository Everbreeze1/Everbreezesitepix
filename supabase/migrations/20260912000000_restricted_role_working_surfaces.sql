-- Restricted role, part two: the working surfaces 20260911000000 did not reach.
--
-- REQUIRES 20260911000000_restricted_role_project_assignments.sql TO HAVE RUN
-- FIRST. Every policy below calls `member_can_reach_project`, which that file
-- defines against `project_assignments`, which that file creates.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FIXES
-- ---------------------------------------------------------------------------
-- 20260911000000 narrowed `are_teammates()` so a Restricted member stops
-- getting blanket access, then handed access back per assignment for six
-- tables: projects, photos, videos, walkthroughs, project_checklists and
-- project_checklist_items.
--
-- Thirteen other tables are reachable ONLY through `are_teammates()`. Narrowing
-- that function took them away too, and nothing gave them back. The role's own
-- stated intent is the measure:
--
--   "a Restricted member is staff. They get the working surfaces of a job they
--    are on - videos, walkthroughs and checklists - because the role is
--    'which jobs', not 'a lesser kind of crew'."
--
-- Against that sentence the omissions read as unfinished rather than decided.
-- The clearest proof is `walkthrough_photos`: 20260911000000 grants the
-- `walkthroughs` row and not the photos hanging off it, so a Restricted member
-- would open a walkthrough and find it empty. Nobody decides that.
--
-- No user held the role when this was written (`team_members.role` was owner
-- and member only), so none of it had broken for a real person yet. It would
-- have broken the first time someone was made Restricted, on the tabs they use
-- most.
--
-- ---------------------------------------------------------------------------
-- WHAT IS COVERED, AND WHY EACH ONE
-- ---------------------------------------------------------------------------
--   project_workflows / _phases / _items
--       The Workflows tab. Also where a blueprint-applied walkthrough shot list
--       lands (20260908000000), so without this a Restricted member's shot list
--       is invisible along with the rest of that tab.
--   project_pages, project_document_folders
--       The Documents tab.
--   tasks, task_photo_items
--       The work assigned to them, and the per-photo record of doing it.
--   walkthrough_photos
--       Without it the walkthroughs already granted are empty shells.
--   photo_comments
--       How a crew coordinates on a photo. Seeing the photo but not the note
--       attached to it is worse than seeing neither.
--   ai_analyses
--       Hangs off a photo they can already read. SELECT only, because the
--       existing insert and update policies are `created_by = auth.uid()` and
--       already cover analyses they run themselves.
--
-- ---------------------------------------------------------------------------
-- WHAT IS DELIBERATELY STILL ABSENT
-- ---------------------------------------------------------------------------
--   team_invites   - 20260911000000 excludes it on purpose. Restricted has no
--                    user management. Left alone.
--   photo_shares   - creating a public share link publishes a client's photos
--                    outside the company. Section 4 gives Restricted no
--                    destructive actions, and an outward-facing link that
--                    cannot be unsent is the nearest thing to one in this set.
--                    A Restricted member can still do the work; an admin does
--                    the publishing.
--   project_blueprint_applications
--                  - the blueprint origin ledger, and it needs nothing.
--                    getProjectBlueprintOriginService authorises on
--                    `projects` through the caller's own RLS, then reads the
--                    ledger with the SERVICE ROLE, which bypasses RLS
--                    entirely. A Restricted member assigned to the job passes
--                    that first check via 20260911000000's projects policy, so
--                    the origin pill works for them as it stands. The only
--                    direct browser read of this table is the Templates
--                    library screen, which is not a Restricted surface.
--
-- ---------------------------------------------------------------------------
-- NO DELETE, ANYWHERE IN THIS FILE
-- ---------------------------------------------------------------------------
-- Section 4 gives Restricted no destructive actions, so every policy below is
-- SELECT, INSERT or UPDATE and never FOR ALL.
--
-- NOTE FOR WHOEVER READS THIS NEXT: 20260911000000 does use `FOR ALL` on
-- videos, walkthroughs and project_checklists, which grants DELETE on those
-- three and sits awkwardly beside its own "no destructive actions" comment.
-- That is not changed here. Tightening a policy that is already live is a
-- different decision from finishing an unfinished one, and it should be taken
-- deliberately rather than as a side effect of this file.
--
-- Idempotent throughout: DROP POLICY IF EXISTS before every CREATE. Safe to
-- re-run. Creates no tables, so there is no new grant to revoke from anon.
-- Apply in the Everlumen Supabase SQL editor (or `supabase db push`).

SET lock_timeout = '5s';

-- ===========================================================================
-- PART 1 - the Workflows tab, and blueprint-applied walkthrough shot lists
-- ===========================================================================
-- Mirrors the teammate policies from 20260819000000, which are view + update.

DROP POLICY IF EXISTS "Restricted members view assigned workflows" ON public.project_workflows;
CREATE POLICY "Restricted members view assigned workflows" ON public.project_workflows
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members update assigned workflows" ON public.project_workflows;
CREATE POLICY "Restricted members update assigned workflows" ON public.project_workflows
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members view assigned workflow phases"
  ON public.project_workflow_phases;
CREATE POLICY "Restricted members view assigned workflow phases"
  ON public.project_workflow_phases
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_workflows w
     WHERE w.id = project_workflow_phases.workflow_id
       AND public.member_can_reach_project(auth.uid(), w.project_id)
  ));

-- Phase notes and sign-off are written here.
DROP POLICY IF EXISTS "Restricted members update assigned workflow phases"
  ON public.project_workflow_phases;
CREATE POLICY "Restricted members update assigned workflow phases"
  ON public.project_workflow_phases
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_workflows w
     WHERE w.id = project_workflow_phases.workflow_id
       AND public.member_can_reach_project(auth.uid(), w.project_id)
  ));

-- The step rows. Ticking off a shot writes here.
DROP POLICY IF EXISTS "Restricted members view assigned workflow items"
  ON public.project_workflow_items;
CREATE POLICY "Restricted members view assigned workflow items"
  ON public.project_workflow_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_workflow_phases ph
      JOIN public.project_workflows w ON w.id = ph.workflow_id
     WHERE ph.id = project_workflow_items.phase_id
       AND public.member_can_reach_project(auth.uid(), w.project_id)
  ));

DROP POLICY IF EXISTS "Restricted members update assigned workflow items"
  ON public.project_workflow_items;
CREATE POLICY "Restricted members update assigned workflow items"
  ON public.project_workflow_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_workflow_phases ph
      JOIN public.project_workflows w ON w.id = ph.workflow_id
     WHERE ph.id = project_workflow_items.phase_id
       AND public.member_can_reach_project(auth.uid(), w.project_id)
  ));

-- ===========================================================================
-- PART 2 - the Documents tab
-- ===========================================================================

DROP POLICY IF EXISTS "Restricted members view assigned document folders"
  ON public.project_document_folders;
CREATE POLICY "Restricted members view assigned document folders"
  ON public.project_document_folders
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members view assigned pages" ON public.project_pages;
CREATE POLICY "Restricted members view assigned pages" ON public.project_pages
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

-- Filling a form in on site is the job. `created_by = auth.uid()` stops a
-- Restricted member filing a document under someone else's name.
DROP POLICY IF EXISTS "Restricted members add pages to assigned projects" ON public.project_pages;
CREATE POLICY "Restricted members add pages to assigned projects" ON public.project_pages
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.member_can_reach_project(auth.uid(), project_id)
  );

DROP POLICY IF EXISTS "Restricted members edit pages on assigned projects" ON public.project_pages;
CREATE POLICY "Restricted members edit pages on assigned projects" ON public.project_pages
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

-- ===========================================================================
-- PART 3 - tasks, and the per-photo record of completing them
-- ===========================================================================
-- Mirrors 20260819000000's teammate policies (view + update), plus the insert
-- 20260906000000 needs so a crew member can close their half of a task.

DROP POLICY IF EXISTS "Restricted members view assigned tasks" ON public.tasks;
CREATE POLICY "Restricted members view assigned tasks" ON public.tasks
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members update assigned tasks" ON public.tasks;
CREATE POLICY "Restricted members update assigned tasks" ON public.tasks
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members view assigned task photo items"
  ON public.task_photo_items;
CREATE POLICY "Restricted members view assigned task photo items"
  ON public.task_photo_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
     WHERE t.id = task_photo_items.task_id
       AND public.member_can_reach_project(auth.uid(), t.project_id)
  ));

DROP POLICY IF EXISTS "Restricted members record assigned task photo items"
  ON public.task_photo_items;
CREATE POLICY "Restricted members record assigned task photo items"
  ON public.task_photo_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tasks t
     WHERE t.id = task_photo_items.task_id
       AND public.member_can_reach_project(auth.uid(), t.project_id)
  ));

DROP POLICY IF EXISTS "Restricted members amend assigned task photo items"
  ON public.task_photo_items;
CREATE POLICY "Restricted members amend assigned task photo items"
  ON public.task_photo_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
     WHERE t.id = task_photo_items.task_id
       AND public.member_can_reach_project(auth.uid(), t.project_id)
  ));

-- ===========================================================================
-- PART 4 - walkthrough photos
-- ===========================================================================
-- `walkthroughs` is already granted by 20260911000000. Without these, that
-- grant hands over an empty shell. `walkthrough_photos` has no CREATE TABLE in
-- this folder - it predates the migrations directory - so the join is written
-- against the column list of record in packages/db/src/database.ts.

DROP POLICY IF EXISTS "Restricted members view assigned walkthrough photos"
  ON public.walkthrough_photos;
CREATE POLICY "Restricted members view assigned walkthrough photos"
  ON public.walkthrough_photos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.walkthroughs w
     WHERE w.id = walkthrough_photos.walkthrough_id
       AND public.member_can_reach_project(auth.uid(), w.project_id)
  ));

DROP POLICY IF EXISTS "Restricted members link assigned walkthrough photos"
  ON public.walkthrough_photos;
CREATE POLICY "Restricted members link assigned walkthrough photos"
  ON public.walkthrough_photos
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.walkthroughs w
     WHERE w.id = walkthrough_photos.walkthrough_id
       AND public.member_can_reach_project(auth.uid(), w.project_id)
  ));

DROP POLICY IF EXISTS "Restricted members amend assigned walkthrough photos"
  ON public.walkthrough_photos;
CREATE POLICY "Restricted members amend assigned walkthrough photos"
  ON public.walkthrough_photos
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.walkthroughs w
     WHERE w.id = walkthrough_photos.walkthrough_id
       AND public.member_can_reach_project(auth.uid(), w.project_id)
  ));

-- ===========================================================================
-- PART 5 - comments and AI output on photos they can already see
-- ===========================================================================

DROP POLICY IF EXISTS "Restricted members read assigned photo comments" ON public.photo_comments;
CREATE POLICY "Restricted members read assigned photo comments" ON public.photo_comments
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

-- `author_id = auth.uid()` so a Restricted member cannot post as someone else.
DROP POLICY IF EXISTS "Restricted members write assigned photo comments" ON public.photo_comments;
CREATE POLICY "Restricted members write assigned photo comments" ON public.photo_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.member_can_reach_project(auth.uid(), project_id)
  );

-- SELECT only. The existing insert and update policies on this table are
-- `created_by = auth.uid()`, which already covers analyses they run themselves.
DROP POLICY IF EXISTS "Restricted members read assigned ai analyses" ON public.ai_analyses;
CREATE POLICY "Restricted members read assigned ai analyses" ON public.ai_analyses
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.photos ph
     WHERE ph.id = ai_analyses.photo_id
       AND public.member_can_reach_project(auth.uid(), ph.project_id)
  ));

-- === VERIFY ================================================================
-- The prerequisite. If this errors, run 20260911000000 first:
--
-- SELECT public.member_can_reach_project(
--   '00000000-0000-0000-0000-000000000000',
--   '00000000-0000-0000-0000-000000000000');   -- expect false, not an error
--
-- Every Restricted policy, by table. The name prefix is shared with
-- 20260911000000, so this spans BOTH files: 9 policies there plus 21 here,
-- across 16 tables. Scope it to this file's ten tables by adding the tablename
-- filter from the DELETE check below.
--
-- SELECT tablename, count(*) AS policies
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND policyname LIKE 'Restricted members %'
--  GROUP BY 1 ORDER BY 1;   -- expect 30 rows total across 16 tables
--
-- Nothing in THIS file grants DELETE. Scoped to this file's tables on
-- purpose: 20260911000000 uses FOR ALL on videos, walkthroughs and
-- project_checklists, so an unscoped query returns those three and makes this
-- check look like a failure it is not. Expect zero rows:
--
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND policyname LIKE 'Restricted members %'
--    AND cmd IN ('DELETE', 'ALL')
--    AND tablename IN ('project_workflows', 'project_workflow_phases',
--                      'project_workflow_items', 'project_pages',
--                      'project_document_folders', 'tasks', 'task_photo_items',
--                      'walkthrough_photos', 'photo_comments', 'ai_analyses');
--
-- The two intentional exclusions must stay absent. Expect zero rows:
--
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('team_invites', 'photo_shares')
--    AND policyname LIKE 'Restricted members %';
--
-- End to end, once a Restricted member exists and is assigned to one job.
-- Expect rows from the assigned job only, and nothing from any other:
--
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims TO '{"sub":"<restricted-user>"}';
-- SELECT count(*) FROM public.project_workflows;
-- SELECT count(*) FROM public.project_pages;
-- RESET ROLE;
