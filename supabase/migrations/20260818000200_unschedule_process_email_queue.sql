-- Remove the `process-email-queue` cron job.
--
-- It ran every minute (`* * * * *`) and returned 404 every time. Sampled from
-- net._http_response on 2026-08-13:
--
--   80495  404  <!DOCTYPE html><html lang="en">…  13:44:00
--   80494  404  <!DOCTYPE html><html lang="en">…  13:43:00
--   80493  404  <!DOCTYPE html><html lang="en">…  13:42:00
--
-- An HTML body, not JSON - it was reaching the web app's 404 page, not an API
-- route. Nothing in this repository backs it:
--
--   * no `email_queue` table in any migration
--   * no `supabase/functions/` directory - this project has no edge functions
--   * apps/api/src/server.ts exposes exactly two hooks, `purge-trash` and
--     `archive-old-photos`; there is no email-queue route
--
-- Transactional email does not depend on it either: auth mail goes out through
-- the Send Email hook, and team invites are sent inline by the API. Both were
-- confirmed delivering through Resend while this job was failing.
--
-- Almost certainly a leftover from the earlier Lovable-era build (a
-- `testuser+lovable@example.com` account still exists from it) pointing at an
-- edge function that has since been deleted.
--
-- The cost of leaving it: ~1,440 failed HTTP calls a day, each writing a row to
-- net._http_response - which is the same table a genuine 401 from the purge job
-- would appear in. It was already burying real results there.
--
-- REVERSIBILITY. The job's `command` is printed by PART 1 before PART 2 removes
-- it, so the definition survives in this run's output. To restore it, re-run
-- cron.schedule('process-email-queue', '* * * * *', <that command>).
--
-- Apply via the SitePix Supabase SQL editor. Idempotent - re-running after the
-- job is gone is a no-op.

SET lock_timeout = '5s';

-- === PART 1 - record what is about to be removed =============================
-- Read this output before scrolling on. It is the only copy of the definition
-- once PART 2 runs.
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname = 'process-email-queue';

-- Also into the server log, so it survives outside the SQL editor session.
DO $$
DECLARE
  cmd text;
BEGIN
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'process-email-queue';
  IF cmd IS NULL THEN
    RAISE NOTICE 'process-email-queue: not scheduled, nothing to remove';
  ELSE
    RAISE NOTICE 'process-email-queue removed. Previous command was: %', cmd;
  END IF;
END $$;

-- === PART 2 - unschedule =====================================================
-- Guarded: cron.unschedule() raises if the job does not exist, which would make
-- this file fail on a second run rather than doing nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue') THEN
    PERFORM cron.unschedule('process-email-queue');
  END IF;
END $$;

-- === VERIFY ==================================================================
-- 1. Expect exactly one row: purge-trash, active. process-email-queue gone.
SELECT jobid, jobname, schedule, active
FROM cron.job
ORDER BY jobid;

-- 2. The 404-per-minute stream should stop. Run this a few minutes from now:
--    every remaining row should be from purge-trash's 03:17 UTC run, and any
--    non-2xx status here is now worth investigating rather than background
--    noise.
SELECT id, status_code, left(content::text, 80) AS body, created
FROM net._http_response
ORDER BY created DESC
LIMIT 10;
