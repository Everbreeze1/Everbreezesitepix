-- Restricted role: take back the DELETE that FOR ALL handed out.
--
-- REQUIRES 20260911000000 and 20260912000000 TO HAVE RUN FIRST. This file only
-- replaces policies those created; where they have not run, every DROP is a
-- no-op and the CREATEs fail on the missing member_can_reach_project().
--
-- ---------------------------------------------------------------------------
-- THE DEFECT
-- ---------------------------------------------------------------------------
-- 20260911000000 states, in its own closing comment, that Restricted gets no
-- destructive actions: section 4 gives Restricted none, and deleting a job you
-- were assigned to is the most destructive one available.
--
-- Four of its policies are then written FOR ALL:
--
--   Restricted members work on assigned videos          -> videos
--   Restricted members work on assigned walkthroughs    -> walkthroughs
--   Restricted members work on assigned checklists      -> project_checklists
--   Restricted members work on assigned checklist items -> project_checklist_items
--
-- FOR ALL is SELECT, INSERT, UPDATE **and DELETE**. So that file granted the
-- exact thing its own comment says it withholds, on four tables.
-- 20260912000000 spotted it, deliberately did not fix it in passing, and left
-- the note that tightening a live policy is its own decision rather than a side
-- effect of finishing an unfinished one. This is that decision, taken alone.
--
-- Nobody has been harmed by it: team_members.role has held no restricted row at
-- any point since the enum gained the value, so the over-grant was never
-- exercised. It would have bitten the first time somebody was made Restricted,
-- and silently, because deleting a walkthrough looks like it worked.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES, EXACTLY
-- ---------------------------------------------------------------------------
-- Each FOR ALL becomes SELECT + INSERT + UPDATE with the identical predicate.
-- Nothing a Restricted member can do today stops working; only DELETE goes.
--
-- On the INSERT halves the predicate moves from USING to WITH CHECK. That is
-- not a change in meaning: Postgres already evaluates a FOR ALL policy USING
-- expression as the WITH CHECK for inserts when no WITH CHECK is given, so the
-- row that passed before passes now.
--
-- Deliberately NOT tightened here: none of these gain a created_by = auth.uid()
-- insert check, even though the newer Restricted policies in 20260912000000
-- have one. Adding an ownership condition to a live policy is a second,
-- separate change, and the column names differ per table - exactly the kind of
-- edit that looks obvious and breaks inserts. This file removes a permission
-- and adds none.
--
-- Idempotent: DROP POLICY IF EXISTS before every CREATE. Safe to re-run.
-- Creates no tables, so there is no new grant to revoke from anon.
-- Apply in the SitePix Supabase SQL editor (or supabase db push).

SET lock_timeout = '5s';

-- ===========================================================================
-- videos
-- ===========================================================================
DROP POLICY IF EXISTS "Restricted members work on assigned videos" ON public.videos;

DROP POLICY IF EXISTS "Restricted members view assigned videos" ON public.videos;
CREATE POLICY "Restricted members view assigned videos" ON public.videos
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members add assigned videos" ON public.videos;
CREATE POLICY "Restricted members add assigned videos" ON public.videos
  FOR INSERT TO authenticated
  WITH CHECK (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members amend assigned videos" ON public.videos;
CREATE POLICY "Restricted members amend assigned videos" ON public.videos
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

-- ===========================================================================
-- walkthroughs
-- ===========================================================================
DROP POLICY IF EXISTS "Restricted members work on assigned walkthroughs" ON public.walkthroughs;

DROP POLICY IF EXISTS "Restricted members view assigned walkthroughs" ON public.walkthroughs;
CREATE POLICY "Restricted members view assigned walkthroughs" ON public.walkthroughs
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members add assigned walkthroughs" ON public.walkthroughs;
CREATE POLICY "Restricted members add assigned walkthroughs" ON public.walkthroughs
  FOR INSERT TO authenticated
  WITH CHECK (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members amend assigned walkthroughs" ON public.walkthroughs;
CREATE POLICY "Restricted members amend assigned walkthroughs" ON public.walkthroughs
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

-- ===========================================================================
-- project_checklists
-- ===========================================================================
DROP POLICY IF EXISTS "Restricted members work on assigned checklists" ON public.project_checklists;

DROP POLICY IF EXISTS "Restricted members view assigned checklists" ON public.project_checklists;
CREATE POLICY "Restricted members view assigned checklists" ON public.project_checklists
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members add assigned checklists" ON public.project_checklists;
CREATE POLICY "Restricted members add assigned checklists" ON public.project_checklists
  FOR INSERT TO authenticated
  WITH CHECK (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members amend assigned checklists" ON public.project_checklists;
CREATE POLICY "Restricted members amend assigned checklists" ON public.project_checklists
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

-- ===========================================================================
-- project_checklist_items
-- ===========================================================================
-- Ticking a checklist item is the most common thing a crew does all day, so the
-- UPDATE half matters more here than anywhere else in this file.
DROP POLICY IF EXISTS "Restricted members work on assigned checklist items"
  ON public.project_checklist_items;

DROP POLICY IF EXISTS "Restricted members view assigned checklist items"
  ON public.project_checklist_items;
CREATE POLICY "Restricted members view assigned checklist items"
  ON public.project_checklist_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_checklists c
     WHERE c.id = project_checklist_items.checklist_id
       AND public.member_can_reach_project(auth.uid(), c.project_id)
  ));

DROP POLICY IF EXISTS "Restricted members add assigned checklist items"
  ON public.project_checklist_items;
CREATE POLICY "Restricted members add assigned checklist items"
  ON public.project_checklist_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.project_checklists c
     WHERE c.id = project_checklist_items.checklist_id
       AND public.member_can_reach_project(auth.uid(), c.project_id)
  ));

DROP POLICY IF EXISTS "Restricted members amend assigned checklist items"
  ON public.project_checklist_items;
CREATE POLICY "Restricted members amend assigned checklist items"
  ON public.project_checklist_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_checklists c
     WHERE c.id = project_checklist_items.checklist_id
       AND public.member_can_reach_project(auth.uid(), c.project_id)
  ));

-- === VERIFY ================================================================
-- No Restricted policy anywhere grants DELETE or ALL. Unscoped this time,
-- because after this file there is nothing left to exclude. Expect zero rows:
--
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND policyname LIKE 'Restricted members %'
--    AND cmd IN ('DELETE', 'ALL');
--
-- The four tables kept everything else - SELECT, INSERT and UPDATE on each:
--
-- SELECT tablename, cmd, count(*)
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND policyname LIKE 'Restricted members %'
--    AND tablename IN ('videos', 'walkthroughs',
--                      'project_checklists', 'project_checklist_items')
--  GROUP BY 1, 2 ORDER BY 1, 2;
--
-- And the old FOR ALL names are gone. Expect zero rows:
--
-- SELECT policyname FROM pg_policies
--  WHERE schemaname = 'public' AND policyname LIKE 'Restricted members work on%';
