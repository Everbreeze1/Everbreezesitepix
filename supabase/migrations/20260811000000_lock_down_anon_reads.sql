-- SECURITY - revoke anonymous read on team_invites, walkthroughs and
-- walkthrough_photos.
--
-- Proven against production with the publishable (anon) key and NO Authorization
-- header:
--
--   GET /rest/v1/team_invites?select=email,role,token   -> rows, tokens included
--   GET /rest/v1/walkthroughs?select=share_token,...    -> 31 rows
--   GET /rest/v1/walkthrough_photos?select=*            -> 99 rows
--
-- and a share_token harvested that way returned a 6 MB customer PDF from
-- GET /v1/walkthroughs/<token>/pdf. The invite leak is worse than data
-- disclosure: `acceptInviteSignup` is a PUBLIC rpc op (registered with `pub()`
-- in apps/api/src/domains/rpc/registry.ts) that calls
-- auth.admin.createUser({email: <the invited address>, password: <caller's
-- choice>}) when no profile exists, so a readable token is an unauthenticated
-- account takeover on someone else's tenant.
--
-- Anonymous INSERT is already blocked on all three tables; this is a read
-- problem only.
--
-- THE FIX IS THE GRANT, NOT THE POLICY. Revoking the table privilege from
-- `anon` cannot be undone by a policy anyone adds later, and it does not depend
-- on knowing the names of the policies that are currently leaking - which
-- cannot be read from here because walkthroughs and walkthrough_photos were
-- created outside this folder (see 20260811001000). The policy sweep in PART 3
-- is defence in depth on top of it.
--
-- NOTHING PUBLIC BREAKS. Every unauthenticated read path goes through the API's
-- service-role client (apps/api/src/lib/supabase.ts getSupabaseAdmin), which
-- bypasses RLS and holds its own grants:
--   * getPublicWalkthroughService  - walkthroughs/service.ts:1304 getSupabaseAdmin()
--   * handleWalkthroughPdf         - walkthroughs/public-pdf.ts:13  getSupabaseAdmin()
--   * lookupInviteService          - teams/service.ts:469           getSupabaseAdmin()
--   * acceptInviteSignupService    - teams/service.ts:553           getSupabaseAdmin()
-- The browser never queries these tables without a session.
--
-- Apply via the Everlumen Supabase SQL editor. Idempotent - safe to re-run.

-- ===========================================================================
-- RUN THIS ONE QUERY ON ITS OWN FIRST, AND KEEP THE OUTPUT.
-- ===========================================================================
-- PART 3 drops policies by ROLE, not by name, and it is the only statement here
-- that can lose something legitimate. It RAISE NOTICEs what it drops, but the
-- Supabase SQL editor does not surface notices, and it renders only the LAST
-- result set of a script - so running the file whole shows neither. Select just
-- the SELECT below, run it, and save the result: `qual` and `with_check` are the
-- policy bodies, and they are the only way to rebuild anything PART 3 removes
-- that step 5 of the smoke test says you still needed.
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('team_invites', 'walkthroughs', 'walkthrough_photos')
ORDER BY tablename, policyname;


-- Fail fast rather than queueing behind app traffic. DROP POLICY and REVOKE both
-- need an AccessExclusiveLock and `walkthroughs` is read on every project page;
-- a lock timeout leaves nothing applied, so just run it again.
SET lock_timeout = '5s';


-- === PART 1 - guarantee the grants the app actually needs =================
-- Deliberately BEFORE the revoke. walkthroughs and walkthrough_photos have no
-- CREATE TABLE in this folder, so their grants were issued by Supabase's default
-- privileges rather than by a migration and cannot be read back from here.
-- Asserting them first makes PART 2 incapable of locking the product out of its
-- own tables, whatever state the grants are in.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_invites        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walkthroughs        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walkthrough_photos  TO authenticated;

GRANT ALL ON public.team_invites       TO service_role;
GRANT ALL ON public.walkthroughs       TO service_role;
GRANT ALL ON public.walkthrough_photos TO service_role;


-- === PART 2 - take the tables away from anon ==============================
-- REVOKE ALL, not REVOKE SELECT: an anonymous caller has no business writing
-- these rows either, and leaving INSERT/UPDATE granted would mean the only thing
-- standing between an attacker and a forged invite row is a policy - which is
-- exactly the assumption that failed here.
REVOKE ALL ON public.team_invites       FROM anon;
REVOKE ALL ON public.walkthroughs       FROM anon;
REVOKE ALL ON public.walkthrough_photos FROM anon;

