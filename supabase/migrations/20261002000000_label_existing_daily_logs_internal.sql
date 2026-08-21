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

-- =========================================================================
-- 0. QUIET THE updated_at TRIGGER
-- =========================================================================
-- `trg_project_pages_updated_at` stamps `updated_at = now()` on any UPDATE, and
-- the Capture-flow card prints that value as "edited N minutes ago". Left alone,
-- this migration would tell a technician that every daily log they have ever
-- written was touched today. When a log was last worked on is real information;
-- adding a label to it is not an edit to it.
--
-- Same treatment, and the same reasoning, as
-- 20260907000000_project_page_titles_name_their_project.sql. Disabled rather
-- than dropped, and restored in section 3. `ALTER TABLE ... DISABLE TRIGGER` is
-- transactional and a migration runs as one transaction, so a failure anywhere
-- below rolls the disable back with everything else. There is no state in which
-- this leaves the trigger off.
--
-- `project_pages_updated_attribution` is deliberately left alone: it only writes
-- `updated_by` when `auth.uid()` is non-null, and in the SQL editor it is null,
-- so it will not credit this migration to whoever runs it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.project_pages'::regclass
                AND tgname = 'trg_project_pages_updated_at') THEN
    ALTER TABLE public.project_pages DISABLE TRIGGER trg_project_pages_updated_at;
  END IF;
END $$;

-- =========================================================================
-- 1. PAGES WHOSE MASTHEAD IS ALREADY AN InfoPanel
-- =========================================================================
-- The notice becomes another labelled row inside the panel it belongs in,
-- rather than a second shaded block stacked on the first. `.*?` is non-greedy
-- so the match ends at the panel's own closing tag; these panels contain only
-- <p> elements, never a nested <div>, so there is no inner tag to stop short at.
UPDATE public.project_pages
SET content_html = regexp_replace(
      content_html,
      '(<div data-panel="meta">.*?)</div>',
      '\1<p><span class="panel-label">Visibility</span>Internal only - not shared with clients</p></div>'
    )
WHERE source_template = 'daily_log'
  AND content_html LIKE '%<div data-panel="meta">%'
  AND content_html NOT LIKE '%Internal only - not shared with clients%';

-- =========================================================================
-- 2. EVERYTHING OLDER THAN THE InfoPanel
-- =========================================================================
-- These open with a plain paragraph masthead ("<strong>Project Name:</strong>…"
-- or a single dim run-on line), which offers no reliable seam to insert into.
-- They get the notice as its own panel above the body instead - the same block
-- the current generator opens a new log with.
UPDATE public.project_pages
SET content_html =
      '<div data-panel="meta"><p><span class="panel-label">Daily Log</span>Internal only - not shared with clients</p></div>'
      || COALESCE(content_html, '')
WHERE source_template = 'daily_log'
  AND content_html NOT LIKE '%<div data-panel="meta">%'
  AND content_html NOT LIKE '%Internal only - not shared with clients%';

-- =========================================================================
-- 3. RESTORE THE TRIGGER
-- =========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.project_pages'::regclass
                AND tgname = 'trg_project_pages_updated_at') THEN
    ALTER TABLE public.project_pages ENABLE TRIGGER trg_project_pages_updated_at;
  END IF;
END $$;
