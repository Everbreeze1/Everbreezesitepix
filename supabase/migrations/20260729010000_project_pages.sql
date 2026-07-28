-- Free-form Word-style documents ("Pages"), folders, and reusable text
-- snippets — see docs/documents-feature-plan.md. Apply via the SitePix
-- Supabase SQL editor (or `supabase db push`). Idempotent.

-- =========================
-- FOLDERS (flat, per-project)
-- =========================
CREATE TABLE IF NOT EXISTS public.project_document_folders (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_document_folders_project ON public.project_document_folders(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_document_folders TO authenticated;
GRANT ALL ON public.project_document_folders TO service_role;

ALTER TABLE public.project_document_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teammates manage document folders" ON public.project_document_folders;
CREATE POLICY "Teammates manage document folders" ON public.project_document_folders
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_document_folders.project_id AND public.are_teammates(auth.uid(), p.created_by))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_document_folders.project_id AND public.are_teammates(auth.uid(), p.created_by))
  );

-- =========================
-- PAGES (free-form rich-text documents)
-- =========================
CREATE TABLE IF NOT EXISTS public.project_pages (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  folder_id       uuid REFERENCES public.project_document_folders(id) ON DELETE SET NULL,
  created_by      uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title           text NOT NULL DEFAULT 'Untitled',
  content_html    text NOT NULL DEFAULT '',
  source_template text,
  share_token     uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_pages_project ON public.project_pages(project_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_pages TO authenticated;
GRANT ALL ON public.project_pages TO service_role;

ALTER TABLE public.project_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teammates manage project pages" ON public.project_pages;
CREATE POLICY "Teammates manage project pages" ON public.project_pages
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_pages.project_id AND public.are_teammates(auth.uid(), p.created_by))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_pages.project_id AND public.are_teammates(auth.uid(), p.created_by))
  );

CREATE OR REPLACE FUNCTION public.touch_project_page_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_project_pages_updated_at ON public.project_pages;
CREATE TRIGGER trg_project_pages_updated_at
  BEFORE UPDATE ON public.project_pages
  FOR EACH ROW EXECUTE FUNCTION public.touch_project_page_updated_at();

-- =========================
-- TEXT SNIPPETS (team-scoped, reusable canned text blocks)
-- =========================
CREATE TABLE IF NOT EXISTS public.text_snippets (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id      uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title        text NOT NULL,
  content_html text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_text_snippets_team ON public.text_snippets(team_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.text_snippets TO authenticated;
GRANT ALL ON public.text_snippets TO service_role;

ALTER TABLE public.text_snippets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members read text snippets" ON public.text_snippets;
CREATE POLICY "Team members read text snippets" ON public.text_snippets
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = text_snippets.team_id AND tm.user_id = auth.uid()));

DROP POLICY IF EXISTS "Team members manage text snippets" ON public.text_snippets;
CREATE POLICY "Team members manage text snippets" ON public.text_snippets
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = text_snippets.team_id AND tm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = text_snippets.team_id AND tm.user_id = auth.uid()));

-- =========================
-- Let existing file uploads live inside folders too
-- =========================
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.project_document_folders(id) ON DELETE SET NULL;
