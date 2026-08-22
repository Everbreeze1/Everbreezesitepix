import { getSupabaseAdmin } from "./supabase";

/**
 * Record that a scheduled job ran, and how it went.
 *
 * The cron hooks left no trace whatsoever. `purge-trash` in particular spent a
 * long stretch reporting `ok: true, photosPurged: 0` while the chunking bug
 * meant it deleted nothing at all (see the comment in purge-trash.ts) - a job
 * that looks healthy while doing nothing, and no history anyone could have
 * looked at to notice. A schedule that silently stops firing has the same
 * shape: no error, no alert, no row.
 *
 * Best-effort in both directions. A logging failure must not fail the job it is
 * recording, and a database without `job_runs` yet - the table arrives with
 * 20260822140000_admin_observability.sql, applied by hand - must not turn every
 * cron invocation into a 500. Both are swallowed.
 */
export async function recordJobRun<T>(
  job: string,
  run: () => Promise<{ result: T; rowsAffected?: number; meta?: Record<string, unknown> }>,
): Promise<T> {
  const admin = getSupabaseAdmin();
  const startedAt = new Date().toISOString();

  try {
    const { result, rowsAffected, meta } = await run();
    void writeRow(admin, {
      job,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: true,
      rows_affected: rowsAffected ?? null,
      error: null,
      meta: meta ?? null,
    });
    return result;
  } catch (e: any) {
    // Written before the rethrow, so a job that dies still leaves the row that
    // says it died - which is the case this whole table exists for.
    void writeRow(admin, {
      job,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: false,
      rows_affected: null,
      error: String(e?.message ?? e).slice(0, 2000),
      meta: null,
    });
    throw e;
  }
}

async function writeRow(
  admin: ReturnType<typeof getSupabaseAdmin>,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await (admin as any).from("job_runs").insert(row);
  } catch {
    // Swallow - see the contract above.
  }
}
