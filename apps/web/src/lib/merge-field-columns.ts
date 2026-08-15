import { toast } from "sonner";

/**
 * Columns that back document merge fields and arrive in
 * `supabase/migrations/20260823000000_project_client_fields.sql`.
 *
 * Migrations in this repo are applied by hand against the live database, so
 * there is a window where this code is deployed and the columns are not there
 * yet. In that window a write naming them fails with SQLSTATE 42703 - and it
 * fails as a whole, so editing a project's NAME, or saving your own display
 * name, would break because of a column the user never touched.
 *
 * `writeWithNewColumns` retries without them and says so, which keeps the rest
 * of each form working until the SQL is run.
 *
 * Delete this file, and the retries at its call sites, once the migration is
 * applied everywhere.
 */
export const PROJECT_CLIENT_KEYS = ["client_name", "client_contact", "project_number"] as const;
export const PROFILE_JOB_KEYS = ["job_title"] as const;

/** True when Postgres says the column is simply not there. */
export function isMissingColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  return e.code === "42703" || /column .* does not exist/i.test(e.message ?? "");
}

/** The same row without the columns a pre-migration database has never seen. */
export function withoutColumns<T extends Record<string, unknown>>(
  row: T,
  keys: readonly string[],
): T {
  const out = { ...row };
  for (const key of keys) delete out[key];
  return out;
}

/**
 * Runs a write, and retries it without `keys` if the database predates them.
 *
 * The warning is deliberate rather than silent: the user typed a value and it
 * did not save, so telling them beats letting them find out later in a document
 * that still asks for it.
 */
export async function writeWithNewColumns<R extends { error: { message?: string } | null }>(
  row: Record<string, unknown>,
  keys: readonly string[],
  // PromiseLike, not Promise: Supabase's query builder is a thenable, so it
  // satisfies `await` without being an actual Promise. The whole result is
  // handed back, so a caller that needs `data` (an insert ... returning) gets it.
  write: (row: Record<string, unknown>) => PromiseLike<R>,
  warning: string,
): Promise<R> {
  const first = await write(row);
  if (!isMissingColumn(first.error)) return first;

  const retried = await write(withoutColumns(row, keys));
  if (!retried.error) {
    toast.warning(warning, {
      description: "This workspace's database has not been updated for that field yet.",
    });
  }
  return retried;
}
