-- Checklists and workflows become printable, shareable documents.
--
-- Both already carried the whole record — items, answers, photos, sign-offs —
-- and had nowhere to send it. A checklist could only be read inside the app, in
-- a modal, by its owner. This adds the three columns every other document-shaped
-- thing in SitePix already has (project_pages, project_reports, walkthroughs):
--
--   share_token  — the public link, issued up front like project_pages does
--   revoked_at   — the owner's off switch for that link
--   notes_html   — the rich-text write-up that turns a tick list into a document
--
-- Idempotent. Safe to re-run.

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

-- ============================================================
-- Anonymous visitors read nothing directly.
--
-- Both share routes go through the service-role client in
-- apps/api/src/domains/projects/field-records.ts, which resolves the token,
-- checks revoked_at, checks the project isn't trashed, and returns a
-- purpose-built payload. No `anon` grant is added here on purpose —
-- 20260811000000_lock_down_anon_reads.sql took those away deliberately.
-- ============================================================