-- PUBLIC is every role at once, so a privilege granted there is a second door
-- into the same rows that revoking `anon` does not close. `authenticated` and
-- `service_role` are granted explicitly in PART 1, and the table owner keeps its
-- privileges regardless, so nothing the app uses depends on this one.
REVOKE ALL ON public.team_invites       FROM PUBLIC;
REVOKE ALL ON public.walkthroughs       FROM PUBLIC;
REVOKE ALL ON public.walkthrough_photos FROM PUBLIC;


-- === PART 3 - drop the policies that grant anon/public access =============
-- The leaking policies were created outside this folder and their names are
-- unknown, so they are located by role rather than by name.
--
-- PERMISSIVE only: a RESTRICTIVE policy on PUBLIC *subtracts* access, and
-- dropping one would loosen the table rather than tighten it.
--
-- Policies scoped `TO authenticated` are left alone - those are the owner-only
-- rules that predate the migrations folder and are still load-bearing.
DO $$
DECLARE
  pol     RECORD;
  dropped int := 0;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('team_invites', 'walkthroughs', 'walkthrough_photos')
      AND permissive = 'PERMISSIVE'
      AND roles::text[] && ARRAY['anon', 'public']
  LOOP
    RAISE NOTICE 'dropping anon-readable policy %.% : "%" (cmd=%, roles=%)',
      pol.schemaname, pol.tablename, pol.policyname, pol.cmd, pol.roles;
    EXECUTE format('DROP POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
    dropped := dropped + 1;
  END LOOP;

  RAISE NOTICE 'anon/public policies dropped: %', dropped;
END $$;


-- === PART 4 - the authenticated-only policies that replace them ===========
-- RLS asserted explicitly: with the grants revoked in PART 2 an anonymous caller
-- is already blocked, but a table with RLS off would hand every row to any
-- signed-in user the moment someone re-grants it.
ALTER TABLE public.team_invites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walkthroughs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.walkthrough_photos ENABLE ROW LEVEL SECURITY;

-- --- team_invites ---
-- Team-scoped via is_team_admin() rather than plain membership, because the row
-- carries `token` and RLS cannot hide a single column: whoever can read the row
-- can read the credential. The only reader is getMyTeamService
-- (apps/api/src/domains/teams/service.ts:179), which runs on ctx.supabase - the
-- publishable key plus the caller's JWT (lib/user-context.ts), i.e. RLS applies
-- and the service role does NOT cover it. Its one consumer, TeamsPage, returns
-- "Team settings are owner-only" before rendering invites for anyone else
-- (features/teams/pages/TeamsPage.tsx:104), so owner/admin is the full set of
-- callers this has to satisfy. revokeInvite deletes through the same client and
-- is covered by the same FOR ALL policy.
--
-- This is 20260612191404_teams.sql's policy restated verbatim; it is here so
-- that a sweep in PART 3 that catches a same-named public variant cannot leave
-- the table with no policy at all.
DROP POLICY IF EXISTS "Admins manage invites" ON public.team_invites;
CREATE POLICY "Admins manage invites" ON public.team_invites
  FOR ALL TO authenticated
  USING (public.is_team_admin(auth.uid(), team_id))
  WITH CHECK (public.is_team_admin(auth.uid(), team_id));

-- --- walkthroughs ---
-- Same predicate as 20260612191404_teams.sql, plus a created_by fallback: PART 3
-- may have dropped a pre-existing owner-only policy that was written without a
-- TO clause (which Postgres records as role `public`), and without this the
-- author of a walkthrough whose project row has since been deleted would lose
-- their own recording. are_teammates(x, x) is true, so the team predicate
-- already covers the ordinary case and this only widens it to that one gap.
DROP POLICY IF EXISTS "Teammates manage team walkthroughs" ON public.walkthroughs;
CREATE POLICY "Teammates manage team walkthroughs" ON public.walkthroughs
  FOR ALL TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

-- --- walkthrough_photos ---
-- Scoped through walkthrough_id to exactly the rule above, mirroring how
-- 20260612191404_teams.sql scopes project_checklist_items through their parent.
-- FOR ALL with no WITH CHECK means USING is applied to writes too, which is what
-- the browser's upsert of photo links needs (ProjectDetailPage.tsx:1269, :2006).
DROP POLICY IF EXISTS "Teammates manage team walkthrough photos" ON public.walkthrough_photos;
CREATE POLICY "Teammates manage team walkthrough photos" ON public.walkthrough_photos
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.walkthroughs w
      WHERE w.id = walkthrough_photos.walkthrough_id
        AND (
          w.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = w.project_id AND public.are_teammates(auth.uid(), p.created_by)
          )
        )
    )
  );


