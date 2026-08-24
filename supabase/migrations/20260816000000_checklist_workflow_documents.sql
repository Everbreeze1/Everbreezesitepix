-- Checklists and workflows become printable, shareable documents.
--
-- Both already carried the whole record - items, answers, photos, sign-offs -
-- and had nowhere to send it. A checklist could only be read inside the app, in
-- a modal, by its owner. This adds the three columns every other document-shaped
-- thing in Everlumen already has (project_pages, project_reports, walkthroughs):
--
--   share_token  - the public link, issued up front like project_pages does
--   revoked_at   - the owner's switch for that link, defaulting to OFF
--   notes_html   - the rich-text write-up that turns a tick list into a document
--
-- Idempotent. Safe to re-run - including the `revoked_at` backfill, which is
-- guarded so that re-running can never un-share a link an owner turned on.
--
-- RE-RUN THIS if you applied an earlier copy of this file: the first version
-- left `revoked_at` with no default, which made every record publicly readable
-- by token from the moment the column existed.

-- ============================================================
-- project_checklists
-- ============================================================
ALTER TABLE public.project_checklists
  ADD COLUMN IF NOT EXISTS share_token uuid,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes_html text;

-- Backfill before the NOT NULL: adding the column with a volatile default
-- would also work on PG 11+, but doing it in two steps keeps this file
-- re-runnable against a table that already has the column half-populated.
UPDATE public.project_checklists SET share_token = gen_random_uuid() WHERE share_token IS NULL;

ALTER TABLE public.project_checklists
  ALTER COLUMN share_token SET DEFAULT gen_random_uuid(),
  ALTER COLUMN share_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS project_checklists_share_token_key
  ON public.project_checklists(share_token);

-- A record starts NOT shared.
--
-- `revoked_at` nullable-with-no-default (which is what project_pages and
-- project_reports do) means every row is live from the moment the column
-- exists. Opening a real shared link proved why that is wrong here: this
-- migration backfills a token onto every checklist that already existed, so
-- "live by default" retroactively publishes the entire history - and the Share
-- button rendered "Shared" on a record nobody had ever shared, which is the UI
-- stating something untrue. Tokens are unguessable UUIDs so nothing leaked, but
-- publishing to the internet should be an act, not a default.
--
-- Guarded on the column default rather than `WHERE revoked_at IS NULL`, because
-- this file is advertised as safe to re-run: a bare UPDATE would silently
-- un-share every link the owner had deliberately turned on. Once the default is
-- in place the block never fires again.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'project_checklists'
      AND column_name = 'revoked_at'
      AND column_default IS NOT NULL
  ) THEN
    UPDATE public.project_checklists SET revoked_at = now() WHERE revoked_at IS NULL;
    ALTER TABLE public.project_checklists ALTER COLUMN revoked_at SET DEFAULT now();
  END IF;
END $$;

-- ============================================================
-- project_workflows
-- ============================================================
ALTER TABLE public.project_workflows
  ADD COLUMN IF NOT EXISTS share_token uuid,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes_html text;

UPDATE public.project_workflows SET share_token = gen_random_uuid() WHERE share_token IS NULL;

ALTER TABLE public.project_workflows
  ALTER COLUMN share_token SET DEFAULT gen_random_uuid(),
  ALTER COLUMN share_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS project_workflows_share_token_key
  ON public.project_workflows(share_token);

-- Same opt-in default, same re-run guard, as project_checklists above.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'project_workflows'
      AND column_name = 'revoked_at'
      AND column_default IS NOT NULL
  ) THEN
    UPDATE public.project_workflows SET revoked_at = now() WHERE revoked_at IS NULL;
    ALTER TABLE public.project_workflows ALTER COLUMN revoked_at SET DEFAULT now();
  END IF;
END $$;

-- ============================================================
-- Anonymous visitors read nothing directly.
--
-- Both share routes go through the service-role client in
-- apps/api/src/domains/projects/field-records.ts, which resolves the token,
-- checks revoked_at, checks the project isn't trashed, and returns a
-- purpose-built payload. No `anon` grant is added here on purpose -
-- 20260811000000_lock_down_anon_reads.sql took those away deliberately.
-- ============================================================
