-- The cron endpoints have never been able to authenticate.
--
-- `verifyCronSecret` (apps/api/src/lib/cron-auth.ts) authorises every scheduled
-- job by comparing the `x-cron-secret` header against a Vault secret it reads
-- through an RPC:
--
--     const { data: expected, error } = await admin.rpc("get_cron_shared_secret");
--     if (error || !expected) return false;
--
-- That function does not exist. It is not defined in any migration in this
-- folder, and PostgREST answers `PGRST202: function not found`. The RPC
-- therefore always errors, `verifyCronSecret` always returns false, and both
-- scheduled endpoints answer 401 to every caller no matter what secret is
-- presented:
--
--     POST /v1/hooks/purge-trash        -> 401
--     POST /v1/hooks/archive-old-photos -> 401
--
-- So nothing has ever been purged and nothing has ever been archived. Trashed
-- rows and their storage objects accumulate forever, and the product's promise
-- that deleted items are removed after TRASH_RETENTION_DAYS (60) is currently
-- false. Nothing surfaced it because a cron job that 401s is silent: no user
-- action fails, no page errors, storage just never goes down.
--
-- It has not bitten yet only because the oldest trashed item is 36 days old and
-- the cutoff is 60 — the first genuinely overdue rows are ~24 days away.
--
-- This file creates the missing secret and the missing function. It does NOT
-- schedule anything; see the VERIFY block at the end for whether the jobs that
-- call these endpoints exist.
--
-- Apply via the SitePix Supabase SQL editor. Idempotent — safe to re-run, and
-- re-running never rotates a secret that is already in use.

SET lock_timeout = '5s';

-- === PART 1 — the secret =====================================================
-- Supabase provisions `supabase_vault` on every project; the guard is here so
-- this file is honest about its dependency rather than assuming.
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Generated, not hand-picked: this value is only ever copied machine-to-machine
-- (into the pg_cron job's header), so there is no reason for a human-memorable
-- secret and every reason for 32 random bytes.
--
-- Guarded on existence rather than written unconditionally: re-running this
-- file must not rotate a secret that scheduled jobs are already sending, which
-- would silently break them again — the exact failure mode this migration
-- exists to end.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'cron_shared_secret',
      'Shared secret for pg_cron -> SitePix API hook calls (x-cron-secret header)'
    );
  END IF;
END $$;

-- === PART 2 — the function the API calls =====================================
-- SECURITY DEFINER because the caller (service_role, via PostgREST) has no
-- business holding direct read access to the vault; it needs exactly this one
-- secret and nothing else in there.
--
-- `search_path = ''` is not decoration. A SECURITY DEFINER function runs with
-- the definer's rights, so an attacker-controlled search_path could shadow
-- `vault.decrypted_secrets` with their own relation and have this function hand
-- back a value they chose. Every reference below is schema-qualified for that
-- reason.
CREATE OR REPLACE FUNCTION public.get_cron_shared_secret()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.decrypted_secret
  FROM vault.decrypted_secrets AS s
  WHERE s.name = 'cron_shared_secret'
  LIMIT 1;
$$;

-- === PART 3 — who may call it ================================================
-- THE FIX IS THE GRANT, NOT THE POLICY (see 20260811000000).
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. On a SECURITY DEFINER
-- function that returns a secret, that default would let any anonymous visitor
-- with the publishable key read the cron secret over the REST API and then call
-- the purge endpoint themselves — an unauthenticated mass-delete. The revoke is
-- the whole security boundary here, so it is explicit and it names every role.
REVOKE ALL ON FUNCTION public.get_cron_shared_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_shared_secret() TO service_role;

-- === VERIFY ==================================================================
-- 1. The function exists, is SECURITY DEFINER, and only service_role may run it.
--    Expect: security_definer = true, anon_exec = false, authenticated_exec = false,
--            service_role_exec = true.
SELECT p.proname,
       p.prosecdef                                                        AS security_definer,
       has_function_privilege('anon',          p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')          AS authenticated_exec,
       has_function_privilege('service_role',  p.oid, 'EXECUTE')          AS service_role_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_cron_shared_secret';

-- 2. The secret to paste into the scheduled jobs' `x-cron-secret` header.
--    Treat this output like a password — it authorises permanent deletion.
SELECT decrypted_secret AS cron_shared_secret
FROM vault.decrypted_secrets
WHERE name = 'cron_shared_secret';

-- 3. Are the jobs that call the endpoints actually scheduled?
--    An empty result means the endpoints now *can* authenticate but nothing is
--    calling them — auth was only half the problem. Schedule them with
--    cron.schedule + net.http_post against:
--      POST https://api.everbreezesitepix.com/v1/hooks/purge-trash
--      POST https://api.everbreezesitepix.com/v1/hooks/archive-old-photos
--    passing header  x-cron-secret: <the value from query 2>
SELECT jobid, schedule, jobname, active
FROM cron.job
ORDER BY jobid;
