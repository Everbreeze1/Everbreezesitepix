-- A walkthrough row now records HOW it came to exist.
--
-- Two different things produce a `walkthroughs` row and they are not the same
-- object:
--
--   1. RECORDED - the technician walked the site. Video, narration, transcript,
--      a real duration, and photos captured at offsets *inside* the recording.
--   2. SUMMARY  - the AI wrote a short recap from photos the user picked out of
--      the gallery. No video, no audio, no transcript, duration 0. The photos
--      are pre-existing gallery photos that are LINKED, not captured.
--
-- "video_path IS NULL" cannot tell them apart, which is why this column exists
-- rather than a derived check. A recorded walkthrough whose upload failed is
-- video-less too - that is the entire point of the pending-video recovery flow
-- in ProjectDetailPage - and so are the rows fabricated by
-- recoverOrphanWalkthroughPhotosForProject. Every UI branch that hides the play
-- button, the duration, or the narration column needs a fact, not a guess.
--
-- NOTE FOR WHOEVER READS THIS NEXT: `public.walkthroughs` has no CREATE TABLE in
-- this folder - it predates the migrations directory (see the comment at
-- 20260811000000_lock_down_anon_reads.sql:64-66). This file is ALTER-only by
-- necessity. The column list of record is packages/db/src/database.ts.
--
-- RLS: no policy change. "Teammates manage team walkthroughs"
-- (20260811000000:164-176) is FOR ALL gated on project_id / created_by, and a
-- new column inherits it. Grants are restated below only so this file is
-- self-sufficient against a database that somehow missed 20260811000000.
--
-- Apply via the Everlumen Supabase SQL editor. Idempotent - safe to re-run.

SET lock_timeout = '5s';

-- === PART 1 - the discriminator ============================================
-- ADD COLUMN ... NOT NULL DEFAULT is metadata-only on PG11+, so no table
-- rewrite and no long lock even on a large walkthroughs table.
ALTER TABLE public.walkthroughs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'recorded';

-- Repair path: if a hand-run already added the column nullable or without a
-- default, the ADD COLUMN above is a no-op and these three statements fix it.
UPDATE public.walkthroughs SET source = 'recorded' WHERE source IS NULL;

ALTER TABLE public.walkthroughs ALTER COLUMN source SET DEFAULT 'recorded';
ALTER TABLE public.walkthroughs ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'walkthroughs_source_check'
  ) THEN
    ALTER TABLE public.walkthroughs
      ADD CONSTRAINT walkthroughs_source_check
      CHECK (source IN ('recorded', 'summary'));
  END IF;
END $$;

-- === PART 2 - indexes ======================================================
-- Four call sites already upsert walkthrough_photos with
-- onConflict: "walkthrough_id,photo_id", which raises Postgres 42P10 unless a
-- unique index backs that pair. It is presumably present from the pre-migration
-- schema, but it is not provable from this repo, and the summary linker is a
-- fifth caller - so state it here rather than inherit the assumption.
CREATE UNIQUE INDEX IF NOT EXISTS walkthrough_photos_unique_link_idx
  ON public.walkthrough_photos(walkthrough_id, photo_id);

-- listProjectWalkthroughsService reads (project_id) ORDER BY created_at DESC on
-- every project load, and walkthrough_photos is read by walkthrough_id on every
-- list and detail load. Neither index is declared anywhere in this folder.
CREATE INDEX IF NOT EXISTS walkthroughs_project_created_idx
  ON public.walkthroughs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS walkthrough_photos_walkthrough_position_idx
  ON public.walkthrough_photos(walkthrough_id, "position");

-- === PART 3 - grants (restated, unchanged from 20260811000000) =============
REVOKE ALL ON public.walkthroughs       FROM anon, PUBLIC;
REVOKE ALL ON public.walkthrough_photos FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walkthroughs       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walkthrough_photos TO authenticated;
GRANT ALL ON public.walkthroughs       TO service_role;
GRANT ALL ON public.walkthrough_photos TO service_role;

-- === VERIFY ================================================================
-- Expect: source text NOT NULL default 'recorded', one CHECK constraint naming
-- ('recorded','summary'), and every pre-existing row reading 'recorded'.
SELECT column_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name = 'walkthroughs'
   AND column_name = 'source';

SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.walkthroughs'::regclass AND contype = 'c';

SELECT source, count(*) FROM public.walkthroughs GROUP BY source;
