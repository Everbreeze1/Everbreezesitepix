-- SECURITY — stop authenticated users writing their own billing state.
--
-- THE BUG. 20260612191404_teams.sql:25 grants the table outright:
--
--     GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
--
-- and the only UPDATE policy is
--
--     CREATE POLICY "Owner updates their team" ON public.teams
--       FOR UPDATE TO authenticated USING (owner_id = auth.uid());
--
-- `USING` decides which rows you may update. It does NOT restrict which columns,
-- and with no `WITH CHECK` it does not constrain the row you write back either.
-- Meanwhile 20260612193150 added `plan`/`member_limit` and 20260724000000 added
-- `subscription_status`/`is_internal` to the same table, without revisiting that
-- grant. So any signed-in team owner can, with the publishable key that ships in
-- the browser bundle:
--
--     PATCH /rest/v1/teams?id=eq.<their own team>
--     {"plan":"team","subscription_status":"active","is_internal":true}
--
-- and hand themselves the top tier permanently. Every server-side gate reads
-- exactly those columns (lib/team-plan.ts getCallerTeamPlan), so this is not a
-- display bug — it is the whole paywall. `is_internal` is worse than `plan`: it
-- short-circuits the tier check entirely.
--
-- THE FIX IS THE GRANT, NOT THE POLICY, for the same reason as
-- 20260811000000: a privilege that isn't granted cannot be re-opened by someone
-- adding a policy later.
--
-- NOTHING BREAKS. The browser never writes this table — `grep -rn 'from("teams")'
-- apps/web/src` returns nothing — and every write in apps/api goes through
-- `getSupabaseAdmin()` (service role, which keeps its own GRANT ALL and bypasses
-- RLS): createTeamService inserts, and the Stripe webhook is the only thing that
-- ever sets plan/subscription_status. The two reads that DO use the caller's
-- client are both SELECTs — getMyTeamService (teams/service.ts:263) and
-- getCallerTeamPlan (lib/team-plan.ts:68) — so SELECT stays granted.
--
-- Apply via the SitePix Supabase SQL editor. Idempotent — safe to re-run.

SET lock_timeout = '5s';


-- === PART 1 — take the writes away from authenticated ======================
-- SELECT is deliberately left in place; see above.
REVOKE INSERT, UPDATE, DELETE ON public.teams FROM authenticated;

-- PUBLIC is every role at once, so a privilege granted there is a second door
-- into the same rows. service_role keeps GRANT ALL from 20260612191404:26.
REVOKE INSERT, UPDATE, DELETE ON public.teams FROM PUBLIC;

GRANT SELECT ON public.teams TO authenticated;
GRANT ALL    ON public.teams TO service_role;


-- === PART 2 — defence in depth on the policies =============================
-- Redundant while PART 1 holds, and that is the point: if a future migration
-- re-grants UPDATE without thinking (which is exactly how this bug arrived),
-- these keep the blast radius to zero rather than restoring the hole.
--
-- The write policies are dropped rather than tightened. There is no legitimate
-- caller for them — the service role does not consult policies at all — so the
-- honest expression of the rule is "authenticated may only read this table".
DROP POLICY IF EXISTS "Users create their own team" ON public.teams;
DROP POLICY IF EXISTS "Owner updates their team"    ON public.teams;
DROP POLICY IF EXISTS "Owner deletes their team"    ON public.teams;

-- The SELECT policy from 20260612191404 is intentionally left alone: it scopes
-- reads to your own team, and both remaining callers depend on it.


-- === VERIFY ================================================================
-- Expect: teams_insert/update/delete all FALSE, teams_select TRUE.
SELECT
  has_table_privilege('authenticated', 'public.teams', 'SELECT') AS teams_select,
  has_table_privilege('authenticated', 'public.teams', 'INSERT') AS teams_insert,
  has_table_privilege('authenticated', 'public.teams', 'UPDATE') AS teams_update,
  has_table_privilege('authenticated', 'public.teams', 'DELETE') AS teams_delete;

-- Expect: only the SELECT policy remains, scoped to `authenticated`.
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'teams'
ORDER BY policyname;


-- === AFTERWARDS — check whether anyone already used this ===================
-- The hole was open for the life of the table, so a paid tier in the database
-- is not proof of a payment. Any row here with a real plan but no Stripe
-- subscription was either comped by hand (is_internal) or self-granted.
-- Reconcile against the Stripe dashboard before trusting it.
--
--   SELECT id, name, plan, subscription_status, is_internal,
--          stripe_customer_id, stripe_subscription_id, updated_at
--   FROM public.teams
--   WHERE (plan <> 'starter' OR subscription_status = 'active' OR is_internal)
--     AND stripe_subscription_id IS NULL
--   ORDER BY updated_at DESC;
