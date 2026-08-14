-- Starter teams share their project record.
--
-- 20260612193150_teams_plan.sql gated are_teammates() on plan IN ('pro','team'),
-- so a Starter team could invite its one extra member but each person still saw
-- only their own projects - the seat was effectively useless. Client feedback:
-- Starter is for small crews and those two people should work off the same
-- project record.
--
-- Starter is inherently capped at 2 seats by teams.member_limit (kept in sync by
-- teams_sync_member_limit_trg in the same migration), so opening this up cannot
-- turn into unbounded free team access - the plan ceiling is the limit, not this
-- predicate.
--
-- Scope: are_teammates() is the SELECT/UPDATE/DELETE predicate behind projects,
-- photos, checklists, reports, tasks, photo_comments, ai_analyses and
-- notifications, i.e. exactly "the project record". It is NOT what gates the
-- paid features:
--   * Workflows stay Team-only    - public.is_team_plan()  (20260724010000)
--   * Walkthroughs / watermark /
--     photo-in-chat stay Pro+     - getCallerTeamPlan().isPro (apps/api/src/lib/team-plan.ts)
-- Those are separate predicates and are deliberately left untouched here.
--
-- Apply via the SitePix Supabase SQL editor (or `supabase db push`). Safe to re-run.

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
  )
$$;
