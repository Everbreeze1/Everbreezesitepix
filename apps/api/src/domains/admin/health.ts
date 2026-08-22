import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { isMissingFunction, isMissingTable } from "../../lib/postgrest";
import type { AuthedContext } from "../../lib/user-context";

/*
 * The read side of api_audit_logs.
 *
 * Every request the API has ever served is in that table - route, op, status,
 * duration, request id, error code - and until now nothing has read a single
 * row of it. A customer reporting "it broke this afternoon" was answered by
 * scrolling Railway's log viewer, which does not survive a redeploy.
 *
 * Everything here aggregates in Postgres. Pulling 36k rows into Node to count
 * them is the exact mistake admin_team_rollups exists to undo, and this table
 * is an order of magnitude larger than photos.
 */

export interface ApiHealth {
  windowHours: number;
  totals: {
    requests: number;
    errors4xx: number;
    errors5xx: number;
    errorRate: number;
    distinctUsers: number;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
  };
  ops: Array<{
    op: string;
    requests: number;
    errors: number;
    errorRate: number;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  }>;
  timeseries: Array<{ bucket: string; requests: number; errors: number }>;
  recentFailures: Array<{
    id: string;
    route: string;
    op: string | null;
    httpStatus: number;
    errorCode: string | null;
    durationMs: number | null;
    requestId: string | null;
    createdAt: string;
    user: { id: string; name: string | null; email: string | null } | null;
    /** The thrown message, recorded for 5xx by rpc/handle.ts. */
    message: string | null;
  }>;
  /** Set when the observability migration has not been applied yet. */
  unavailable: string | null;
}

export const getApiHealthInputSchema = z.object({
  windowHours: z.number().int().min(1).max(720).default(24),
});

export async function getApiHealthService(
  ctx: AuthedContext,
  data: z.infer<typeof getApiHealthInputSchema>,
): Promise<ApiHealth> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const since = new Date(Date.now() - data.windowHours * 60 * 60 * 1000).toISOString();
  const empty: ApiHealth = {
    windowHours: data.windowHours,
    totals: {
      requests: 0,
      errors4xx: 0,
      errors5xx: 0,
      errorRate: 0,
      distinctUsers: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
    },
    ops: [],
    timeseries: [],
    recentFailures: [],
    unavailable: null,
  };

  const [healthRes, opsRes, seriesRes] = await Promise.all([
    (admin as any).rpc("admin_api_health", { since }),
    (admin as any).rpc("admin_api_op_stats", { since, max_rows: 40 }),
    (admin as any).rpc("admin_api_timeseries", { since }),
  ]);

  // The whole page depends on one migration, so say so once rather than
  // rendering three empty panels that look like "no traffic".
  if (healthRes.error) {
    if (isMissingFunction(healthRes.error) || isMissingTable(healthRes.error)) {
      return {
        ...empty,
        unavailable:
          "Run supabase/migrations/20260822140000_admin_observability.sql - the aggregation functions are not in this database yet.",
      };
    }
    throw new Error(healthRes.error.message);
  }

  const h = ((healthRes.data as any[]) ?? [])[0] ?? {};
  const requests = Number(h.total_requests ?? 0);
  const errors4xx = Number(h.error_4xx ?? 0);
  const errors5xx = Number(h.error_5xx ?? 0);

  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Math.round(Number(v));

  // The failure tail is a plain indexed select - no aggregation needed, and it
  // is the panel an operator opens first when someone reports a broken action.
  const { data: failureRows } = await (admin as any)
    .from("api_audit_logs")
    .select(
      "id, route, op, http_status, error_code, duration_ms, request_id, created_at, user_id, meta",
    )
    .gte("created_at", since)
    .gte("http_status", 500)
    .order("created_at", { ascending: false })
    .limit(50);
  const failures = (failureRows as any[]) ?? [];

  const userIds = Array.from(new Set(failures.map((f) => f.user_id).filter(Boolean)));
  const { data: profileRows } = userIds.length
    ? await (admin as any).from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] };
  const profileById = new Map(((profileRows as any[]) ?? []).map((p) => [p.id, p]));

  return {
    windowHours: data.windowHours,
    totals: {
      requests,
      errors4xx,
      errors5xx,
      errorRate: requests ? Number((((errors4xx + errors5xx) / requests) * 100).toFixed(2)) : 0,
      distinctUsers: Number(h.distinct_users ?? 0),
      p50Ms: num(h.p50_ms),
      p95Ms: num(h.p95_ms),
      p99Ms: num(h.p99_ms),
    },
    ops: ((opsRes.data as any[]) ?? []).map((r) => ({
      op: r.op,
      requests: Number(r.requests ?? 0),
      errors: Number(r.errors ?? 0),
      errorRate: Number(r.error_rate ?? 0),
      p50Ms: num(r.p50_ms),
      p95Ms: num(r.p95_ms),
      maxMs: r.max_ms === null || r.max_ms === undefined ? null : Number(r.max_ms),
    })),
    timeseries: ((seriesRes.data as any[]) ?? []).map((r) => ({
      bucket: r.bucket,
      requests: Number(r.requests ?? 0),
      errors: Number(r.errors ?? 0),
    })),
    recentFailures: failures.map((f) => ({
      id: f.id,
      route: f.route,
      op: f.op,
      httpStatus: f.http_status,
      errorCode: f.error_code,
      durationMs: f.duration_ms,
      requestId: f.request_id,
      createdAt: f.created_at,
      message: typeof f.meta?.error === "string" ? f.meta.error : null,
      user: profileById.has(f.user_id)
        ? {
            id: f.user_id,
            name: profileById.get(f.user_id).full_name,
            email: profileById.get(f.user_id).email,
          }
        : null,
    })),
    unavailable: null,
  };
}

