-- Restricted role: a team member who sees only the jobs they are assigned to.
--
-- Section 4 of the Team Management spec, last row:
--
--   Role        Billing  Manage users  All projects  Assigned only  Destructive
--   Restricted  no       no            NO            YES            no
--
-- REQUIRES 20260909000000_team_roles_matrix.sql TO HAVE RUN FIRST. This file
-- compares `role <> 'restricted'`, and Postgres rejects a comparison against an
-- enum label that does not exist yet with "invalid input value for enum". If
-- that migration has not been applied, this one fails on its first statement
-- and changes nothing.
--
-- ---------------------------------------------------------------------------
-- WHY THIS ONE HAS TO EDIT `are_teammates()`, WHEN SUBCONTRACTORS DID NOT
-- ---------------------------------------------------------------------------
-- 20260910000000 added subcontractor access without touching a single existing
-- policy, because a subcontractor is not a `team_members` row: `are_teammates()`
-- joins that table to itself, so it already answered false for them, and the
-- new policies only had to ADD.
--
-- A Restricted user is the opposite case. They ARE a team member, so
-- `are_teammates()` already answers TRUE for them against every project in the
-- workspace, and RLS unions permissive policies with OR. There is no policy that
-- can be added to take that away. Adding one would produce a role called
-- "Restricted" that restricts nothing - the single worst outcome available here,
-- because it fails silently and in the permissive direction.
--
-- So `are_teammates()` is narrowed by exactly one condition: the VIEWER must not
-- be Restricted. Everything else about it is preserved verbatim, including the
-- `plan IN ('starter','pro','team')` widening from 20260803040000 - which is why
-- this file restates the whole function rather than patching it.
--
-- Read the change as: "Restricted users are no longer teammates for the purpose
-- of blanket access." Their access comes back, project by project, through the
-- policies in PART 3.
--
-- ---------------------------------------------------------------------------
-- WHICH SIDE OF THE JOIN
-- ---------------------------------------------------------------------------
-- The call is always `are_teammates(auth.uid(), <row owner>)`, so `_a` is the
-- viewer and `ma` is the viewer's membership row. The new condition goes on
-- `ma`, never `mb`.
--
-- Getting that backwards would invert the feature: it would hide a Restricted
-- user's OWN projects from the rest of the crew, while leaving the Restricted
-- user able to see everything. The two are easy to confuse and only one of them
-- is visible in testing, because the wrong one still looks like "something got
-- restricted".
--
-- `_a = _b` is left untouched at the front, so a Restricted user always reaches
-- rows they created themselves. A person who cannot see their own photos has
-- not been restricted, they have been broken.
--
-- Idempotent throughout. Safe to re-run.
-- Apply in the SitePix Supabase SQL editor (or `supabase db push`).

SET lock_timeout = '5s';

-- ===========================================================================
-- PART 1 - which jobs a Restricted member is assigned to
-- ===========================================================================
-- Deliberately NOT reusing `subcontractor_projects`. The two look alike and
-- mean different things: this row points at a `team_members` person who holds a
-- paid seat, that one points at an outside firm who holds none. Merging them
-- would put the seat-counting distinction behind a nullable column, and the
-- seat exemption is the whole economic claim of the Team tier.

CREATE TABLE IF NOT EXISTS public.project_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_assignments_user_idx
  ON public.project_assignments(user_id);
CREATE INDEX IF NOT EXISTS project_assignments_project_idx
  ON public.project_assignments(project_id);

-- REVOKE BEFORE GRANT - Supabase's default privileges hand every new public
-- table to `anon`, the publishable key in the browser bundle.
REVOKE ALL ON public.project_assignments FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_assignments TO authenticated;
GRANT ALL ON public.project_assignments TO service_role;

ALTER TABLE public.project_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage project assignments" ON public.project_assignments;
CREATE POLICY "Admins manage project assignments" ON public.project_assignments
  FOR ALL TO authenticated
  USING (public.is_team_admin(auth.uid(), public.user_team_id(auth.uid())))
  WITH CHECK (public.is_team_admin(auth.uid(), public.user_team_id(auth.uid())));

-- A Restricted user may read their own assignments - the app needs it to render
-- "you are on 3 jobs". No write policy, so they cannot assign themselves.
DROP POLICY IF EXISTS "Members read their own assignments" ON public.project_assignments;
CREATE POLICY "Members read their own assignments" ON public.project_assignments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ===========================================================================
-- PART 2 - Restricted members stop being teammates for blanket access
-- ===========================================================================
-- Restated in full, preserving 20260803040000's plan list. The ONLY change is
-- `AND ma.role <> 'restricted'`.

