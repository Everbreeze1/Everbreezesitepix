-- Admin dashboard: a real user directory, and support notes.
--
-- WHY
--
-- The users screen could do two things: match a substring, and toggle platform
-- admin. Everything an operator actually asks was unanswerable from it - who is
-- suspended, who never confirmed their email, who belongs to no team, who has
-- not signed in for a month, how many users are there at all. The list was also
-- assembled in Node: read a page of profiles, then fan out for memberships and
-- admin rows and count in JavaScript. That does not survive growth, and it
-- cannot sort or filter on anything it has not already fetched.
--
-- `admin_user_directory` answers the whole screen in one query - filtered,
-- sorted, paginated, and with the total count carried on every row via a window
-- function, so "37 of 1,204" costs nothing extra.
--
-- ONE ROW PER USER
--
-- The membership join is a LATERAL that picks a single team: the one the user
-- owns if there is one, else their earliest. A plain LEFT JOIN to team_members
-- would emit one row per membership, which would double-count a user in two
-- teams and quietly corrupt both the total and the pagination. `team_count`
-- carries the truth so the UI can say "+1 more" rather than lie by omission.
--
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent. Safe to re-run.

CREATE OR REPLACE FUNCTION public.admin_user_directory(
  p_search text DEFAULT NULL,
  p_plan   text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sort   text DEFAULT 'joined',
  p_desc   boolean DEFAULT true,
  p_limit  integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id                uuid,
  full_name         text,
  email             text,
  company           text,
  created_at        timestamptz,
  team_id           uuid,
  team_name         text,
  team_plan         text,
  team_role         text,
  team_count        integer,
  is_platform_admin boolean,
  admin_role        text,
  email_confirmed   boolean,
  banned_until      timestamptz,
  last_sign_in_at   timestamptz,
  last_seen_at      timestamptz,
  requests_30d      bigint,
  project_count     integer,
  storage_bytes     bigint,
  feedback_count    integer,
  total_count       bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH activity AS (
    -- Last seen and recent volume. This is the column that answers "is this
    -- account alive", which nothing in the product could previously say.
    SELECT l.user_id,
           max(l.created_at) AS last_seen_at,
           count(*)          AS requests_30d
    FROM public.api_audit_logs l
    WHERE l.user_id IS NOT NULL
      AND l.created_at >= now() - interval '30 days'
    GROUP BY l.user_id
  ),
  photo_bytes AS (
    SELECT ph.project_id, sum(ph.size_bytes) AS bytes, count(*) AS n
    FROM public.photos ph
    GROUP BY ph.project_id
  ),
  owned AS (
    SELECT pr.created_by AS user_id,
           count(*)::integer                  AS project_count,
           coalesce(sum(pb.bytes), 0)::bigint AS storage_bytes
    FROM public.projects pr
    LEFT JOIN photo_bytes pb ON pb.project_id = pr.id
    WHERE pr.deleted_at IS NULL
    GROUP BY pr.created_by
  ),
  reports AS (
    SELECT ir.user_id, count(*)::integer AS feedback_count
    FROM public.issue_reports ir
    WHERE ir.user_id IS NOT NULL
    GROUP BY ir.user_id
  ),
  joined AS (
    SELECT
      p.id, p.full_name, p.email, p.company, p.created_at,
      m.team_id, m.team_name, m.team_plan, m.team_role,
      coalesce(m.team_count, 0)                      AS team_count,
      (pa.user_id IS NOT NULL)                       AS is_platform_admin,
      pa.role                                        AS admin_role,
      (au.email_confirmed_at IS NOT NULL)            AS email_confirmed,
      au.banned_until,
      au.last_sign_in_at,
      a.last_seen_at,
      coalesce(a.requests_30d, 0)                    AS requests_30d,
      coalesce(o.project_count, 0)                   AS project_count,
      coalesce(o.storage_bytes, 0)                   AS storage_bytes,
      coalesce(r.feedback_count, 0)                  AS feedback_count
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT tm.team_id,
             t.name AS team_name,
             t.plan AS team_plan,
             tm.role AS team_role,
             (SELECT count(*)::integer FROM public.team_members x WHERE x.user_id = p.id) AS team_count
      FROM public.team_members tm
      JOIN public.teams t ON t.id = tm.team_id
      WHERE tm.user_id = p.id
      -- Owned team first, then earliest joined. Deterministic, so the same
      -- user does not move between pages on successive loads.
      ORDER BY (t.owner_id = p.id) DESC, tm.created_at ASC
      LIMIT 1
    ) m ON true
    LEFT JOIN public.platform_admins pa ON pa.user_id = p.id
    LEFT JOIN auth.users au             ON au.id = p.id
    LEFT JOIN activity a                ON a.user_id = p.id
    LEFT JOIN owned o                   ON o.user_id = p.id
    LEFT JOIN reports r                 ON r.user_id = p.id
  ),
  filtered AS (
    SELECT j.* FROM joined j
    WHERE (
        p_search IS NULL OR p_search = ''
        OR j.full_name ILIKE '%' || p_search || '%'
        OR j.email    ILIKE '%' || p_search || '%'
        OR j.company  ILIKE '%' || p_search || '%'
      )
      AND (p_plan IS NULL OR p_plan = '' OR j.team_plan = p_plan)
      AND (
        p_status IS NULL OR p_status = ''
        OR (p_status = 'suspended'   AND j.banned_until IS NOT NULL AND j.banned_until > now())
        OR (p_status = 'unconfirmed' AND NOT j.email_confirmed)
        OR (p_status = 'no_team'     AND j.team_id IS NULL)
        OR (p_status = 'admin'       AND j.is_platform_admin)
        OR (p_status = 'dormant'     AND (j.last_seen_at IS NULL OR j.last_seen_at < now() - interval '30 days'))
        OR (p_status = 'active'      AND j.email_confirmed
                                     AND (j.banned_until IS NULL OR j.banned_until <= now()))
      )
  )
  SELECT
    f.id, f.full_name, f.email, f.company, f.created_at,
    f.team_id, f.team_name, f.team_plan, f.team_role, f.team_count,
    f.is_platform_admin, f.admin_role, f.email_confirmed, f.banned_until,
    f.last_sign_in_at, f.last_seen_at, f.requests_30d,
    f.project_count, f.storage_bytes, f.feedback_count,
    -- The total BEFORE limit/offset, carried on every row. This is what lets
    -- the screen say "37 of 1,204" without a second round trip.
    count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY
    -- Numeric sorts. NULLS LAST in both directions: a user who has never been
    -- seen belongs at the bottom of "least recently seen" too, not at the top
    -- of it by accident of NULL ordering.
    (CASE WHEN p_desc THEN
      CASE p_sort
        WHEN 'joined'    THEN extract(epoch FROM f.created_at)
        WHEN 'last_seen' THEN extract(epoch FROM f.last_seen_at)
        WHEN 'storage'   THEN f.storage_bytes::numeric
        WHEN 'projects'  THEN f.project_count::numeric
        WHEN 'activity'  THEN f.requests_30d::numeric
      END
    END) DESC NULLS LAST,
    (CASE WHEN NOT p_desc THEN
      CASE p_sort
        WHEN 'joined'    THEN extract(epoch FROM f.created_at)
        WHEN 'last_seen' THEN extract(epoch FROM f.last_seen_at)
        WHEN 'storage'   THEN f.storage_bytes::numeric
        WHEN 'projects'  THEN f.project_count::numeric
        WHEN 'activity'  THEN f.requests_30d::numeric
      END
    END) ASC NULLS LAST,
    (CASE WHEN p_sort = 'name' AND p_desc THEN lower(coalesce(f.full_name, f.email)) END) DESC NULLS LAST,
    (CASE WHEN p_sort = 'name' AND NOT p_desc THEN lower(coalesce(f.full_name, f.email)) END) ASC NULLS LAST,
    -- Final tiebreak, so pagination is stable when the sort key ties.
    f.created_at DESC, f.id
  LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0);
$$;

REVOKE ALL ON FUNCTION public.admin_user_directory(text, text, text, text, boolean, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_directory(text, text, text, text, boolean, integer, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Support notes.
--
-- Why an account was touched is not derivable from the audit log: that records
-- what happened, not what the customer said or what was agreed. Without
-- somewhere to write "called about the duplicate charge, refunding manually",
-- that context lives in one person's inbox.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_notes (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notes_user_created_idx ON public.user_notes (user_id, created_at DESC);

-- Same shape as platform_admins and admin_audit_log: service role only. These
-- are internal notes ABOUT a customer and must never be readable by them, so
-- the REVOKE matters more here than almost anywhere - Supabase grants new
-- public tables to anon by default.
REVOKE ALL ON public.user_notes FROM anon, authenticated;
GRANT ALL ON public.user_notes TO service_role;
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
-- No policies for `authenticated` -> RLS default-denies all client access.

-- Verify:
--   SELECT id, email, team_name, last_seen_at, total_count
--     FROM public.admin_user_directory(NULL, NULL, NULL, 'joined', true, 5, 0);
--   SELECT * FROM public.admin_user_directory(NULL, NULL, 'unconfirmed', 'joined', true, 50, 0);
