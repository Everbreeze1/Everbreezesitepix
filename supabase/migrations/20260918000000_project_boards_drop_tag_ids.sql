-- THE HARD BLOCK: A TAG CAN NO LONGER BE A STAGE.
--
-- 20260917000000_pipeline_stages.sql moved every board's columns into
-- public.pipeline_stages and gave every project that was on a board its single
-- pipeline_stage_id. It left project_boards.tag_ids in place on purpose, so the
-- front end that was deployed at the time kept loading while the new build
-- rolled out.
--
-- This removes it. After this runs there is no path, in the UI or in SQL, by
-- which a tag becomes a pipeline column: the column that used to hold that
-- relationship does not exist. Tags stay exactly as they are for filtering and
-- search everywhere else in the app.
--
-- APPLY ONLY AFTER the build carrying the pipeline_stages front end is live.
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent: safe to re-run.

-- Refuse to run early. If a board still has no stages then step 3 of the
-- previous migration has not happened for it, and dropping tag_ids here would
-- lose the only record of what its columns were.
DO $$
DECLARE
  orphans integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_boards' AND column_name = 'tag_ids'
  ) THEN
    RAISE NOTICE 'project_boards.tag_ids is already gone. Nothing to do.';
    RETURN;
  END IF;

  SELECT count(*) INTO orphans
  FROM public.project_boards b
  WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_stages ps WHERE ps.board_id = b.id);

  IF orphans > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop project_boards.tag_ids: % board(s) still have no rows in pipeline_stages. Run 20260917000000_pipeline_stages.sql first.',
      orphans;
  END IF;

  ALTER TABLE public.project_boards DROP COLUMN tag_ids;
END $$;