CREATE OR REPLACE FUNCTION public.are_teammates(_a UUID, _b UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _a = _b OR EXISTS (
    SELECT 1
    FROM public.team_members ma
    JOIN public.team_members mb ON ma.team_id = mb.team_id
    JOIN public.teams t          ON t.id      = ma.team_id
    WHERE ma.user_id = _a
      AND mb.user_id = _b
      -- Every paid-or-free plan shares the project record. The seat count is
      -- what differs (Starter 2, Pro/Team 50), and that is enforced by
      -- teams.member_limit rather than here.
      AND t.plan IN ('starter', 'pro', 'team')
      -- The viewer must not be Restricted. `ma` is the viewer's row; putting
      -- this on `mb` instead would hide a Restricted user's own projects from
      -- the crew while leaving the Restricted user able to see everything.
      AND ma.role <> 'restricted'
  )
$$;

-- ===========================================================================
-- PART 3 - and get their access back, one job at a time
-- ===========================================================================
-- `member_can_reach_project` is the Restricted counterpart of
-- `subcontractor_can_reach_project`. It stays deliberately narrow: assignment
-- plus same-team. It does NOT re-check the plan, unlike the subcontractor one -
-- a team that downgrades from Team to Pro still has real employees holding this
-- role, and locking them out of their own jobs over a billing change would be
-- punishing the wrong person. `assignableRoles()` in team-permissions.ts stops
-- NEW Restricted members below Team; the existing ones keep working.

CREATE OR REPLACE FUNCTION public.member_can_reach_project(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.project_assignments pa
      JOIN public.projects p          ON p.id = pa.project_id
      JOIN public.team_members viewer ON viewer.user_id = pa.user_id
      JOIN public.team_members owner  ON owner.user_id  = p.created_by
     WHERE pa.user_id = _user_id
       AND pa.project_id = _project_id
       -- The assignment alone is not enough. Without this, an assignment row
       -- left behind after someone changes teams would still open the job.
       AND viewer.team_id = owner.team_id
  )
$$;

REVOKE ALL ON FUNCTION public.member_can_reach_project(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.member_can_reach_project(uuid, uuid) TO authenticated;

-- Additive, exactly like the subcontractor policies. These are what a Restricted
-- member's access now consists of.
DROP POLICY IF EXISTS "Restricted members view assigned projects" ON public.projects;
CREATE POLICY "Restricted members view assigned projects" ON public.projects
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), id));

DROP POLICY IF EXISTS "Restricted members update assigned projects" ON public.projects;
CREATE POLICY "Restricted members update assigned projects" ON public.projects
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), id));

DROP POLICY IF EXISTS "Restricted members view photos on assigned projects" ON public.photos;
CREATE POLICY "Restricted members view photos on assigned projects" ON public.photos
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members add photos to assigned projects" ON public.photos;
CREATE POLICY "Restricted members add photos to assigned projects" ON public.photos
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.member_can_reach_project(auth.uid(), project_id)
  );

DROP POLICY IF EXISTS "Restricted members edit photos on assigned projects" ON public.photos;
CREATE POLICY "Restricted members edit photos on assigned projects" ON public.photos
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

-- Unlike a subcontractor, a Restricted member is staff. They get the working
-- surfaces of a job they are on - videos, walkthroughs and checklists - because
-- the role is "which jobs", not "a lesser kind of crew".
DROP POLICY IF EXISTS "Restricted members work on assigned videos" ON public.videos;
CREATE POLICY "Restricted members work on assigned videos" ON public.videos
  FOR ALL TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members work on assigned walkthroughs" ON public.walkthroughs;
CREATE POLICY "Restricted members work on assigned walkthroughs" ON public.walkthroughs
  FOR ALL TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members work on assigned checklists" ON public.project_checklists;
CREATE POLICY "Restricted members work on assigned checklists" ON public.project_checklists
  FOR ALL TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members work on assigned checklist items"
  ON public.project_checklist_items;
CREATE POLICY "Restricted members work on assigned checklist items"
  ON public.project_checklist_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_checklists c
     WHERE c.id = project_checklist_items.checklist_id
       AND public.member_can_reach_project(auth.uid(), c.project_id)
  ));

-- ===========================================================================
-- WHAT IS DELIBERATELY ABSENT
-- ===========================================================================
-- No DELETE on projects. Section 4 gives Restricted no destructive actions, and
--   deleting a job you were assigned to is the most destructive one available.
-- No `teams`, `team_members` or `team_invites`. Restricted has no user
--   management, enforced by absence: RLS denies by default.

-- === VERIFY ================================================================
-- The enum prerequisite. If this errors, run 20260909000000 first:
--
-- SELECT 'restricted'::public.team_role;
--
-- The narrowed function must still say yes for ordinary members and no for a
-- Restricted one. Substitute two real users on the same team:
--
-- SELECT public.are_teammates('<standard-user>', '<other-user>');   -- expect true
-- SELECT public.are_teammates('<restricted-user>', '<other-user>'); -- expect false
-- SELECT public.are_teammates('<restricted-user>', '<restricted-user>'); -- expect true
--
-- And the assignment path must give it back for the assigned job only:
--
-- SELECT public.member_can_reach_project('<restricted-user>', '<assigned-project>');   -- true
-- SELECT public.member_can_reach_project('<restricted-user>', '<unassigned-project>'); -- false
--
-- Nobody holds the role yet, so nothing above can have changed behaviour for a
-- real user. Expect zero rows until the first Restricted member is created:
--
-- SELECT * FROM public.team_members WHERE role = 'restricted';
--
-- anon holds nothing on the new table:
--
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema = 'public' AND table_name = 'project_assignments'
--    AND grantee IN ('anon', 'PUBLIC');   -- expect zero rows
