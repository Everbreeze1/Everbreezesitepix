-- Admin dashboard: team and project rollups computed in the database.
--
-- WHY
--
-- listPlatformTeamsService used to compute member/project/photo/storage counts
-- by selecting every team_members row for the page, then every projects row
-- created by any of those members, then EVERY photos row belonging to any of
-- those projects, and counting them in a JS Map. One admin page view therefore
-- transferred the photo table for fifty teams. It also hit the `IN (...)` limit
-- documented in apps/api/src/lib/chunked-in.ts once a page's projects passed
-- ~398, which fails the request outright.
--
-- It was wrong as well as slow. The Map that attributed a project to a team was
-- keyed by user_id, so a user belonging to two teams kept only the last team
-- seen and every project they created vanished from the other team's totals,
-- silently and with no way to notice from the screen.
--
-- ATTRIBUTION
--
-- Projects have no team_id column; team ownership is inferred as "created by
-- someone who is currently a member of this team". These functions keep that
-- rule, but apply it per team rather than per user: a project created by a
-- member of two teams counts for both, because both teams' members can see it.
-- That is the honest reading of the current schema. The real fix is a
-- projects.team_id FK with a backfill - see docs/admin-plan.md 1.5 - and when
-- that lands these function bodies are the only thing that changes.
--
-- Apply via the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent. Safe to re-run.

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
  -- DISTINCT on (team_id, project_id): one row per team per project, so a
  -- project whose creator sits in two teams is counted once for each and
  -- never twice for the same one.
  team_projects AS (
    SELECT DISTINCT m.team_id, p.id AS project_id
    FROM members m
    JOIN public.projects p ON p.created_by = m.user_id
    WHERE p.deleted_at IS NULL
  ),
  photo_rollup AS (
    SELECT tp.team_id,
           count(ph.id)                     AS photo_count,
           coalesce(sum(ph.size_bytes), 0)  AS storage_bytes
    FROM team_projects tp
    JOIN public.photos ph ON ph.project_id = tp.project_id
    GROUP BY tp.team_id
  )
  -- Driven off unnest() rather off the CTEs so that a team with no members
  -- still comes back, as a row of zeroes, instead of being absent from the
  -- result and reading as "failed to load" on the page.
  SELECT t.id,
         (SELECT count(*)::integer FROM members m WHERE m.team_id = t.id),
         (SELECT count(*)::integer FROM team_projects tp WHERE tp.team_id = t.id),
         coalesce((SELECT pr.photo_count FROM photo_rollup pr WHERE pr.team_id = t.id), 0)::integer,
         coalesce((SELECT pr.storage_bytes FROM photo_rollup pr WHERE pr.team_id = t.id), 0)::bigint
  FROM unnest(team_ids) AS t(id);
$$;

-- Per-project photo counts, for the team detail page's project table.
CREATE OR REPLACE FUNCTION public.admin_project_rollups(project_ids uuid[])
RETURNS TABLE (
  project_id    uuid,
  photo_count   integer,
  storage_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         coalesce(count(ph.id), 0)::integer,
         coalesce(sum(ph.size_bytes), 0)::bigint
  FROM unnest(project_ids) AS p(id)
  LEFT JOIN public.photos ph ON ph.project_id = p.id
  GROUP BY p.id;
$$;

-- SECURITY DEFINER means these read past RLS, so execute must be locked to the
-- service role. Postgres grants EXECUTE to PUBLIC on every new function by
-- default - the same default that made new tables anon-readable in
-- 20260811000000_lock_down_anon_reads.sql - so the REVOKE is the load-bearing
-- line here, not the GRANT.
REVOKE ALL ON FUNCTION public.admin_team_rollups(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_project_rollups(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_rollups(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_project_rollups(uuid[]) TO service_role;

-- Supporting indexes. Both joins above are the hot path for every admin page
-- load; without these the rollup is a sequential scan of photos.
CREATE INDEX IF NOT EXISTS photos_project_id_idx ON public.photos (project_id);
CREATE INDEX IF NOT EXISTS projects_created_by_idx ON public.projects (created_by);
CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON public.team_members (team_id);

-- Verify (expect one row per id, zeroes for an unknown uuid):
--   SELECT * FROM public.admin_team_rollups(ARRAY(SELECT id FROM public.teams LIMIT 5));