export interface JobRunSummary {
  job: string;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastDurationMs: number | null;
  lastRowsAffected: number | null;
  lastError: string | null;
  runs24h: number;
  failures24h: number;
}

/** The jobs that should be running, whether or not they ever have. */
const KNOWN_JOBS = ["archive-old-photos", "purge-trash"] as const;

/**
 * Cron health.
 *
 * Listing `KNOWN_JOBS` rather than only the jobs with rows is the whole point:
 * a job that has never written a row is exactly the failure this page exists to
 * surface, and one that renders an empty table says nothing at all.
 */
export async function listJobRunsService(
  ctx: AuthedContext,
): Promise<{ jobs: JobRunSummary[]; unavailable: string | null }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await (admin as any)
    .from("job_runs")
    .select("job, started_at, finished_at, ok, rows_affected, error")
    .order("started_at", { ascending: false })
    .limit(500);

  if (error) {
    if (isMissingTable(error)) {
      return {
        jobs: [],
        unavailable:
          "Run supabase/migrations/20260822140000_admin_observability.sql - the job_runs table is not in this database yet.",
      };
    }
    throw new Error(error.message);
  }

  const list = (rows as any[]) ?? [];
  const names = Array.from(new Set([...KNOWN_JOBS, ...list.map((r) => r.job as string)]));

  return {
    jobs: names.map((job) => {
      const runs = list.filter((r) => r.job === job);
      const last = runs[0];
      const recent = runs.filter((r) => r.started_at >= since);
      return {
        job,
        lastRunAt: last?.started_at ?? null,
        lastOk: last ? (last.ok ?? null) : null,
        lastDurationMs:
          last?.finished_at && last?.started_at
            ? new Date(last.finished_at).getTime() - new Date(last.started_at).getTime()
            : null,
        lastRowsAffected: last?.rows_affected ?? null,
        lastError: last?.error ?? null,
        runs24h: recent.length,
        failures24h: recent.filter((r) => r.ok === false).length,
      };
    }),
    unavailable: null,
  };
}
