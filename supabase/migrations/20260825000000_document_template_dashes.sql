-- Fold the long dashes out of stored document templates.
--
-- 20260822000000_normalize_machine_dashes.sql did this for the tables that hold
-- model-written prose, `project_pages` included. It could not do it for
-- `document_templates`, because a template keeps its text inside a jsonb column
-- (`body -> html`, `body -> description`) rather than in a text column a
-- translate() over a column list can reach.
--
-- So the templates kept theirs. Every one of them came from an older copy of
-- the STYLE_PRESETS in DocumentTemplatesManager.tsx, which wrote
-- `{{project_name}} <dash> Field Report` before the repo-wide sweep replaced
-- that with a hyphen. A team that pressed "New template" or "Load sample site
-- logs" back then has been handing customers documents with one in the title
-- ever since, and re-running the seeds cannot fix it: those rows belong to the
-- team, not to the built-in library.
--
-- The seeded built-ins are already clean, so this touches only a team's own
-- rows in practice. Not touched: `projects.name` and other text a person typed
-- themselves. This applies a house style to text the app generated, and stops
-- short of editing someone's own writing.
--
-- Characters are written as U& escapes so this file itself stays clean.
-- translate() maps character to character, so both argument strings are the
-- same length: en dash, em dash, horizontal bar, two-em bar, three-em bar.
--
-- `jsonb_exists`/`jsonb_typeof` rather than the `?` operator, which some SQL
-- clients read as a bind placeholder.
--
-- Apply manually in the Supabase SQL editor (or `supabase db push`).
-- Filtered to rows that actually contain one, so it is safe to re-run.

DO $$
DECLARE
  dashes   text := U&'\2013\2014\2015\2E3A\2E3B';
  hyphens  text := '-----';
  pattern  text := U&'[\2013\2014\2015\2E3A\2E3B]';
  affected bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'document_templates'
  ) THEN
    RAISE NOTICE 'skipping document_templates (not present)';
    RETURN;
  END IF;

  UPDATE public.document_templates
  SET name = translate(name, dashes, hyphens)
  WHERE name ~ pattern;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE NOTICE 'normalized % template name(s)', affected;
  END IF;

  -- The document itself, plus the one-line summary shown under it in the
  -- picker. Each key is rewritten only when it is present AND a string, so a
  -- template that never had a description does not gain a null one.
  UPDATE public.document_templates
  SET body = body
    || CASE
         WHEN jsonb_typeof(body -> 'html') = 'string'
         THEN jsonb_build_object('html', translate(body ->> 'html', dashes, hyphens))
         ELSE '{}'::jsonb
       END
    || CASE
         WHEN jsonb_typeof(body -> 'description') = 'string'
         THEN jsonb_build_object('description', translate(body ->> 'description', dashes, hyphens))
         ELSE '{}'::jsonb
       END
  WHERE jsonb_typeof(body) = 'object'
    AND (body ->> 'html' ~ pattern OR body ->> 'description' ~ pattern);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected > 0 THEN
    RAISE NOTICE 'normalized % template body/bodies', affected;
  END IF;
END $$;

-- === VERIFY ================================================================
-- Expect zero rows.
--
-- SELECT id, name
--   FROM public.document_templates
--  WHERE name ~ U&'[\2013\2014\2015\2E3A\2E3B]'
--     OR body ->> 'html' ~ U&'[\2013\2014\2015\2E3A\2E3B]'
--     OR body ->> 'description' ~ U&'[\2013\2014\2015\2E3A\2E3B]';
