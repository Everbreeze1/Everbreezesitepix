-- Subcontractor access: a scoped, no-seat login for outside labour.
--
-- The client's Team Management spec, section 5, and the reason he gives for it:
-- "Pro users pay a full seat for even a one-day sub. Team lets subs in for free,
-- scoped to the job - this is the concrete reason to upgrade, not just 'more
-- roles.'" So this is not a permissions refinement, it is the thing the Team
-- tier is sold on, and the pricing card now names it.
--
-- What a subcontractor is, precisely:
--   - invited by email, becomes a real (lightweight) account
--   - reaches ONLY the projects they are assigned to
--   - may view and upload photos on those projects
--   - sees no billing, no other project, no company user list
--   - does NOT consume a paid seat
--
-- ---------------------------------------------------------------------------
-- WHY SUBCONTRACTORS ARE NOT `team_members` ROWS
-- ---------------------------------------------------------------------------
-- This is the whole design, and it is forced by one line of application code:
-- `effectiveMemberLimit` in apps/api/src/domains/teams/service.ts counts
-- `team_members` against the plan's seat cap. File a subcontractor there and
-- every single one consumes a paid seat - the exact cost the feature exists to
-- remove. So they live in their own table, and the seat count never sees them.
--
-- The same fact is what keeps them out of everything else for free.
-- `are_teammates()` - the spine of every shared-resource policy in
-- 20260612191404 - answers by joining `team_members` to `team_members`. A
-- subcontractor is in neither side of that join, so it returns false for them
-- everywhere, and they inherit no teammate access by default. Their reach is
-- exactly the policies added below and nothing else.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS ADDITIVE AND TOUCHES NO EXISTING POLICY
-- ---------------------------------------------------------------------------
-- Postgres unions permissive policies with OR. A new SELECT policy on `photos`
-- can therefore grant subcontractors their slice without editing - or even
-- reading - the teammate policy beside it. Nothing an existing user can do
-- today changes. That matters more than usual here: the alternative was
-- widening `are_teammates()` to take a project, and that function guards
-- projects, photos, videos, walkthroughs, checklists and checklist items at
-- once. A mistake in it is a cross-tenant data leak in six places.
--
-- ---------------------------------------------------------------------------
-- ACCESS DIES WITH THE SUBSCRIPTION
-- ---------------------------------------------------------------------------
-- `subcontractor_can_reach_project()` re-checks `teams.plan = 'team'` on every
-- call. A team that downgrades to Pro stops admitting its subcontractors that
-- instant, without anyone running a cleanup job. This mirrors what
-- 20260612193150 already does to `are_teammates()`, which gates on
-- plan IN ('pro','team') - so the precedent, and the shape, are the repo's own.
--
-- Idempotent throughout. Safe to re-run.
-- Apply in the Everlumen Supabase SQL editor (or `supabase db push`).

SET lock_timeout = '5s';

-- ===========================================================================
-- PART 1 - the person
-- ===========================================================================
-- One row per invited subcontractor per team. `user_id` stays null until they
-- accept, which is what makes an unaccepted invite harmless: the policies below
-- all key on `user_id`, so a pending row grants nothing to anyone.
--
-- `company_name` is here because a sub is usually a firm rather than a person -
-- "Ace Plumbing" is what the crew needs to see next to an uploaded photo, and
-- guessing it from an email address does not work.

CREATE TABLE IF NOT EXISTS public.subcontractors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  -- Stored lower-cased by the API, matching how `team_invites.email` is
  -- normalised (see the comment in inviteMemberService) so that the partial
  -- unique index below can be a plain column index rather than an expression
  -- one that a case-sensitive `.eq()` would silently fail to use.
  email        text NOT NULL,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text,
  invited_by   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at  timestamptz,
  -- Revoking is a soft delete on purpose. A hard DELETE would cascade away
  -- `subcontractor_projects`, and with it the record of which jobs an outside
  -- firm could see - which is the first thing anyone asks after an incident.
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One live grant per address per team. Partial, so a revoked row never blocks
-- re-inviting the same firm to a later job.
CREATE UNIQUE INDEX IF NOT EXISTS subcontractors_one_live_per_email
  ON public.subcontractors(team_id, email)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS subcontractors_user_idx
  ON public.subcontractors(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS subcontractors_team_idx ON public.subcontractors(team_id);

-- REVOKE BEFORE GRANT. Supabase's default privileges hand every new public
-- table to `anon`, which is the publishable key sitting in the browser bundle -
-- and this table holds invite tokens. That is precisely how `team_invites`
-- leaked before 20260811000000.
REVOKE ALL ON public.subcontractors FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontractors TO authenticated;
GRANT ALL ON public.subcontractors TO service_role;

ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- PART 2 - the jobs they can reach
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.subcontractor_projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid NOT NULL REFERENCES public.subcontractors(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subcontractor_id, project_id)
);

