-- A project gets a public link, so its QR code can be scanned by someone who
-- has no account.
--
-- The QR code in the project actions menu encoded `/projects/<id>` - an
-- authenticated app route. Every scan therefore landed on the login screen, and
-- the person holding the phone was a homeowner, an inspector, or a sub who will
-- never have a seat. A code printed on a job site that demands a password is a
-- code that does nothing, which is exactly what client feedback said.
--
-- Same three-column shape as every other shareable thing in Everlumen
-- (project_pages, project_reports, walkthroughs, project_checklists,
-- project_workflows), so there is one share model in this product and not two:
--
--   share_token       - the public link, issued up front, unguessable
--   share_revoked_at  - the owner's off switch, defaulting to OFF
--
-- Named `share_revoked_at` rather than the `revoked_at` the other tables use:
-- `projects` already carries `deleted_at` for the trash lifecycle, and two bare
-- past-participle timestamps side by side on the same row is how someone
-- eventually reads the wrong one.
--
-- Idempotent. Safe to re-run - the `share_revoked_at` backfill is guarded on
-- the column default, so re-running can never un-share a link an owner turned
-- on.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS share_token uuid,
  ADD COLUMN IF NOT EXISTS share_revoked_at timestamptz;

-- Backfill before the NOT NULL. Two steps rather than a volatile default on
-- ADD COLUMN, so the file stays re-runnable against a table that already has
-- the column half-populated.
UPDATE public.projects SET share_token = gen_random_uuid() WHERE share_token IS NULL;

ALTER TABLE public.projects
  ALTER COLUMN share_token SET DEFAULT gen_random_uuid(),
  ALTER COLUMN share_token SET NOT NULL;

-- getPublicProjectShareService looks a project up by token on every public hit.
CREATE UNIQUE INDEX IF NOT EXISTS projects_share_token_key ON public.projects(share_token);

-- A project starts NOT shared.
--
-- This migration mints a token onto every project that already exists, so a
-- nullable-with-no-default `share_revoked_at` would retroactively publish every
-- job site in the database the moment the column landed. Tokens are unguessable
-- UUIDs so nothing would leak in practice, but publishing to the internet is an
-- act, not a default - the same conclusion 20260816000000 reached for
-- checklists and workflows, for the same reason.
--
-- Guarded on the column default rather than `WHERE share_revoked_at IS NULL`,
-- because this file is advertised as safe to re-run: a bare UPDATE would
-- silently take down every link an owner had deliberately turned on. Once the
-- default is in place the block never fires again.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'share_revoked_at'
      AND column_default IS NOT NULL
  ) THEN
    UPDATE public.projects SET share_revoked_at = now() WHERE share_revoked_at IS NULL;
    ALTER TABLE public.projects ALTER COLUMN share_revoked_at SET DEFAULT now();
  END IF;
END $$;

-- ============================================================
-- Anonymous visitors read nothing directly.
--
-- `projects` rows now carry `share_token`, and RLS cannot hide a single column:
-- one anon-readable policy and every share secret in the table goes out at
-- once. The public route never needs this - getPublicProjectShareService runs on
-- the service-role client, which bypasses RLS, and returns a payload holding no
-- token at all.
--
-- Until now `projects` was protected by policy alone. 20260811000000 spells out
-- why that is not enough: "THE FIX IS THE GRANT, NOT THE POLICY" - `walkthroughs`
-- leaked through a policy written `FOR ALL` with no role qualifier, which
-- silently included `anon`. Policies are one careless `TO public` away from
-- opening; a revoked grant is not.
--
-- This removes no access that works today. `projects` is already probed by
-- scripts/verify-anon-exposure.mjs, which reports it unreadable by an anonymous
-- caller, so there is no anonymous read path to break - every public surface
-- (portfolio, showcases, embeds, share links) goes through a pub() op on the
-- service role.
REVOKE ALL ON public.projects FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
-- ============================================================

-- === VERIFY ================================================================
-- Expect anon_select FALSE, and every project opted out of sharing.
SELECT has_table_privilege('anon', 'public.projects', 'SELECT')            AS anon_select,
       count(*)                                                            AS projects,
       count(*) FILTER (WHERE share_token IS NOT NULL)                     AS with_token,
       count(*) FILTER (WHERE share_revoked_at IS NULL)                    AS publicly_shared
FROM public.projects;
--
-- Then, outside the SQL editor:
--   node scripts/verify-anon-exposure.mjs   -> must still report 0 exposed
