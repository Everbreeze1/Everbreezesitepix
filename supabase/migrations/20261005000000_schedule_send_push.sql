-- Schedule the push delivery sweep.
--
-- `POST /v1/hooks/send-push` reads `notifications` for rows `push_sent_at` has
-- not stamped, sends them through Expo's push service to whatever devices the
-- recipients have registered in `device_push_tokens`, and stamps them.
--
-- Nothing calls it until this runs. The app registers a token on every launch
-- and the notification rows accumulate correctly either way, so the symptom of
-- not applying this is not an error anywhere: it is simply that no phone ever
-- buzzes.
--
-- WHY A SWEEP AND NOT A TRIGGER:
-- most notifications are raised by database triggers - task_assigned,
-- checklist_assigned, every *_completed, task_comment, project_assigned - which
-- are written in SQL and never pass through server code. Sending from
-- `insertNotification` would have covered the four service-layer types and
-- silently skipped the nine that matter most. See
-- apps/api/src/domains/notifications/push.ts.
--
-- Apply via the Everlumen Supabase SQL editor. Idempotent: cron.schedule upserts
-- by job name, so re-running re-points the same job rather than adding another.

SET lock_timeout = '5s';

-- Same two extensions purge-trash needs. Already enabled if that job was
-- applied; harmless to assert again.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

/*
 * Every five minutes.
 *
 * The interval IS the delivery latency, so this is the one number worth
 * thinking about. Five minutes is chosen against what these notifications say:
 * "somebody assigned you a task" and "the work you handed out is finished".
 * Neither is worse for arriving four minutes late, and nothing in this table is
 * time-critical in the way a delivery ETA or a security code would be.
 *
 * Faster costs more than it looks. Each run is a request to Expo per batch of
 * 100 messages plus two Postgres statements even when there is nothing to send,
 * and the sweep is bounded at 500 rows, so a minute-by-minute schedule spends
 * twelve times as much to save four minutes nobody notices.
 *
 * The secret is read from the vault INSIDE the command rather than baked into
 * the job definition, matching purge-trash: rotating it then takes effect on
 * the next run with no rescheduling, and the secret never appears in
 * `cron.job.command`, which is readable by anyone who can select from it.
 */
SELECT cron.schedule(
  'send-push',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url     := 'https://api.everlumen.co/v1/hooks/send-push',
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
WHERE jobname = 'send-push';

-- 2. Whether it actually fired, and what pg_cron made of it. Within five
--    minutes of applying this there should be rows, and `status` should be
--    'succeeded'. Note that 'succeeded' here means the HTTP call was made, not
--    that the endpoint liked it - check 3 for that.
SELECT j.jobname, r.status, r.return_message, r.start_time
FROM cron.job_run_details r
JOIN cron.job j ON j.jobid = r.jobid
WHERE j.jobname = 'send-push'
ORDER BY r.start_time DESC
LIMIT 5;

-- 3. The endpoint's own answer. A 401 here means the secret has drifted from
--    `AUTH`/vault; a 200 with {"sent":0,"considered":0} means it ran and there
--    was nothing waiting, which is the normal quiet state.
SELECT id, status_code, content::text, created
FROM net._http_response
ORDER BY created DESC
LIMIT 5;

-- 4. What the job itself recorded. `recordJobRun` writes a row per invocation
--    to `job_runs`, which is the history that survives net._http_response being
--    pruned.
SELECT job, ok, rows_affected, error, started_at, finished_at, meta
FROM public.job_runs
WHERE job = 'send-push'
ORDER BY started_at DESC
LIMIT 10;

-- === TO STOP IT ==============================================================
-- SELECT cron.unschedule('send-push');
