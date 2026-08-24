-- Admin dashboard: API health aggregation, job run history, and retention.
--
-- WHY
--
-- writeAuditLog() in apps/api/src/lib/audit.ts has recorded route, op, HTTP
-- status, duration, request id and error code for EVERY API call since it was
-- written. Nothing has ever read it. There are 36,289 rows in there and the
-- only way to see any of them is the SQL editor, so "it failed around 2pm" is
-- currently answered by scrolling Railway logs.
--
-- Three things here:
--
--   1. Aggregation functions, so the health page computes percentiles in
--      Postgres instead of pulling 36k rows into Node - the mistake that
--      admin_team_rollups was written to undo.
--   2. `job_runs`, so a cron that silently stops firing is visible. The two
--      hooks (archive-old-photos, purge-trash) currently leave no trace of
--      having run, successfully or otherwise.
--   3. A retention function for api_audit_logs. It is already the largest
--      table in the database and it grows with every request; a health page
--      that makes it useful without also bounding it is a slow outage.
--
-- Apply via the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Indexes. Every query below filters on created_at and groups by op/status.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS api_audit_logs_created_at_idx
  ON public.api_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS api_audit_logs_status_created_idx
  ON public.api_audit_logs (http_status, created_at DESC);
CREATE INDEX IF NOT EXISTS api_audit_logs_op_created_idx
  ON public.api_audit_logs (op, created_at DESC);
CREATE INDEX IF NOT EXISTS api_audit_logs_user_created_idx
  ON public.api_audit_logs (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Overall health for a window: volume, error rate, latency percentiles.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_api_health(since timestamptz)
RETURNS TABLE (
  total_requests bigint,
  error_4xx      bigint,
  error_5xx      bigint,
  p50_ms         numeric,
  p95_ms         numeric,
  p99_ms         numeric,
  distinct_users bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE http_status >= 400 AND http_status < 500)::bigint,
    count(*) FILTER (WHERE http_status >= 500)::bigint,
    -- percentile_cont ignores NULLs; duration_ms is nullable on rows written
    -- before it was recorded, and a NULL there must not read as 0 ms.
    percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms)::numeric,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric,
    percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::numeric,
    count(DISTINCT user_id)::bigint
  FROM public.api_audit_logs
  WHERE created_at >= since;
$$;

-- ---------------------------------------------------------------------------
-- 3. Per-op breakdown. This is the "what is slow and what is failing" table.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_api_op_stats(since timestamptz, max_rows integer DEFAULT 40)
RETURNS TABLE (
  op          text,
  requests    bigint,
  errors      bigint,
  error_rate  numeric,
  p50_ms      numeric,
  p95_ms      numeric,
  max_ms      integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce(l.op, '(no op)') AS op,
    count(*)::bigint,
    count(*) FILTER (WHERE l.http_status >= 400)::bigint,
    -- Rounded here rather than in the client so the sort and the display agree.
    round((count(*) FILTER (WHERE l.http_status >= 400))::numeric * 100
          / greatest(count(*), 1), 2),
    percentile_cont(0.50) WITHIN GROUP (ORDER BY l.duration_ms)::numeric,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY l.duration_ms)::numeric,
    max(l.duration_ms)
  FROM public.api_audit_logs l
  WHERE l.created_at >= since
  GROUP BY coalesce(l.op, '(no op)')
  -- Errors first, then volume: an op failing 40% of the time matters more than
  -- the busiest healthy one, and the page shows a bounded number of rows.
  ORDER BY count(*) FILTER (WHERE l.http_status >= 400) DESC, count(*) DESC
  LIMIT max_rows;
$$;

-- ---------------------------------------------------------------------------
-- 4. Requests per hour, for the volume/error chart.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_api_timeseries(since timestamptz)
RETURNS TABLE (
  bucket   timestamptz,
  requests bigint,
  errors   bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    date_trunc('hour', created_at) AS bucket,
    count(*)::bigint,
    count(*) FILTER (WHERE http_status >= 400)::bigint
  FROM public.api_audit_logs
  WHERE created_at >= since
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.admin_api_health(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_api_op_stats(timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_api_timeseries(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_health(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_api_op_stats(timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_api_timeseries(timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Job run history.
--
-- The cron hooks in apps/api/src/domains/hooks/ leave no record at all, so a
-- job that stops firing - a changed schedule, a rotated CRON_SECRET, a silent
-- throw - is invisible until a customer notices that nothing is being purged.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.job_runs (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job           text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  ok            boolean,
  rows_affected integer,
  error         text,
  meta          jsonb
);

CREATE INDEX IF NOT EXISTS job_runs_job_started_idx ON public.job_runs (job, started_at DESC);
CREATE INDEX IF NOT EXISTS job_runs_started_idx ON public.job_runs (started_at DESC);

-- Same access shape as platform_admins and admin_audit_log: service role only,
-- never exposed to `authenticated`. The REVOKE matters because Supabase grants
-- new public tables to anon by default - the lesson of
-- 20260811000000_lock_down_anon_reads.sql.
REVOKE ALL ON public.job_runs FROM anon, authenticated;
GRANT ALL ON public.job_runs TO service_role;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
-- No policies for `authenticated` -> RLS default-denies all client access.

-- ---------------------------------------------------------------------------
-- 6. Retention.
--
-- Call from a scheduled job. Deliberately a function rather than a one-off
-- DELETE so the cutoff lives in one place and the caller cannot fat-finger it.
-- 90 days is long enough to answer "what happened last quarter" and short
-- enough that the table stops growing without bound.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_prune_api_audit_logs(keep_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.api_audit_logs
   WHERE created_at < now() - make_interval(days => keep_days);
  GET DIAGNOSTICS deleted = ROW_COUNT;

  -- Job history is far smaller but pointless to keep forever either.
  DELETE FROM public.job_runs
   WHERE started_at < now() - make_interval(days => keep_days);

  RETURN deleted;
END $$;

REVOKE ALL ON FUNCTION public.admin_prune_api_audit_logs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_prune_api_audit_logs(integer) TO service_role;

-- Verify:
--   SELECT * FROM public.admin_api_health(now() - interval '24 hours');
--   SELECT * FROM public.admin_api_op_stats(now() - interval '7 days', 10);
--   SELECT count(*) FROM public.job_runs;
