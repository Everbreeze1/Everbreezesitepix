-- PROJECT REPORTS - run this in the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- The Lovable Cloud migration tool targets a different Postgres project,
-- so this file is here for you to paste into the Everlumen project's SQL editor.

CREATE TABLE IF NOT EXISTS public.project_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  summary text,
  photo_ids uuid[] NOT NULL DEFAULT '{}',
  include_project_info boolean NOT NULL DEFAULT true,
  share_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  allow_download boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_reports TO authenticated;
GRANT ALL ON public.project_reports TO service_role;

CREATE INDEX IF NOT EXISTS project_reports_project_id_idx ON public.project_reports(project_id);
CREATE INDEX IF NOT EXISTS project_reports_created_by_idx ON public.project_reports(created_by);
CREATE INDEX IF NOT EXISTS project_reports_share_token_idx ON public.project_reports(share_token);

ALTER TABLE public.project_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own reports" ON public.project_reports;
CREATE POLICY "Users view own reports" ON public.project_reports
  FOR SELECT TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users insert own reports" ON public.project_reports;
CREATE POLICY "Users insert own reports" ON public.project_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users update own reports" ON public.project_reports;
CREATE POLICY "Users update own reports" ON public.project_reports
  FOR UPDATE TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users delete own reports" ON public.project_reports;
CREATE POLICY "Users delete own reports" ON public.project_reports
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- updated_at trigger (reuses handle_updated_at() if present, otherwise create it)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_reports_updated_at ON public.project_reports;
CREATE TRIGGER project_reports_updated_at
  BEFORE UPDATE ON public.project_reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
