-- Customer Review Requests (Team tier): owner/admin configures where a
-- customer viewing a shared report should be sent to leave a review.
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog). Idempotent.

CREATE TABLE IF NOT EXISTS public.team_review_links (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id    uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  platform   text NOT NULL CHECK (platform IN ('google', 'nicejob', 'custom')),
  url        text NOT NULL,
  label      text,
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_review_links_team_id_idx ON public.team_review_links(team_id);

-- Team members can see their own team's links (Settings UI); only
-- owner/admin can write. Public reads for the share page go through the
-- service-role key (apps/api), not client RLS — the report share token
-- itself is the authorization there, not team membership.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_review_links TO authenticated;
GRANT ALL ON public.team_review_links TO service_role;

ALTER TABLE public.team_review_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members view review links" ON public.team_review_links;
CREATE POLICY "Team members view review links" ON public.team_review_links
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = team_review_links.team_id AND tm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owners/admins manage review links" ON public.team_review_links;
CREATE POLICY "Owners/admins manage review links" ON public.team_review_links
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = team_review_links.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = team_review_links.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner', 'admin')
    )
  );
