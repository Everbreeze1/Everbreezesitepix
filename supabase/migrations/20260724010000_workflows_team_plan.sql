-- Workflows are a Team-only feature (no legitimate Starter/Pro use case).
-- Close the server-side gap: restrict project_workflows INSERT to Team-plan
-- (or internal) teams, mirroring the are_teammates() pattern in
-- 20260612193150_teams_plan.sql. Apply manually in the Supabase SQL editor
-- (or `supabase db push`). Safe to re-run.

CREATE OR REPLACE FUNCTION public.is_team_plan(_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.user_id = _user AND (t.plan = 'team' OR t.is_internal)
  )
$$;

DROP POLICY IF EXISTS "Insert workflows on own projects" ON public.project_workflows;
CREATE POLICY "Insert workflows on own projects" ON public.project_workflows
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
    AND public.is_team_plan(auth.uid())
  );
