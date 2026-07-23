-- Site Log persistence — run against the SitePix Supabase project.
-- Stores per-project Site Logs (title + selected photos + per-photo notes/action items).

CREATE TABLE IF NOT EXISTS public.project_site_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL DEFAULT auth.uid(),
  title       text NOT NULL DEFAULT 'Site Log',
  photo_ids   uuid[] NOT NULL DEFAULT '{}',
  notes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_site_logs TO authenticated;
GRANT ALL ON public.project_site_logs TO service_role;

ALTER TABLE public.project_site_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project owners manage site logs" ON public.project_site_logs;
CREATE POLICY "Project owners manage site logs"
  ON public.project_site_logs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_site_logs.project_id
        AND p.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_site_logs.project_id
        AND p.created_by = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_project_site_logs_project
  ON public.project_site_logs(project_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_project_site_log_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_project_site_log ON public.project_site_logs;
CREATE TRIGGER trg_touch_project_site_log
  BEFORE UPDATE ON public.project_site_logs
  FOR EACH ROW EXECUTE FUNCTION public.touch_project_site_log_updated_at();
