-- Author-level default for report page density.
--
-- `project_reports.photos_per_page` has been settable per report since
-- 20260621051943, but the Auto Report built at the end of a walkthrough runs
-- unattended - there is no dialog to ask in, so it hardcoded 2 and every
-- generated report came out at that density regardless of what the author
-- actually wanted. This is the value it reads instead.
--
-- Also seeds the New Report dialog and the manual builder, so a company that
-- always files four-up does not reset the control on every report.
--
-- Safe to re-run.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS report_photos_per_page smallint NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_report_photos_per_page_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_report_photos_per_page_check
      CHECK (report_photos_per_page BETWEEN 1 AND 4);
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.report_photos_per_page IS
  'Default photos per PDF page for reports this user creates or generates (1-4).';
