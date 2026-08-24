-- Fold the long dashes out of text this app generated before the sweep.
--
-- CLAUDE.md bans em dash and friends from every tracked file, and
-- `tests/no-em-dash.test.ts` keeps source honest. But the sweep only ever
-- reached the repo. Rows that our own generators had already written kept the
-- character, and several of those columns render on public marketing pages.
--
-- Found the obvious way: looking at a client's live portfolio and seeing
--
--   Davita Antioch - 3102 Delta Fair Boulevard, Antioch, CA
--   Sacramento Airport <em dash> 6900 Airport Boulevard, Sacramento, CA
--
-- Two rows from the identical template, separated only by which side of the
-- sweep they were created on. `apps/api/src/domains/showcases/service.ts` at
-- commit 5c3cbd4 read:
--
--   summary: address ? `${project.name} <em dash> ${address}` : null,
--
-- and at dc2b762 it became a hyphen. The code was fixed; the data never was.
--
-- ---------------------------------------------------------------------------
-- SCOPE
-- ---------------------------------------------------------------------------
-- Only columns a pre-sweep template in this repo wrote into. Each one is
-- traced to the generator that produced it, at 5c3cbd4:
--
--   showcases.summary            showcases/service.ts:496   "{name} - {address}"
--   project_pages.title          projects/pages.ts:418      "{name} - Summary"
--   project_pages.content_html   projects/pages.ts:418      "<h1>{name} - Summary</h1>"
--   project_reports.title        walkthroughs/service.ts:439
--   project_reports.subtitle     walkthroughs/service.ts:440
--   walkthroughs.title           walkthroughs/service.ts:284 "Recovered Walkthrough - {date}"
--
-- Model-written text is deliberately NOT listed. It is already folded at the
-- write boundary by `normalizeDashes` (packages/shared/src/machine-dashes.ts),
-- so anything the AI produced since that landed is clean, and anything older
-- lands in these same columns and is covered here anyway.
--
-- This does fold a long dash a person typed by hand into one of these fields.
-- That is intended rather than tolerated: it is exactly what normalizeDashes
-- already does to every AI-written title, and the product's position is that
-- the character never appears in front of a customer.
--
-- ---------------------------------------------------------------------------
-- NOTES
-- ---------------------------------------------------------------------------
-- The characters are spelled with chr() rather than typed. CLAUDE.md's one
-- exception is *matching* a long dash rather than emitting one, and a literal
-- here would put the character back into the repo the file exists to remove -
-- and trip the PreToolUse hook and no-em-dash.test.ts on the way in.
--
-- The set matches MACHINE_DASHES exactly: en dash, em dash, horizontal bar and
-- the two long bars. translate() maps them 1:1 onto '-'.
--
-- Every statement is guarded by a WHERE that matches only affected rows, so
-- this is idempotent and a re-run touches nothing. showcases and project_pages
-- carry updated_at triggers, so affected rows get a fresh timestamp; that is
-- correct (the text did change) and moves sitemap lastmod with it.
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
  UPDATE public.showcases
     SET summary = translate(summary, dashes, hyphens)
   WHERE summary IS NOT NULL
     AND summary <> translate(summary, dashes, hyphens);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'showcases.summary: % row(s)', touched;
  total := total + touched;

  UPDATE public.project_pages
     SET title = translate(title, dashes, hyphens)
   WHERE title <> translate(title, dashes, hyphens);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'project_pages.title: % row(s)', touched;
  total := total + touched;

  UPDATE public.project_pages
     SET content_html = translate(content_html, dashes, hyphens)
   WHERE content_html <> translate(content_html, dashes, hyphens);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'project_pages.content_html: % row(s)', touched;
  total := total + touched;

  UPDATE public.project_reports
     SET title = translate(title, dashes, hyphens)
   WHERE title IS NOT NULL
     AND title <> translate(title, dashes, hyphens);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'project_reports.title: % row(s)', touched;
  total := total + touched;

  UPDATE public.project_reports
     SET subtitle = translate(subtitle, dashes, hyphens)
   WHERE subtitle IS NOT NULL
     AND subtitle <> translate(subtitle, dashes, hyphens);
  GET DIAGNOSTICS touched = ROW_COUNT;
  RAISE NOTICE 'project_reports.subtitle: % row(s)', touched;
  total := total + touched;

  -- Guarded, unlike the rest: `walkthroughs` predates the tracked migrations
  -- and is not created by any file in this directory, so it is the one table
  -- here that a freshly provisioned database can legitimately be missing.
  -- Without the check its absence would abort the whole block and roll back
  -- the five updates above it.
  IF to_regclass('public.walkthroughs') IS NOT NULL THEN
    UPDATE public.walkthroughs
       SET title = translate(title, dashes, hyphens)
     WHERE title IS NOT NULL
       AND title <> translate(title, dashes, hyphens);
    GET DIAGNOSTICS touched = ROW_COUNT;
    RAISE NOTICE 'walkthroughs.title: % row(s)', touched;
    total := total + touched;
  ELSE
    RAISE NOTICE 'walkthroughs: table absent, skipped';
  END IF;

  RAISE NOTICE 'total rows folded: %', total;
END $$;
