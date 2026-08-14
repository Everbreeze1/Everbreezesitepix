-- Schedule the trash purge.
--
-- 20260818000000 fixed the authentication half: `get_cron_shared_secret` now
-- exists, and POST /v1/hooks/purge-trash answers 200 to a correct secret
-- (verified: {"ok":true,"photosPurged":0,"projectsPurged":0}). But nothing was
-- ever calling it - `cron.job` held exactly one row, `process-email-queue`.
--
-- So the endpoint was unreachable for two independent reasons, and fixing only
-- the first would have left storage growing exactly as before while looking
-- fixed from the API side.
--
-- WHY ONLY purge-trash, AND NOT archive-old-photos:
-- the archive job reports
--   "PHOTO_ARCHIVE_ENABLED is not set. This job consumes Storage
--    image-transformation quota to save storage"
-- and this project is presently over its Storage Image Transformations quota
-- (171/100 for the cycle). Scheduling a job whose stated cost is the one meter
-- already in breach would make that worse to save storage that is at 0.016 of
-- 100 GB. It stays unscheduled until that flag is deliberately turned on.
--
-- Apply via the SitePix Supabase SQL editor. Idempotent - cron.schedule upserts
-- by job name, so re-running re-points the same job rather than adding another.

SET lock_timeout = '5s';

-- pg_cron runs the schedule; pg_net makes the outbound HTTP call. Both are
-- available on Supabase but neither is enabled by default on every project.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 03:17 UTC daily.
--
-- Off-peak because a purge deletes storage objects as well as rows, and on an
-- odd minute rather than the hour so it does not land in the same second as
-- every other cron job on the instance.
--
-- The secret is read from the vault INSIDE the command, not baked into the job
-- definition. Rotating it then takes effect on the next run with no
-- rescheduling - and the secret never appears in `cron.job.command`, which is
-- readable by anyone who can select from that table.
SELECT cron.schedule(
  'purge-trash',
  '17 3 * * *',
  $job$
  SELECT net.http_post(
    url     := 'https://api.everbreezesitepix.com/v1/hooks/purge-trash',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  (SELECT decrypted_secret
                         FROM vault.decrypted_secrets
                         WHERE name = 'cron_shared_secret')
    ),
    body    := '{}'::jsonb
  );
  $job$
);

-- === VERIFY ==================================================================
-- 1. The job exists and is active. Expect one row, active = true.
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'purge-trash';

-- 2. After the next 03:17 UTC run, this shows whether it actually fired and
--    what it returned. `status` should be 'succeeded'.
--    (Empty until the first run - that is expected immediately after applying.)
SELECT j.jobname, r.status, r.return_message, r.start_time
FROM cron.job_run_details r
JOIN cron.job j ON j.jobid = r.jobid
WHERE j.jobname = 'purge-trash'
ORDER BY r.start_time DESC
LIMIT 5;

-- 3. The HTTP response pg_net recorded for that call - the endpoint's own
--    answer, which is where a 401 would show up if the secret ever drifts.
SELECT id, status_code, content::text, created
FROM net._http_response
ORDER BY created DESC
LIMIT 5;
