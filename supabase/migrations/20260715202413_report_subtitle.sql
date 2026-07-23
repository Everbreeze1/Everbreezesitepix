-- Add optional subtitle to project_reports for the simplified cover page.
ALTER TABLE public.project_reports
  ADD COLUMN IF NOT EXISTS subtitle text;
