-- Report Builder refinements - run against the Everlumen Supabase project.
-- Adds photos_per_page (1..4) so users can control the PDF layout density.

ALTER TABLE public.project_reports
  ADD COLUMN IF NOT EXISTS photos_per_page integer NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_reports_photos_per_page_check'
  ) THEN
    ALTER TABLE public.project_reports
      ADD CONSTRAINT project_reports_photos_per_page_check
      CHECK (photos_per_page BETWEEN 1 AND 4);
  END IF;
END $$;
