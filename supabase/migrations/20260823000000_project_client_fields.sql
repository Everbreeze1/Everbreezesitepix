-- Client and job identity, so a document stops asking for them on every use.
--
-- The built-in document templates merge `{{client_name}}`, `{{client_contact}}`,
-- `{{project_number}}` and `{{prepared_by_title}}`, but no table held any of
-- them. Everything downstream did the best it could with that: the resolver
-- turns an unfillable field into a click-to-type blank, and the "Use in a
-- project" step asks for it. Correct, but it asks EVERY time - a crew running
-- five walkthroughs on one job retyped the client's name five times.
--
-- `job_title` is the odd one out: it already exists in the Settings profile
-- form, and has since it shipped. It was written to localStorage, which is
-- exactly why it could never reach a document on any other device, let alone
-- into a PDF.
--
-- All four are additive and nullable, so every existing row stays valid and no
-- current query changes meaning. New columns inherit the table's RLS policies,
-- so there is nothing to grant.
--
-- Apply manually in the Supabase SQL editor (or `supabase db push`).
-- Safe to re-run.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_name    TEXT,
  ADD COLUMN IF NOT EXISTS client_contact TEXT,
  ADD COLUMN IF NOT EXISTS project_number TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS job_title TEXT;

-- === VERIFY ================================================================
-- Expect four rows.
--
-- SELECT table_name, column_name
--   FROM information_schema.columns
--  WHERE (table_schema = 'public' AND table_name = 'projects'
--         AND column_name IN ('client_name', 'client_contact', 'project_number'))
--     OR (table_schema = 'public' AND table_name = 'profiles'
--         AND column_name = 'job_title')
--  ORDER BY table_name, column_name;
