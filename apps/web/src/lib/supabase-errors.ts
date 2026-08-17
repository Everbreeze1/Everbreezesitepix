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
    return "Something it depends on was removed - refresh and try again";
  if (/fetch|network|timeout|offline/i.test(msg)) return "No connection - try again in a moment";
  if (/payload too large|exceeded the maximum/i.test(msg)) return "That file is too large";
  return fallback;
}

/**
 * Whether a query failed because the database is behind the code.
 *
 * Migrations here are applied by hand - every file in `supabase/migrations`
 * carries a header saying to run `supabase db push` or paste it into the SQL
 * editor - so there is a real window between pulling a branch and applying it
 * where a `select` names a column that does not exist yet. PostgREST answers
 * `42703` (undefined_column) and supabase-js hands it back as an ordinary error,
 * indistinguishable from a network failure to the caller.
 *
 * Without this check a whole panel renders "you may be offline. Nothing has been
 * lost - try again once you have a connection", and the retry button can never
 * succeed. The one thing that would fix it - running a migration - is the one
 * thing the message does not mention.
 */
export function isPendingMigrationError(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown } | null;
  const code = String(err?.code ?? "");
  /*
   * Two families, and only knowing one of them is how this check quietly stopped
   * working.
   *
   * Postgres raises 42703 undefined_column and 42P01 undefined_table, and older
   * PostgREST passed both straight through with a `... does not exist` sentence -
   * which is what the regex below was written against.
   *
   * Current PostgREST answers from its own schema cache instead and never reaches
   * Postgres: an unknown table is PGRST205, `Could not find the table 'public.x' in
   * the schema cache`, and an unknown column in a write payload is PGRST204. Both
   * mean exactly "the database is behind the code", and neither says "does not
   * exist" nor carries a Postgres SQLSTATE - so on any current Supabase project a
   * missing table fell through to the offline panel, telling the user to check
   * their connection and offering a retry that could never succeed. Which is the
   * precise failure this function exists to prevent.
   */
  if (code === "42703" || code === "42P01" || code === "PGRST205" || code === "PGRST204") {
    return true;
  }
  return /column .*does not exist|relation .*does not exist|in the schema cache/i.test(
    String(err?.message ?? ""),
  );
}
