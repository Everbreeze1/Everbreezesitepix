-- Round two of the dash backfill: the columns the first pass missed.
--
-- 20260901000000 folded six columns and was applied. Re-reading the same live
-- portfolio afterwards still turned up three:
--
--   799 A Street <em dash> Site visit
--   8103 Polo Crosse Avenue <em dash> Site visit
--
-- sitting in `showcase_sections.title`. The first audit only scanned
-- `apps/api/src` for pre-sweep templates, and that was the mistake: the web app
-- writes to the database too. Re-running the same scan over `apps/web/src` at
-- 5c3cbd4 found the actual source, in the new-project form:
--
--   name: f.name || (parts.street ? `${parts.street} <em dash> Site visit` : f.name),
--
-- So the character was never really in the section title. It is in
-- `projects.name`, auto-generated from the street address, and it has been
-- propagating outward from there ever since - into showcase section titles when
-- a showcase is generated, and into every report cover, page header and PDF
-- that prints a project name. Folding the leaves without the root would have
-- left it to grow back on the next generated showcase.
--
-- ---------------------------------------------------------------------------
-- SCOPE
-- ---------------------------------------------------------------------------
-- Each traced to a pre-sweep template at 5c3cbd4, as before:
--
--   projects.name             web NewProjectPage.tsx:188,375  "{street} - Site visit"
--   showcase_sections.title   copied from projects.name at generation
--   showcases.title           copied from projects.name at generation
--   project_site_logs.title   web ProjectSiteLogs.tsx:246     "{project} - {date}"
--                             web ApplyTemplateDialog.tsx:132 "{template} - {date}"
--
-- Deliberately excluded after checking each one: aria-labels, tooltips, toasts,
-- confirm dialogs, an email subject and a print-window title. They render and
-- vanish, they are already fixed in source, and none of them is stored.
--
-- `showcase_sections.body_html` is excluded because the generated bodies are
-- fixed strings ("<p>Where we started.</p>") that never contained a dash.
--
-- ---------------------------------------------------------------------------
-- NOTES
-- ---------------------------------------------------------------------------
-- Same rules as round one: chr() rather than literals, translate() 1:1 onto
-- '-', one guarded UPDATE per column, idempotent, safe to re-run.
--
-- `projects` is guarded with to_regclass for the same reason `walkthroughs` was
-- - it predates the tracked migrations and no file in this directory creates
-- it, so a freshly provisioned database can legitimately not have it yet.
--
-- Apply via the Everlumen Supabase SQL editor. Safe to re-run.

SET lock_timeout = '5s';

DO $$
DECLARE
  -- en dash, em dash, horizontal bar, two-em dash, three-em dash.
  dashes  text := chr(8211) || chr(8212) || chr(8213) || chr(11834) || chr(11835);
  hyphens text := '-----';
  touched int;
  total   int := 0;
BEGIN
  -- The root. Everything below this is a copy taken from it.
  IF to_regclass('public.projects') IS NOT NULL THEN
    UPDATE public.projects
       SET name = translate(name, dashes, hyphens)
     WHERE name IS NOT NULL
       AND name <> translate(name, dashes, hyphens);
    GET DIAGNOSTICS touched = ROW_COUNT;
    RAISE NOTICE 'projects.name: % row(s)', touched;
    total := total + touched;
  ELSE
    RAISE NOTICE 'projects: table absent, skipped';
  END IF;

  UPDATE public.showcase_sections
     SET title = translate(title, dashes, hyphens)
   WHERE title IS NOT NULL
     AND title <> translate(title, dashes, hyphens);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'showcase_sections.title: % row(s)', touched;
  total := total + touched;

  UPDATE public.showcases
     SET title = translate(title, dashes, hyphens)
   WHERE title IS NOT NULL
     AND title <> translate(title, dashes, hyphens);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'showcases.title: % row(s)', touched;
  total := total + touched;

  UPDATE public.project_site_logs
     SET title = translate(title, dashes, hyphens)
   WHERE title <> translate(title, dashes, hyphens);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'project_site_logs.title: % row(s)', touched;
  total := total + touched;

  RAISE NOTICE 'total rows folded: %', total;
END $$;
