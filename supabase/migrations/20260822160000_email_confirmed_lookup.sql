-- Replace N GoTrue admin round trips with one query, for getMyTeam.
--
-- WHY
--
-- getMyTeamService needs `email_confirmed_at` per team member: an invitee who
-- accepts through acceptInviteSignup joins the team immediately but cannot sign
-- in until they click the confirmation mail, and ProjectTasks blocks assigning
-- work to them. That is correct and worth keeping.
--
-- The way it was fetched is not. It calls `auth.admin.getUserById` once per
-- member - one HTTPS round trip to GoTrue each - and its own comment justifies
-- that with "this is a page that loads once". It is not. AppSidebar calls
-- getMyTeam on every mount with a 60-second staleTime, which makes it the
-- single most requested operation in the product: 7,549 calls in 7 days, 39% of
-- all API traffic, p50 1.9s, one outlier at 130s.
--
-- This function returns the same information for a whole team in one query.
-- `auth.users` is not reachable through PostgREST, so SECURITY DEFINER is what
-- makes it readable at all - and is exactly why EXECUTE is revoked from
-- everyone except the service role below.
--
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent. Safe to re-run.

CREATE OR REPLACE FUNCTION public.email_confirmed_for_users(user_ids uuid[])
RETURNS TABLE (
  user_id         uuid,
  email_confirmed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  -- Driven off unnest() rather than off auth.users, so an id with no auth row
  -- comes back as a row with NULL rather than vanishing. The caller
  -- distinguishes "not confirmed" from "unknown", and silently dropping an id
  -- would turn the second into the first.
  SELECT u.id, (a.email_confirmed_at IS NOT NULL)
  FROM unnest(user_ids) AS u(id)
  LEFT JOIN auth.users a ON a.id = u.id;
$$;

-- SECURITY DEFINER over auth.users. Postgres grants EXECUTE to PUBLIC on every
-- new function by default - the same default that made new tables anon-readable
-- in 20260811000000_lock_down_anon_reads.sql - so this REVOKE is the
-- load-bearing line, not the GRANT. Without it any signed-in user could
-- enumerate confirmation state for arbitrary account ids.
REVOKE ALL ON FUNCTION public.email_confirmed_for_users(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_confirmed_for_users(uuid[]) TO service_role;

-- Verify (expect one row per id, and `false` for a random uuid):
--   SELECT * FROM public.email_confirmed_for_users(
--     ARRAY(SELECT user_id FROM public.team_members LIMIT 5));
