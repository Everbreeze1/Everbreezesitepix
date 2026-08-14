-- Repair: `issue_reports` stores its text in `description`, not `message`.
--
-- The checked-in generated types (packages/db/src/database.ts) claimed a
-- `message` column. They were wrong. Two consequences, both now fixed here:
--
--   1. 20260803020000 tried `ALTER COLUMN message DROP NOT NULL` and failed
--      with 42703 (column does not exist).
--   2. The re-run of that migration then *created* a nullable `message`
--      column via ADD COLUMN IF NOT EXISTS - so the table ended up with two
--      text columns, and every insert failed with 23502 because the real
--      one, `description`, is NOT NULL and nothing was writing to it.
--
-- This standardises on `description` as the single text column: it is what is
-- actually deployed and what any existing rows are stored in. Anything written
-- to `message` in between is folded across before that column is dropped, so
-- no feedback is lost either way.
--
-- Apply via the SitePix Supabase SQL editor. Safe to re-run.
--
-- RENAMED 20260803040000 -> 20260803040001 (content unchanged). It shared the
-- 040000 stamp with starter_project_sharing.sql, and a version is the key of the
-- CLI's migration history - two files cannot hold the same one. This file is the
-- one that moved because it repairs 20260803020000 and therefore has to sort
-- after it, while starter_project_sharing only replaces are_teammates() and is
-- ordered against nothing; it was also written first. Both are already applied
-- in production, so this changes history only - 20260811001000 records the new
-- version as applied so `supabase db push` will not re-run it, and every
-- statement below is idempotent if it does.

-- 1. Guarantee the column exists (fresh environments created by
--    20260803020000 will not have it).
ALTER TABLE public.issue_reports
  ADD COLUMN IF NOT EXISTS description text;

-- 2. A one-tap thumbs signal carries no text, so the text column has to be
--    nullable. This is the constraint that was rejecting inserts.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'issue_reports'
      AND column_name  = 'description'
      AND is_nullable  = 'NO'
  ) THEN
    ALTER TABLE public.issue_reports ALTER COLUMN description DROP NOT NULL;
  END IF;
END $$;

-- 3. Fold any `message` data into `description`, then remove the duplicate so
--    there is exactly one text column and no ambiguity about which one is
--    authoritative.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'issue_reports'
      AND column_name  = 'message'
  ) THEN
    UPDATE public.issue_reports
       SET description = message
     WHERE message IS NOT NULL
       AND message <> ''
       AND (description IS NULL OR description = '');

    ALTER TABLE public.issue_reports DROP COLUMN message;
  END IF;
END $$;