CREATE INDEX IF NOT EXISTS subcontractor_projects_project_idx
  ON public.subcontractor_projects(project_id);

REVOKE ALL ON public.subcontractor_projects FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontractor_projects TO authenticated;
GRANT ALL ON public.subcontractor_projects TO service_role;

ALTER TABLE public.subcontractor_projects ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- PART 3 - the single question every policy below asks
-- ===========================================================================
-- SECURITY DEFINER so it can read `subcontractors` while evaluating a policy on
-- `photos`; without it the lookup would itself be filtered by the caller's RLS
-- and answer false for everyone.
--
-- Every condition here is load-bearing:
--   accepted_at NOT NULL - a pending invite is not access
--   revoked_at IS NULL   - revoking takes effect on the next query, not on a job
--   plan = 'team'        - the feature is what Team sells; a downgrade ends it
--   subscription active  - matches ACTIVE_SUBSCRIPTION_STATUSES in team-plan.ts,
--                          including `past_due`, because Stripe is still
--                          retrying and a failed card must not lock a crew's
--                          subcontractors out mid-job

CREATE OR REPLACE FUNCTION public.subcontractor_can_reach_project(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.subcontractors s
      JOIN public.subcontractor_projects sp ON sp.subcontractor_id = s.id
      JOIN public.teams t ON t.id = s.team_id
     WHERE s.user_id = _user_id
       AND s.accepted_at IS NOT NULL
       AND s.revoked_at IS NULL
       AND sp.project_id = _project_id
       AND (t.is_internal OR (t.plan = 'team'
            AND t.subscription_status IN ('active', 'trialing', 'past_due')))
  )
$$;

REVOKE ALL ON FUNCTION public.subcontractor_can_reach_project(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.subcontractor_can_reach_project(uuid, uuid) TO authenticated;

/*
 * "Am I a subcontractor at all?" - used by the two policies on the tables above
 * so a sub can read their own row without being able to read anyone else's.
 * Separate from the function above because it takes no project.
 */
CREATE OR REPLACE FUNCTION public.is_subcontractor(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subcontractors
     WHERE user_id = _user_id AND accepted_at IS NOT NULL AND revoked_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION public.is_subcontractor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_subcontractor(uuid) TO authenticated;

-- ===========================================================================
-- PART 4 - RLS on the two new tables
-- ===========================================================================
-- Managing subcontractors is an owner/admin action, reusing `is_team_admin()`
-- rather than inventing a second definition of "admin". A Manager cannot invite
-- one: section 4 gives Managers their own crew, and an outside firm with
-- standing access to a job is a company-level decision.

DROP POLICY IF EXISTS "Admins manage subcontractors" ON public.subcontractors;
CREATE POLICY "Admins manage subcontractors" ON public.subcontractors
  FOR ALL TO authenticated
  USING (public.is_team_admin(auth.uid(), team_id))
  WITH CHECK (public.is_team_admin(auth.uid(), team_id));

-- A subcontractor may read the row that is about them, and nothing else. No
-- INSERT, UPDATE or DELETE policy exists for them, so they cannot extend their
-- own expiry, un-revoke themselves, or reassign themselves to another job.
DROP POLICY IF EXISTS "Subcontractors read their own grant" ON public.subcontractors;
CREATE POLICY "Subcontractors read their own grant" ON public.subcontractors
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage subcontractor projects" ON public.subcontractor_projects;
CREATE POLICY "Admins manage subcontractor projects" ON public.subcontractor_projects
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.subcontractors s
     WHERE s.id = subcontractor_projects.subcontractor_id
       AND public.is_team_admin(auth.uid(), s.team_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.subcontractors s
     WHERE s.id = subcontractor_projects.subcontractor_id
       AND public.is_team_admin(auth.uid(), s.team_id)
  ));

DROP POLICY IF EXISTS "Subcontractors read their own assignments" ON public.subcontractor_projects;
CREATE POLICY "Subcontractors read their own assignments" ON public.subcontractor_projects
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.subcontractors s
     WHERE s.id = subcontractor_projects.subcontractor_id AND s.user_id = auth.uid()
  ));

