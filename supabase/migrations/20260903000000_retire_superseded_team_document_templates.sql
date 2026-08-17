-- Retire the team-owned document templates the built-in library superseded.
--
-- The client, looking at Templates > Documents:
--
--   "Some of the recent ones you have made look nice and editable but some of
--    the other ones with garbage can are terrible. I think you are updating
--    those ones with new ones without a garbage can?"
--
-- They are reading the page correctly. A built-in has `team_id IS NULL`, which
-- RLS makes read-only, so its card carries no Edit and no delete. A team's own
-- row carries both, and the delete is the garbage can they mean. So "has a
-- garbage can" is an exact proxy for "this row belongs to the team", and on the
-- live database every one of those rows is an untouched copy of a preset from
-- before the library was rebuilt:
--
--   123                        the old "report" preset, verbatim
--   Detailed walkthrough log   the old "sitelog_walkthrough" preset, verbatim
--   HVAC / construction log    the old "sitelog_hvac" preset, verbatim
--
-- 1.6 KB of bare headings and bullet lists each, sitting in the same grid as a
-- 30-template library of 5 to 11 KB documents with cover lines, key/value
-- tables, tap-to-fill photo slots and sign-off blocks. Their second half of the
-- guess is right too: 20260820, 20260824, 20260827 and 20260830 each seeded
-- better documents as new built-in rows, and none of them could reach a row a
-- team owns. The old copies were left behind to be compared against the new
-- ones, which is the comparison the client just made.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES
-- ---------------------------------------------------------------------------
-- Archives - never deletes - a team row whose body is still byte-identical to
-- a preset body this project has shipped. Byte-identical means nobody has
-- edited it, so nothing anyone wrote is being touched. Archiving takes the card
-- off the page (the manager filters `archived = false` by default) while
-- leaving "Show archived" > Restore as a one-click undo, which a DELETE would
-- not.
--
-- Identity is an md5 of the stored `body ->> 'html'`. The first version of this
-- file inlined all eighteen bodies as dollar-quoted literals and compared them
-- whole: 18 KB of HTML, every byte of which had to survive being pasted into a
-- SQL editor for the match to hold. It reported nothing archived on a database
-- where the rows demonstrably did match, so the bodies are gone and their
-- fingerprints are here instead. A hash comparison is exactly as strict - an
-- md5 match is a byte match - and 32 hex characters cannot be mangled in
-- transit the way a kilobyte of markup with entities, middle dots and an
-- ellipsis in it can.
--
-- Both preset generations are listed, the pre-20260824 filler bodies and the
-- bracket-blank bodies that replaced them, because a team could hold either:
--
--   * the sample-site-logs button wrote three copies, and is removed in the
--     same change as this file - the library covers all three better;
--   * "New template" wrote one, from whichever style was picked;
--   * "Duplicate to edit" on a built-in, before the library was rebuilt.
--
-- Superseded by, for anyone reading an archived row later:
--
--   report / sitelog_basic     ->  Site Visit Report, Daily Site Report
--   sitelog_walkthrough        ->  Site Visit Report, Photo Log
--   sitelog_hvac               ->  HVAC Service Call Report
--
-- ---------------------------------------------------------------------------
-- NOTES
-- ---------------------------------------------------------------------------
-- Guarded with to_regclass, idempotent, safe to re-run: a row this already
-- archived no longer matches `archived = false`.
--
-- Only the body is looked at. Name, trade and description are ignored, so a
-- preset copy renamed "Our daily log" is still recognised as the untouched
-- preset it is - and a document someone has edited by one character no longer
-- hashes to a preset and is left alone.
--
-- Every row it archives is named in a NOTICE, and if it archives nothing it
-- prints the fingerprint of each team row that is still on the page, so a run
-- that does nothing says why rather than just saying zero.
--
-- Apply via the SitePix Supabase SQL editor (or `supabase db push`).

SET lock_timeout = '5s';

