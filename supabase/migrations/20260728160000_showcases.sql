-- Job Showcases (Team tier): a curated, publicly shareable portfolio page —
-- pick any photos across projects, caption them, pick a layout, publish.
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog). Idempotent.

CREATE TABLE IF NOT EXISTS public.showcases (
  id             uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id        uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title          text NOT NULL,
  tagline        text,
  cover_photo_id uuid,
  layout         text NOT NULL DEFAULT 'grid' CHECK (layout IN ('grid', 'masonry', 'featured')),
  share_token    uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS showcases_team_id_idx ON public.showcases(team_id);
CREATE INDEX IF NOT EXISTS showcases_share_token_idx ON public.showcases(share_token);

CREATE TABLE IF NOT EXISTS public.showcase_items (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  showcase_id uuid NOT NULL REFERENCES public.showcases(id) ON DELETE CASCADE,
  photo_id    uuid NOT NULL,
  caption     text,
  position    int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS showcase_items_showcase_id_idx ON public.showcase_items(showcase_id);

CREATE OR REPLACE FUNCTION public.showcases_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS showcases_updated_at_trg ON public.showcases;
CREATE TRIGGER showcases_updated_at_trg
  BEFORE UPDATE ON public.showcases
  FOR EACH ROW EXECUTE FUNCTION public.showcases_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.showcases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.showcase_items TO authenticated;
GRANT ALL ON public.showcases TO service_role;
GRANT ALL ON public.showcase_items TO service_role;

ALTER TABLE public.showcases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.showcase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members view showcases" ON public.showcases;
CREATE POLICY "Team members view showcases" ON public.showcases
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = showcases.team_id AND tm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Team members create showcases" ON public.showcases;
CREATE POLICY "Team members create showcases" ON public.showcases
  FOR INSERT TO authenticated WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = showcases.team_id AND tm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Creators and admins manage showcases" ON public.showcases;
CREATE POLICY "Creators and admins manage showcases" ON public.showcases
  FOR UPDATE TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = showcases.team_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Creators and admins delete showcases" ON public.showcases;
CREATE POLICY "Creators and admins delete showcases" ON public.showcases
  FOR DELETE TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = showcases.team_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Manage items on your own showcases" ON public.showcase_items;
CREATE POLICY "Manage items on your own showcases" ON public.showcase_items
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.showcases s
      JOIN public.team_members tm ON tm.team_id = s.team_id AND tm.user_id = auth.uid()
      WHERE s.id = showcase_items.showcase_id
        AND (s.created_by = auth.uid() OR tm.role IN ('owner', 'admin'))
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.showcases s
      JOIN public.team_members tm ON tm.team_id = s.team_id AND tm.user_id = auth.uid()
      WHERE s.id = showcase_items.showcase_id
        AND (s.created_by = auth.uid() OR tm.role IN ('owner', 'admin'))
    )
  );

DROP POLICY IF EXISTS "Team members view showcase items" ON public.showcase_items;
CREATE POLICY "Team members view showcase items" ON public.showcase_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.showcases s
      JOIN public.team_members tm ON tm.team_id = s.team_id AND tm.user_id = auth.uid()
      WHERE s.id = showcase_items.showcase_id
    )
  );