-- ===========================================================================
-- PART 5 - the access itself
-- ===========================================================================
-- Read section 5 of the spec as a list of verbs, and this is the whole list:
-- view the project, view its photos, upload photos to it. Everything absent
-- from this part is absent on purpose.

-- The project row itself - without this the app cannot render a name or address
-- for the job they were invited to. SELECT only: a sub cannot rename, archive
-- or delete the job.
DROP POLICY IF EXISTS "Subcontractors view assigned projects" ON public.projects;
CREATE POLICY "Subcontractors view assigned projects" ON public.projects
  FOR SELECT TO authenticated
  USING (public.subcontractor_can_reach_project(auth.uid(), id));

DROP POLICY IF EXISTS "Subcontractors view photos on assigned projects" ON public.photos;
CREATE POLICY "Subcontractors view photos on assigned projects" ON public.photos
  FOR SELECT TO authenticated
  USING (public.subcontractor_can_reach_project(auth.uid(), project_id));

-- `uploaded_by = auth.uid()` is not decoration. Without it a subcontractor
-- could insert a photo attributed to a member of staff, and attribution is the
-- reason this is a login at all rather than an anonymous upload link.
DROP POLICY IF EXISTS "Subcontractors upload to assigned projects" ON public.photos;
CREATE POLICY "Subcontractors upload to assigned projects" ON public.photos
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.subcontractor_can_reach_project(auth.uid(), project_id)
  );

-- Editing is limited to their own uploads - captioning the photo they just
-- took. They cannot retouch or re-caption the crew's.
DROP POLICY IF EXISTS "Subcontractors edit their own photos" ON public.photos;
CREATE POLICY "Subcontractors edit their own photos" ON public.photos
  FOR UPDATE TO authenticated
  USING (
    uploaded_by = auth.uid()
    AND public.subcontractor_can_reach_project(auth.uid(), project_id)
  );

-- ===========================================================================
-- WHAT IS DELIBERATELY ABSENT
-- ===========================================================================
-- No DELETE on photos. A sub removing site evidence is the failure this whole
--   product exists to prevent, and "I uploaded it by mistake" is a request to
--   the crew, not a permission.
-- No videos, walkthroughs, checklists, reports, documents or site logs. The
--   spec says photos. Each of those is a separate deliberate grant if it is
--   ever wanted, and adding one is two lines here.
-- No `teams`, `team_members` or `team_invites`. "No visibility into the company
--   user list" is enforced by there being no policy, which is the strongest
--   form: RLS denies by default.
-- No `projects` INSERT/UPDATE/DELETE. They work on a job; they do not run one.

-- === VERIFY ================================================================
-- Both tables exist, RLS on, and anon holds nothing:
--
-- SELECT tablename, rowsecurity FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN ('subcontractors', 'subcontractor_projects');
--
-- SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--  WHERE table_schema = 'public'
--    AND table_name IN ('subcontractors', 'subcontractor_projects')
--    AND grantee IN ('anon', 'PUBLIC');   -- expect ZERO rows
--
-- The policies, by table. Expect 2 on each new table, and the four
-- "Subcontractors ..." ones alongside the existing teammate policies:
--
-- SELECT tablename, policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public'
--    AND (tablename IN ('subcontractors', 'subcontractor_projects')
--         OR policyname ILIKE 'Subcontractors%')
--  ORDER BY tablename, policyname;
--
-- Seats are untouched. A subcontractor must never move these numbers - compare
-- before and after inviting one:
--
-- SELECT t.id, t.name, t.member_limit,
--        (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) AS seats_used,
--        (SELECT count(*) FROM public.subcontractors s
--          WHERE s.team_id = t.id AND s.revoked_at IS NULL) AS subs
--   FROM public.teams t ORDER BY t.created_at;
--
-- The reach check itself. Substitute a real accepted subcontractor and one of
-- their projects; then try a project they are NOT assigned to and expect false:
--
-- SELECT public.subcontractor_can_reach_project('<user-uuid>', '<project-uuid>');
--
-- Downgrade behaviour. Flip a team to 'pro' and the same call must return false
-- for every one of its subcontractors:
--
-- SELECT s.email, public.subcontractor_can_reach_project(s.user_id, sp.project_id)
--   FROM public.subcontractors s
--   JOIN public.subcontractor_projects sp ON sp.subcontractor_id = s.id
--   JOIN public.teams t ON t.id = s.team_id
--  WHERE t.plan <> 'team';   -- expect every row false
