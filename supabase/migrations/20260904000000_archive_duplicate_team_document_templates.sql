-- Collapse the identical copies a team's own library accumulated.
--
-- The client, on Templates > Documents: "There is massive duplication."
--
-- 20260903000000 took the bulk of it - sixteen rows that were untouched copies
-- of a shipped preset. What it could not reach is a copy of a document the team
-- wrote themselves, because those match no preset fingerprint. Four such cards
-- were left, and they are two documents:
--
--   HVAC Service Call Report (copy)              8ee31029...
--   HVAC Service Call Report (copy) (copy)       8ee31029...  <- same body
--
--   Template July 31st Tire Buster Auto Report          fb969f0f...
--   Template July 31st Tire Buster Auto Report (copy)   fb969f0f...  <- same body
--
-- The Tire Buster pair was created twenty-four seconds apart, which is a
-- Duplicate click rather than a decision. The "(copy) (copy)" is the same
-- button applied to its own output: it appended " (copy)" unconditionally, so
-- the suffix stacked and nothing on the card said the two held the same
-- document. That is fixed in the same change as this file - apps/web/src/lib/
-- duplicate-name.ts numbers copies instead, and the card now carries a
-- "Same as ..." badge when two bodies match - so this is a one-time cleanup of
-- what the old behaviour left behind, not a recurring sweep.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES
-- ---------------------------------------------------------------------------
-- Within one team, where two or more rows hold a byte-identical body, keeps the
-- oldest and archives the rest.
--
-- Archives, never deletes, exactly as 20260903000000 does: the card leaves the
-- page (the manager filters `archived = false` by default) and "Show archived"
-- > Restore puts it back in one click. Nothing a DELETE could offer.
--
-- Oldest wins because it is the row the copies were made FROM, so it is the one
-- any muscle memory, and any half-finished sentence about "the Tire Buster
-- template", already refers to. Ties on `created_at` break on `id` so the
-- choice is deterministic on a re-run rather than left to the planner.
--
-- Partitioned by `team_id` as well as by body: two teams holding the same
-- document is not duplication, it is two teams. `team_id IS NOT NULL` keeps the
-- built-in library out of it entirely - those rows are shared by every team and
-- are not anyone's to archive.
--
-- ---------------------------------------------------------------------------
-- WHAT IT LEAVES ALONE
-- ---------------------------------------------------------------------------
-- Anything edited by even one character, since the body no longer matches. On
-- this database that is the other four cards, each a distinct document:
--
--   New Site Log Template from Docs Creator, CLEANING SERVICES - Invoice With
--   Photos (copy), New Reports Template, Weekly Crew Timesheet (copy)
--
-- Two of those carry "(copy)" in the name and are kept regardless, because the
-- name is not the test - the body is. A copy someone renamed and rewrote is
-- their document.
--
-- Pages already created from an archived template are untouched: `project_pages`
-- stores its own `content_html` at creation time and only keeps the template id
-- as provenance, so archiving cannot reach back into a document already filed
-- on a job.
--
-- ---------------------------------------------------------------------------
-- NOTES
-- ---------------------------------------------------------------------------
-- Guarded with to_regclass, idempotent, safe to re-run: once the duplicates are
-- archived they no longer match `archived = false`, so a second run reports
-- zero. Names every row it archives, and what it kept in its place.
--
-- Apply via the Everlumen Supabase SQL editor (or `supabase db push`).

SET lock_timeout = '5s';

DO $$
DECLARE
  doomed record;
  total  int := 0;
BEGIN
  IF to_regclass('public.document_templates') IS NULL THEN
    RAISE NOTICE 'document_templates: table absent, skipped';
    RETURN;
  END IF;

  FOR doomed IN
    WITH ranked AS (
      SELECT id,
             name,
             md5(body ->> 'html') AS fingerprint,
             first_value(name) OVER w AS keeper,
             row_number()       OVER w AS copy_rank
        FROM public.document_templates
       WHERE team_id IS NOT NULL
         AND archived = false
         AND jsonb_typeof(body -> 'html') = 'string'
         -- An empty body is not a document, and two of them are not a
         -- duplicate pair - they are two blank templates someone is part way
         -- through writing.
         AND length(body ->> 'html') > 0
      WINDOW w AS (
        PARTITION BY team_id, md5(body ->> 'html')
            ORDER BY created_at, id
      )
    )
    UPDATE public.document_templates t
       SET archived = true
      FROM ranked r
     WHERE t.id = r.id
       AND r.copy_rank > 1
    RETURNING r.name, r.keeper, r.fingerprint
  LOOP
    RAISE NOTICE 'archived "%" - same body as "%" (%)',
      doomed.name, doomed.keeper, doomed.fingerprint;
    total := total + 1;
  END LOOP;

  RAISE NOTICE 'archived % duplicate cop(y/ies)', total;
END $$;

-- === VERIFY ================================================================
-- Should return no rows: no team has two visible cards holding one document.
--
-- SELECT team_id, md5(body ->> 'html') AS fingerprint, count(*),
--        string_agg(name, ' | ' ORDER BY created_at)
--   FROM public.document_templates
--  WHERE team_id IS NOT NULL AND archived = false
--    AND jsonb_typeof(body -> 'html') = 'string'
--    AND length(body ->> 'html') > 0
--  GROUP BY team_id, md5(body ->> 'html')
-- HAVING count(*) > 1;
--
-- And what this archived, should anyone want it back (or Restore it from the
-- card, under "Show archived"):
--
-- SELECT id, name FROM public.document_templates
--  WHERE team_id IS NOT NULL AND archived = true;
