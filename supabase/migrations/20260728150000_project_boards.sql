-- "Tag Boards" — team-shared, auto-updating project boards (any project whose
-- tags intersect the board's tag_ids appears automatically). Distinct from the
-- existing project_groups (manual, per-user, static membership) — see
-- docs/new-features-plan.md §5 for why this is a separate table.
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog). Idempotent.

CREATE TABLE IF NOT EXISTS public.project_boards (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name       text NOT NULL,
  tag_ids    uuid[] NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_boards_team_id_idx ON public.project_boards(team_id);

CREATE OR REPLACE FUNCTION public.project_boards_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_boards_updated_at_trg ON public.project_boards;
CREATE TRIGGER project_boards_updated_at_trg
  BEFORE UPDATE ON public.project_boards
  FOR EACH ROW EXECUTE FUNCTION public.project_boards_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_boards TO authenticated;
GRANT ALL ON public.project_boards TO service_role;

ALTER TABLE public.project_boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members view boards" ON public.project_boards;
CREATE POLICY "Team members view boards" ON public.project_boards
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = project_boards.team_id AND tm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owners/admins manage boards" ON public.project_boards;
CREATE POLICY "Owners/admins manage boards" ON public.project_boards
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = project_boards.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = project_boards.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  );
