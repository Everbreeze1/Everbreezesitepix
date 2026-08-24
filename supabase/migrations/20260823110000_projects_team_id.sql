-- Give projects a real team, instead of inferring one.
--
-- WHY
--
-- `projects` has never had a team. Ownership was inferred as "created by
-- someone who is currently a member of this team", which is wrong in three
-- ways that all show up in production today:
--
--   * A member who leaves takes their projects out of the team's numbers, even
--     though the work is still there and the team can still see it.
--   * A user in two teams has their projects counted for both, or - before
--     20260822120000 - silently dropped from one.
--   * 3 of 54 live projects were created by someone in no team at all, so they
--     belong to nobody and the Teams page and the Overview page disagree by
--     exactly that much.
--
-- The inference also cannot be fixed in application code, because the fact it
-- is guessing at was never recorded.
--
-- WHY A TRIGGER RATHER THAN AN APPLICATION CHANGE
--
-- There is exactly one INSERT site today (NewProjectPage), but it runs in the
-- browser under the user's own session. Setting the column there means trusting
-- the client with it, and the paywall hole in LAUNCH.md 1.0a is what trusting
-- the browser with a column on a billing-adjacent table already cost. The
-- trigger derives it server-side, applies to every present and future insert
-- path without coordination, and refuses to let a signed-in caller reassign a
-- project to another team.
--
-- SCOPE
--
-- This column is for ATTRIBUTION. It is deliberately NOT wired into RLS or into
-- what anyone can see: project visibility rules are load-bearing and changing
-- them in the same migration that introduces the column would make a reporting
-- fix indistinguishable from an access change. That is a separate step.
--
-- Apply via the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent. Safe to re-run.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_team_id_idx ON public.projects (team_id);

-- ---------------------------------------------------------------------------
-- 1. The rule, in one place.
--
-- Owned team first, then earliest joined - identical to the LATERAL in
-- admin_user_directory, so the directory and the rollups cannot disagree about
-- which team someone's "primary" one is. NULL for a creator in no team, which
-- is a real answer and not a failure.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.primary_team_for_user(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.team_id
  FROM public.team_members tm
  JOIN public.teams t ON t.id = tm.team_id
  WHERE tm.user_id = p_user_id
  ORDER BY (t.owner_id = p_user_id) DESC, tm.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.primary_team_for_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.primary_team_for_user(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Backfill. Only rows that have not been set, so re-running is a no-op.
-- ---------------------------------------------------------------------------

UPDATE public.projects p
   SET team_id = public.primary_team_for_user(p.created_by)
 WHERE p.team_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Keep it true going forward.
--
-- INSERT: derive it, ignoring whatever the client sent. A browser must not get
-- to choose which team a project counts for.
--
-- UPDATE: a signed-in caller cannot move a project between teams. The service
-- role can, because support legitimately needs to repair a bad attribution and
-- every admin write is already logged.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.projects_set_team_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.team_id := public.primary_team_for_user(NEW.created_by);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
    -- auth.role() is 'authenticated' for a signed-in browser caller and
    -- 'service_role' for the API. Anything that is not the service role keeps
    -- the old value rather than being rejected, so a routine project edit that
    -- happens to round-trip the column still succeeds.
    IF coalesce(auth.role(), '') <> 'service_role' THEN
      NEW.team_id := OLD.team_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS projects_set_team_id_trg ON public.projects;
CREATE TRIGGER projects_set_team_id_trg
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_set_team_id();

-- ---------------------------------------------------------------------------
-- 4. Teach the rollups to use it.
--
-- Prefers `p.team_id`; falls back to the old membership inference for any row
-- where it is still NULL, so a project created by someone in no team keeps
-- behaving exactly as it did rather than vanishing from a team it was already
-- being counted for.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_team_rollups(team_ids uuid[])
RETURNS TABLE (
  team_id       uuid,
  member_count  integer,
  project_count integer,
  photo_count   integer,
  storage_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH members AS (
    SELECT tm.team_id, tm.user_id
    FROM public.team_members tm
    WHERE tm.team_id = ANY(team_ids)
  ),
  team_projects AS (
    -- Projects that now carry the team directly.
    SELECT p.team_id, p.id AS project_id
    FROM public.projects p
    WHERE p.deleted_at IS NULL
      AND p.team_id = ANY(team_ids)
    UNION
    -- Plus the legacy inference, for rows still unattributed.
    SELECT m.team_id, p.id
    FROM members m
    JOIN public.projects p ON p.created_by = m.user_id
    WHERE p.deleted_at IS NULL
      AND p.team_id IS NULL
  ),
  photo_rollup AS (
    SELECT tp.team_id,
           count(ph.id)                    AS photo_count,
           coalesce(sum(ph.size_bytes), 0) AS storage_bytes
    FROM team_projects tp
    JOIN public.photos ph ON ph.project_id = tp.project_id
    GROUP BY tp.team_id
  )
  SELECT t.id,
         (SELECT count(*)::integer FROM members m WHERE m.team_id = t.id),
         (SELECT count(*)::integer FROM team_projects tp WHERE tp.team_id = t.id),
         coalesce((SELECT pr.photo_count FROM photo_rollup pr WHERE pr.team_id = t.id), 0)::integer,
         coalesce((SELECT pr.storage_bytes FROM photo_rollup pr WHERE pr.team_id = t.id), 0)::bigint
  FROM unnest(team_ids) AS t(id);
$$;

REVOKE ALL ON FUNCTION public.admin_team_rollups(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_rollups(uuid[]) TO service_role;

-- Verify:
--   SELECT count(*) FILTER (WHERE team_id IS NULL) AS unattributed,
--          count(*)                                AS live
--     FROM public.projects WHERE deleted_at IS NULL;
--
--   -- Should now agree with the Overview total minus the unattributed count:
--   SELECT sum(project_count) FROM public.admin_team_rollups(
--     ARRAY(SELECT id FROM public.teams));
