-- Admin dashboard: the teams screen, answered in one query.
--
-- WHY
--
-- The users screen got a real directory (20260823100000) and the teams screen
-- did not, so the two now disagree about what an admin list is. Teams still
-- cursor-paginates with a name search and nothing else, which means:
--
--   * No total. The tiles read "Teams 50" when there are 400, because they
--     count the rows that happen to be loaded.
--   * The industry mix - the panel the business profile was collected FOR -
--     is tallied over one page and captioned to admit it. A distribution over
--     an arbitrary fifty rows is not a distribution.
--   * No way to ask the questions that matter: who is past due, who is on a
--     paid plan with no subscription, who has gone quiet, who never finished
--     the setup wizard.
--   * Sorting is fixed to newest-first, so "which teams use the most storage"
--     cannot be asked at all.
--
-- Same shape as admin_user_directory: filtered, sorted, paginated, with the
-- total carried on every row by a window function, and the per-team rollups
-- joined in rather than fanned out per row in Node.
--
-- Apply via the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent. Safe to re-run.

CREATE OR REPLACE FUNCTION public.admin_team_directory(
  p_search text DEFAULT NULL,
  p_plan   text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sort   text DEFAULT 'created',
  p_desc   boolean DEFAULT true,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id                     uuid,
  name                   text,
  plan                   text,
  subscription_status    text,
  is_internal            boolean,
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz,
  owner_email            text,
  owner_name             text,
  member_count           integer,
  project_count          integer,
  photo_count            integer,
  storage_bytes          bigint,
  last_activity_at       timestamptz,
  industry               text,
  team_size              text,
  profile_completed_at   timestamptz,
  total_count            bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH members AS (
    SELECT tm.team_id, tm.user_id FROM public.team_members tm
  ),
  member_counts AS (
    SELECT team_id, count(*)::integer AS n FROM members GROUP BY team_id
  ),
  photo_bytes AS (
    SELECT ph.project_id, sum(ph.size_bytes) AS bytes, count(*) AS n
    FROM public.photos ph
    GROUP BY ph.project_id
  ),
  -- Same attribution rule as admin_team_rollups: the column when it is set,
  -- the old membership inference only for rows still unattributed.
  team_projects AS (
    SELECT p.team_id, p.id AS project_id
    FROM public.projects p
    WHERE p.deleted_at IS NULL AND p.team_id IS NOT NULL
    UNION
    SELECT m.team_id, p.id
    FROM members m
    JOIN public.projects p ON p.created_by = m.user_id
    WHERE p.deleted_at IS NULL AND p.team_id IS NULL
  ),
  project_rollup AS (
    SELECT tp.team_id,
           count(DISTINCT tp.project_id)::integer  AS project_count,
           coalesce(sum(pb.n), 0)::integer         AS photo_count,
           coalesce(sum(pb.bytes), 0)::bigint      AS storage_bytes
    FROM team_projects tp
    LEFT JOIN photo_bytes pb ON pb.project_id = tp.project_id
    GROUP BY tp.team_id
  ),
  -- When anyone on the team last did anything. This is what answers "is this
  -- account alive", which the teams screen could not say at all.
  activity AS (
    SELECT m.team_id, max(l.created_at) AS last_activity_at
    FROM members m
    JOIN public.api_audit_logs l ON l.user_id = m.user_id
    GROUP BY m.team_id
  ),
  joined AS (
    SELECT
      t.id, t.name, t.plan, t.subscription_status, t.is_internal,
      t.stripe_customer_id, t.stripe_subscription_id, t.created_at,
      op.email     AS owner_email,
      op.full_name AS owner_name,
      coalesce(mc.n, 0)                  AS member_count,
      coalesce(pr.project_count, 0)      AS project_count,
      coalesce(pr.photo_count, 0)        AS photo_count,
      coalesce(pr.storage_bytes, 0)      AS storage_bytes,
      a.last_activity_at,
      t.industry, t.team_size, t.profile_completed_at
    FROM public.teams t
    LEFT JOIN public.profiles op ON op.id = t.owner_id
    LEFT JOIN member_counts mc  ON mc.team_id = t.id
    LEFT JOIN project_rollup pr ON pr.team_id = t.id
    LEFT JOIN activity a        ON a.team_id = t.id
  ),
  filtered AS (
    SELECT j.* FROM joined j
    WHERE (
        p_search IS NULL OR p_search = ''
        OR j.name        ILIKE '%' || p_search || '%'
        OR j.owner_email ILIKE '%' || p_search || '%'
        OR j.owner_name  ILIKE '%' || p_search || '%'
      )
      AND (p_plan IS NULL OR p_plan = '' OR j.plan = p_plan)
      AND (
        p_status IS NULL OR p_status = ''
        OR (p_status = 'active'      AND j.subscription_status IN ('active', 'trialing'))
        OR (p_status = 'past_due'    AND j.subscription_status IN ('past_due', 'unpaid'))
        OR (p_status = 'canceled'    AND j.subscription_status IN ('canceled', 'incomplete_expired'))
        OR (p_status = 'internal'    AND j.is_internal)
        -- The paywall-hole signature: a paid plan with nothing backing it.
        OR (p_status = 'unpaid_plan' AND j.plan <> 'starter'
                                     AND j.stripe_subscription_id IS NULL
                                     AND NOT j.is_internal)
        OR (p_status = 'no_profile'  AND j.profile_completed_at IS NULL)
        OR (p_status = 'dormant'     AND (j.last_activity_at IS NULL
                                          OR j.last_activity_at < now() - interval '30 days'))
      )
  )
  SELECT
    f.id, f.name, f.plan, f.subscription_status, f.is_internal,
    f.stripe_customer_id, f.stripe_subscription_id, f.created_at,
    f.owner_email, f.owner_name,
    f.member_count, f.project_count, f.photo_count, f.storage_bytes,
    f.last_activity_at, f.industry, f.team_size, f.profile_completed_at,
    count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    (CASE WHEN p_desc THEN
      CASE p_sort
        WHEN 'created'  THEN extract(epoch FROM f.created_at)
        WHEN 'activity' THEN extract(epoch FROM f.last_activity_at)
        WHEN 'members'  THEN f.member_count::numeric
        WHEN 'projects' THEN f.project_count::numeric
        WHEN 'storage'  THEN f.storage_bytes::numeric
      END
    END) DESC NULLS LAST,
    (CASE WHEN NOT p_desc THEN
      CASE p_sort
        WHEN 'created'  THEN extract(epoch FROM f.created_at)
        WHEN 'activity' THEN extract(epoch FROM f.last_activity_at)
        WHEN 'members'  THEN f.member_count::numeric
        WHEN 'projects' THEN f.project_count::numeric
        WHEN 'storage'  THEN f.storage_bytes::numeric
      END
    END) ASC NULLS LAST,
    (CASE WHEN p_sort = 'name' AND p_desc THEN lower(f.name) END) DESC NULLS LAST,
    (CASE WHEN p_sort = 'name' AND NOT p_desc THEN lower(f.name) END) ASC NULLS LAST,
    -- Stable tiebreak, so paging cannot repeat or skip on equal sort keys.
    f.created_at DESC, f.id
  LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.admin_team_directory(text, text, text, text, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_directory(text, text, text, text, boolean, integer, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- The industry mix, over EVERY team rather than over one page.
--
-- This panel is the reason the setup wizard collects a business profile, and
-- it has been counting whatever fifty rows were loaded. Its own caption had to
-- admit as much. A separate function because it is a different shape - a
-- distribution, not a page - and it must not be constrained by the paging.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_team_industry_mix()
RETURNS TABLE (industry text, n integer, total_teams bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(t.industry, '__none') AS industry,
         count(*)::integer,
         (SELECT count(*) FROM public.teams)
  FROM public.teams t
  GROUP BY coalesce(t.industry, '__none')
  ORDER BY count(*) DESC, 1;
$$;

REVOKE ALL ON FUNCTION public.admin_team_industry_mix() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_team_industry_mix() TO service_role;

-- Verify:
--   SELECT name, member_count, project_count, storage_bytes, total_count
--     FROM public.admin_team_directory(NULL, NULL, NULL, 'storage', true, 10, 0);
--   SELECT * FROM public.admin_team_industry_mix();
