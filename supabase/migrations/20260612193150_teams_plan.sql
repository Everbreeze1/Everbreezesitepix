-- Teams plan limits + Starter sharing block
-- Apply manually in the Supabase SQL editor on project ulmgvtuqjlzzadlwtiog.
-- Safe to re-run.

-- ============================================================
-- 1. Add plan + member_limit to teams
-- ============================================================
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'starter';

ALTER TABLE public.teams
  DROP CONSTRAINT IF EXISTS teams_plan_check;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_plan_check CHECK (plan IN ('starter', 'pro', 'team'));

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS member_limit INT NOT NULL DEFAULT 2;

-- Keep member_limit consistent with plan whenever plan changes
CREATE OR REPLACE FUNCTION public.teams_sync_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.member_limit := CASE NEW.plan
    WHEN 'starter' THEN 2
    WHEN 'pro'     THEN 50
    WHEN 'team'    THEN 50
    ELSE 2
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_sync_member_limit_trg ON public.teams;
CREATE TRIGGER teams_sync_member_limit_trg
  BEFORE INSERT OR UPDATE OF plan ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.teams_sync_member_limit();

-- Backfill any existing rows
UPDATE public.teams SET plan = plan; -- re-fires trigger to sync member_limit

-- ============================================================
-- 2. Gate are_teammates() on plan = 'pro' or 'team'
-- Starter teams do NOT share projects/photos/etc.
-- ============================================================
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
      AND t.plan IN ('pro', 'team')
  )
$$;
