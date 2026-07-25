-- Production schema drift fix: `projects.location` and `photos.archived`/
-- `archived_at` are referenced throughout the live app code (Dashboard,
-- Projects list, Groups, Trash, Project Detail, report generation, and the
-- archive-old-photos cron job) and are present in the last-generated
-- packages/db/src/database.ts types, but do not actually exist on the live
-- database — every query that selects them currently fails with Postgres
-- error 42703 ("column does not exist"), breaking the Dashboard's project
-- list, the Map page's photo stats, and the archive-old-photos cron job.
-- Apply manually in the Supabase SQL editor (or `supabase db push`). Safe to re-run.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS location TEXT;

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