-- === VERIFY ================================================================
-- Expect: every anon_* column FALSE, every authed_can_select TRUE, and every
-- remaining policy listing roles = {authenticated}.
--
-- Run these three SELECTs one at a time. The SQL editor renders only the last
-- result set of a script, so running the file whole shows the RLS check and
-- silently discards the two that matter most.

-- The definitive check. has_table_privilege() is used rather than
-- information_schema.role_table_grants because it answers the question the
-- attacker asks - it already folds in anything granted via PUBLIC, and it is not
-- filtered by which roles the session happens to be a member of.
SELECT t.table_name,
       has_table_privilege('anon', 'public.' || t.table_name, 'SELECT') AS anon_can_select,
       has_table_privilege('anon', 'public.' || t.table_name, 'INSERT') AS anon_can_insert,
       has_table_privilege('anon', 'public.' || t.table_name, 'UPDATE') AS anon_can_update,
       has_table_privilege('anon', 'public.' || t.table_name, 'DELETE') AS anon_can_delete,
       -- Guards against over-revoking: the app must still be able to read.
       has_table_privilege('authenticated', 'public.' || t.table_name, 'SELECT') AS authed_can_select
FROM (VALUES ('team_invites'), ('walkthroughs'), ('walkthrough_photos')) AS t(table_name);

SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('team_invites', 'walkthroughs', 'walkthrough_photos')
ORDER BY tablename, policyname;

-- RLS must read `t` on all three.
SELECT relname AS table_name, relrowsecurity AS rls_enabled
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('team_invites', 'walkthroughs', 'walkthrough_photos')
ORDER BY relname;


-- ===========================================================================
-- SHARE TOKEN ROTATION - DELIBERATELY NOT RUN. OWNER'S DECISION.
-- ===========================================================================
-- The 31 `share_token` values in this table were readable by anyone with the
-- publishable key for as long as the policy above existed, so they must be
-- treated as public knowledge. Rotating them is the only way to close that.
--
-- THE COST: every walkthrough share link already sent to a customer 404s the
-- moment this runs, including links pasted into emails, texts and PDFs that
-- cannot be recalled. Whoever owns those customer relationships decides, not
-- this migration - which is why it is commented out rather than guarded.
--
-- ORDER MATTERS: run this only AFTER the rest of this file has been applied and
-- the VERIFY block above returns no anon grants. Rotating first just publishes a
-- fresh set of tokens to the same anonymous readers.
--
-- The narrower alternative, if the owner would rather not break live links:
-- rotate only the walkthroughs that are still shared and were created before
-- today, then re-send those links. Add `AND created_at < '2026-08-11'` below.
--
-- The snapshot comes first and in the same transaction: once the UPDATE has run
-- the old token is gone, and it is the only way to answer "which of my links
-- was this?" when a customer reports a dead one.
--
-- gen_random_uuid() is cast to text on the way in because the share link is a
-- 36-character uuid string in both readers (publicSchema uses z.string().uuid()
-- in walkthroughs/service.ts:1297, handleWalkthroughPdf regex-checks the same
-- shape). Drop the ::text if the column's own type is uuid.
--
-- Uncomment to run:
--
-- BEGIN;
--   CREATE TABLE IF NOT EXISTS public.walkthrough_share_token_backup AS
--     SELECT id AS walkthrough_id, share_token::text AS old_token, now() AS captured_at
--     FROM public.walkthroughs
--     WHERE share_token IS NOT NULL;
--
--   -- Lock the backup down IN THE SAME TRANSACTION as its creation. Supabase
--   -- ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO
--   -- anon, authenticated, service_role`, so a new public table is readable by
--   -- the publishable key the moment it exists and PostgREST will serve it -
--   -- which is the exact mechanism that leaked `walkthroughs` in the first
--   -- place. Without these two lines the rotation republishes every token it is
--   -- rotating away, and RLS with no policy is what keeps `authenticated` out.
--   REVOKE ALL ON public.walkthrough_share_token_backup FROM anon, authenticated, PUBLIC;
--   ALTER TABLE public.walkthrough_share_token_backup ENABLE ROW LEVEL SECURITY;
--
--   UPDATE public.walkthroughs
--      SET share_token = gen_random_uuid()::text
--    WHERE share_token IS NOT NULL;
-- COMMIT;
--
-- Then hand the owner the replacement links:
--   SELECT w.id, w.title, w.share_token
--   FROM public.walkthroughs w
--   WHERE w.share_token IS NOT NULL;
-- and drop public.walkthrough_share_token_backup once the re-sends have settled
-- - it holds the leaked values and there is no reason to keep them around.
