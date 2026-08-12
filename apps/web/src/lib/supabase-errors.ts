/**
 * Turn a Supabase/Postgres exception into something a crew can act on.
 *
 * The runners used to echo `e?.message` straight into a toast, so a policy
 * rejection reached someone standing on a roof as
 * `new row violates row-level security policy for table "photos"`. Raw driver
 * text is for the console; this is for the person holding the phone.
 */
export function friendlyError(e: unknown, fallback: string): string {
  const msg = String((e as { message?: unknown } | null)?.message ?? "");
  if (/row-level security|permission denied|not authorized/i.test(msg))
    return "You don't have permission to do that on this project";
  if (/duplicate key|already exists/i.test(msg)) return "That already exists";
  if (/violates foreign key/i.test(msg))
    return "Something it depends on was removed — refresh and try again";
  if (/fetch|network|timeout|offline/i.test(msg)) return "No connection — try again in a moment";
  if (/payload too large|exceeded the maximum/i.test(msg)) return "That file is too large";
  return fallback;
}

/**
 * Whether a query failed because the database is behind the code.
 *
 * Migrations here are applied by hand — every file in `supabase/migrations`
 * carries a header saying to run `supabase db push` or paste it into the SQL
 * editor — so there is a real window between pulling a branch and applying it
 * where a `select` names a column that does not exist yet. PostgREST answers
 * `42703` (undefined_column) and supabase-js hands it back as an ordinary error,
 * indistinguishable from a network failure to the caller.
 *
 * Without this check a whole panel renders "you may be offline. Nothing has been
 * lost — try again once you have a connection", and the retry button can never
 * succeed. The one thing that would fix it — running a migration — is the one
 * thing the message does not mention.
 */
export function isPendingMigrationError(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown } | null;
  const code = String(err?.code ?? "");
  // 42703 undefined_column, 42P01 undefined_table.
  if (code === "42703" || code === "42P01") return true;
  return /column .*does not exist|relation .*does not exist/i.test(String(err?.message ?? ""));
}