DO $$
DECLARE
  /*
   * md5(body ->> 'html') for every preset body this project has shipped.
   *
   * Generated from the preset bodies themselves and checked against the live
   * table: the eighteen are distinct from each other, three of them match the
   * team rows on this database, and none of them matches any of the thirty
   * built-ins. Regenerate with, for any candidate body:
   *
   *   SELECT md5(body ->> 'html') FROM public.document_templates WHERE id = ...
   */
  presets constant text[] := ARRAY[
    -- generation 1: the filler-prose presets, pre-20260824
    '48efc36e5d2896ba62ed20c3b271ea0a',  -- report
    'c0a98e4db6286b6669baac2d34afa585',  -- letter
    '268a84bfe0fcc84942e16282b6a54271',  -- checklist
    'c99022ebdcefb80c418bee4f3ff710d3',  -- memo
    '1b75d58ebaeec1eee39f0c0e6657162a',  -- walkthrough
    '90416f186241d81685951cb640d90967',  -- sitelog
    '547b9676b0bfcd14a0747dde73a77833',  -- sitelog_basic
    'bb33965f50e79ee35548c915deed7ec5',  -- sitelog_walkthrough
    '856fbeb900f1c22340dc0baff77d8b00',  -- sitelog_hvac
    -- generation 2: the bracket-blank presets, 20260824 to 20260902. Better
    -- than generation 1, still a plain heading-and-bullet document next to the
    -- library, so an untouched copy is retired on the same terms.
    '9ef508abda6dba7f1c74ea479480296d',  -- report
    'f38d05745a498fd1ceb9ae380080a8ea',  -- letter
    '2d8ba13aee2e8916ac7ba8b5f2594359',  -- checklist
    '567a04958a8b5da1128f72e96c8695a7',  -- memo
    '341b4364653983daa2de189214587f9d',  -- walkthrough
    '97d0bd39a9e9d19ab1e25efbfccf5aee',  -- sitelog
    'f535e59edcfac61d85d56aedd47dd6c5',  -- sitelog_basic
    'e3afef2bd2171661f5fb555d00598fed',  -- sitelog_walkthrough
    'da26f53fa768be5145fd8c424caca3ca'   -- sitelog_hvac
  ];
  doomed record;
  total  int := 0;
BEGIN
  IF to_regclass('public.document_templates') IS NULL THEN
    RAISE NOTICE 'document_templates: table absent, skipped';
    RETURN;
  END IF;

  FOR doomed IN
    UPDATE public.document_templates
       SET archived = true
     WHERE team_id IS NOT NULL
       AND archived = false
       AND jsonb_typeof(body -> 'html') = 'string'
       AND md5(body ->> 'html') = ANY (presets)
    RETURNING name, md5(body ->> 'html') AS fingerprint
  LOOP
    RAISE NOTICE 'archived "%" (%)', doomed.name, doomed.fingerprint;
    total := total + 1;
  END LOOP;

  RAISE NOTICE 'archived % untouched preset cop(y/ies)', total;

  -- Nothing matched. Either it has already run, or these bodies are not the
  -- ones this file knows about - so print them rather than leaving a bare zero.
  IF total = 0 THEN
    FOR doomed IN
      SELECT name, md5(body ->> 'html') AS fingerprint, length(body ->> 'html') AS bytes
        FROM public.document_templates
       WHERE team_id IS NOT NULL
         AND archived = false
       ORDER BY name
    LOOP
      RAISE NOTICE 'still on the page: "%" % (% bytes)',
        doomed.name, doomed.fingerprint, doomed.bytes;
    END LOOP;
  END IF;
END $$;

-- === VERIFY ================================================================
-- Every team template still on the page. Expect only documents the team wrote
-- or edited themselves, which this file deliberately leaves alone.
--
-- SELECT id, name, body ->> 'style' AS style, length(body ->> 'html') AS bytes
--   FROM public.document_templates
--  WHERE team_id IS NOT NULL
--    AND archived = false
--  ORDER BY updated_at DESC;
--
-- And what this archived, should anyone want it back (or Restore it from the
-- card, under "Show archived"):
--
-- SELECT id, name FROM public.document_templates
--  WHERE team_id IS NOT NULL AND archived = true;
