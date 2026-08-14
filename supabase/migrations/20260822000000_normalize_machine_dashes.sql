-- Fold the long dashes out of text a language model wrote.
--
-- CLAUDE.md bans them from every tracked file and tests/no-em-dash.test.ts
-- enforces it, but neither reaches a string an LLM produced at runtime. The
-- Auto Report stores the model's title, subtitle and prose verbatim, so report
-- titles came back carrying one and were written straight to these tables. The
-- code path is fixed (packages/shared/src/machine-dashes.ts, applied at every
-- point model output is accepted); this cleans what was stored before that.
--
-- Not touched, deliberately:
--   * walkthroughs.transcript  - a transcription of speech, not our prose.
--   * ai_analyses.ocr_text     - text copied off a label or sign in a photo.
-- Rewriting either would be editing evidence rather than applying a style.
--
-- The characters are written as U& escapes so this file itself stays clean.
-- translate() maps character to character, so the two argument strings are the
-- same length: en dash, em dash, horizontal bar, two-em bar, three-em bar.
--
-- Idempotent, and each statement is filtered so it only rewrites rows that
-- actually contain one. Safe to re-run.

DO $$
DECLARE
  dashes   text := U&'\2013\2014\2015\2E3A\2E3B';
  hyphens  text := '-----';
  pattern  text := U&'[\2013\2014\2015\2E3A\2E3B]';
  target   record;
  affected bigint;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('project_reports',         'title'),
      ('project_reports',         'subtitle'),
      ('project_reports',         'summary'),
      ('project_report_sections', 'title'),
      ('project_report_sections', 'body'),
      ('project_pages',           'title'),
      ('project_pages',           'content_html'),
      ('walkthroughs',            'title'),
      ('walkthroughs',            'summary_markdown')
    ) AS t(tbl, col)
  LOOP
    -- Skip anything this database does not have yet: migrations and code do
    -- not deploy atomically here, and a missing column must not abort the run.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = target.tbl
        AND column_name = target.col
    ) THEN
      RAISE NOTICE 'skipping %.% (not present)', target.tbl, target.col;
      CONTINUE;
    END IF;

    EXECUTE format(
      'UPDATE public.%I SET %I = translate(%I, $1, $2) WHERE %I ~ $3',
      target.tbl, target.col, target.col, target.col
    ) USING dashes, hyphens, pattern;

    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected > 0 THEN
      RAISE NOTICE 'normalized % row(s) in %.%', affected, target.tbl, target.col;
    END IF;
  END LOOP;
END $$;
