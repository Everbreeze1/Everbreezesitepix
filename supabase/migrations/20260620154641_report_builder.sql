-- Report Builder MVP — run this against the SitePix Supabase project.
-- Adds cover-page toggles to project_reports and a sections table.

-- ---------------------------------------------------------------------------
-- 1. Cover toggles on existing project_reports
-- ---------------------------------------------------------------------------
ALTER TABLE public.project_reports
  ADD COLUMN IF NOT EXISTS cover_enabled            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cover_show_project_name  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cover_show_address       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cover_show_date          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cover_show_author        boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. Sections table
--    Each section has a title, rich-text body, and an ordered photos array:
--      photos = [{ "photo_id": "<uuid>", "caption": "..." }, ...]
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_report_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES public.project_reports(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0,
  title       text NOT NULL DEFAULT '',
  body        text,
  photos      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_report_sections TO authenticated;
GRANT ALL ON public.project_report_sections TO service_role;

ALTER TABLE public.project_report_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage report sections" ON public.project_report_sections;
CREATE POLICY "Owners manage report sections"
  ON public.project_report_sections
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_reports r
      WHERE r.id = project_report_sections.report_id
        AND r.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_reports r
      WHERE r.id = project_report_sections.report_id
        AND r.created_by = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_report_sections_report
  ON public.project_report_sections(report_id, position);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_report_section_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_report_section ON public.project_report_sections;
CREATE TRIGGER trg_touch_report_section
  BEFORE UPDATE ON public.project_report_sections
  FOR EACH ROW EXECUTE FUNCTION public.touch_report_section_updated_at();
