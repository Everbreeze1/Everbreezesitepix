-- Text snippets shouldn't require a team — a solo user must be able to save
-- and reuse them. Makes team_id nullable and scopes RLS to "mine OR my team's".
-- Apply via the SitePix Supabase SQL editor (or `supabase db push`). Idempotent.

ALTER TABLE public.text_snippets ALTER COLUMN team_id DROP NOT NULL;

DROP POLICY IF EXISTS "Team members read text snippets" ON public.text_snippets;
DROP POLICY IF EXISTS "Team members manage text snippets" ON public.text_snippets;
DROP POLICY IF EXISTS "Read own or team text snippets" ON public.text_snippets;
DROP POLICY IF EXISTS "Manage own or team text snippets" ON public.text_snippets;

CREATE POLICY "Read own or team text snippets" ON public.text_snippets
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      team_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = text_snippets.team_id AND tm.user_id = auth.uid())
    )
  );

CREATE POLICY "Manage own or team text snippets" ON public.text_snippets
  FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      team_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = text_snippets.team_id AND tm.user_id = auth.uid())
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR (
      team_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = text_snippets.team_id AND tm.user_id = auth.uid())
    )
  );
