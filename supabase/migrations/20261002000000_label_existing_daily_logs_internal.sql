-- Label the daily logs that existed before the label did.
--
-- The requirement was that a Daily Log say "Internal only - not shared with
-- clients" wherever it appears. Three of the four places are code and were
-- fixed there: the Capture-flow card, the editor banner, and the body of every
-- log the automatic generator writes from now on (see
-- apps/api/src/domains/projects/daily-log.ts).
--
-- The fourth is the bodies already in the table. Those matter more than they
-- look: the on-screen banner is page chrome and does not survive Export PDF, so
-- a legacy log handed to somebody as a file is the one copy with nothing on it
-- saying who it was written for. That is exactly the case the label exists for.
--
-- Idempotent: every statement skips a row that already carries the phrase, so
-- running this twice cannot stack two notices on one page.
--
-- Safe to skip. Nothing in the product depends on it; the cost of not running
-- it is a dozen historical logs that export without the line.
--
-- ---------------------------------------------------------------------------
-- Why the whole thing is one DO block
-- ---------------------------------------------------------------------------
-- `trg_project_pages_updated_at` stamps `updated_at = now()` on any UPDATE, and
-- the Capture-flow card prints that value as "edited N minutes ago". Left alone,
-- this would tell a technician that every daily log they have ever written was
-- touched today. When a log was last worked on is real information; adding a
-- label to it is not an edit to it. So the trigger is disabled across the two
-- writes, exactly as
-- 20260907000000_project_page_titles_name_their_project.sql does.
--
-- Disabling a trigger is the kind of thing that must not survive a failure. If
-- this file is pasted into the SQL editor and each statement commits on its
-- own, a `DISABLE` that succeeded followed by an `UPDATE` that failed would
-- leave the trigger off permanently - and nothing would ever stamp `updated_at`
-- on a project page again, silently, forever. That is a far worse outcome than
-- the cosmetic problem being fixed.
--
-- A single DO block is one statement, so it gets one implicit transaction
-- whether or not anything wrapped it. Either every part of this lands or none
-- of it does, and the trigger cannot be left disabled by a partial run.
--
-- `project_pages_updated_attribution` is deliberately left alone: it only
-- writes `updated_by` when `auth.uid()` is non-null, and in the SQL editor it
-- is null, so it will not credit this migration to whoever runs it.

DO $$
DECLARE
  _notice   constant text := 'Internal only - not shared with clients';
  _has_trg  boolean;
  _panelled integer;
  _plain    integer;
BEGIN
  -- Assigned in the body rather than as a DECLARE default: a plain assignment
  -- is the form there is no doubt about, and this file cannot be rehearsed
  -- against a local Postgres before it is pasted into the SQL editor.
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.project_pages'::regclass
       AND tgname = 'trg_project_pages_updated_at'
  ) INTO _has_trg;

  IF _has_trg THEN
    ALTER TABLE public.project_pages DISABLE TRIGGER trg_project_pages_updated_at;
  END IF;

  -- -------------------------------------------------------------------------
  -- 1. Pages whose masthead is already an InfoPanel.
  -- -------------------------------------------------------------------------
  -- The notice becomes another labelled row inside the panel it belongs in,
  -- rather than a second shaded block stacked on the first. `.*?` is the only
  -- quantifier in the pattern, so the whole expression is non-greedy (Postgres
  -- takes its preference from the first quantifier) and the match ends at the
  -- panel's own closing tag. These panels contain only <p> elements, never a
  -- nested <div>, so there is no inner tag to stop short at. No `g` flag:
  -- exactly the first panel, which is the masthead.
  UPDATE public.project_pages
     SET content_html = regexp_replace(
           content_html,
           '(<div data-panel="meta">.*?)</div>',
           '\1<p><span class="panel-label">Visibility</span>' || _notice || '</p></div>'
         )
   WHERE source_template = 'daily_log'
     AND content_html LIKE '%<div data-panel="meta">%'
     AND content_html NOT LIKE '%' || _notice || '%';
  GET DIAGNOSTICS _panelled = ROW_COUNT;

  -- -------------------------------------------------------------------------
  -- 2. Everything older than the InfoPanel.
  -- -------------------------------------------------------------------------
  -- These open with a plain paragraph masthead ("<strong>Project Name:</strong>"
  -- or a single dim run-on line), which offers no reliable seam to insert into.
  -- They get the notice as its own panel above the body instead - the same
  -- block the current generator opens a new log with.
  UPDATE public.project_pages
     SET content_html =
           '<div data-panel="meta"><p><span class="panel-label">Daily Log</span>'
           || _notice || '</p></div>' || COALESCE(content_html, '')
   WHERE source_template = 'daily_log'
     AND content_html NOT LIKE '%<div data-panel="meta">%'
     AND content_html NOT LIKE '%' || _notice || '%';
  GET DIAGNOSTICS _plain = ROW_COUNT;

  IF _has_trg THEN
    ALTER TABLE public.project_pages ENABLE TRIGGER trg_project_pages_updated_at;
  END IF;

  RAISE NOTICE 'daily logs labelled: % with a meta panel, % without', _panelled, _plain;
END $$;
