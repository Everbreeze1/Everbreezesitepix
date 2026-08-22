/**
 * True when a PostgREST failure means "this table isn't in this database".
 *
 * Lifted out of combineProjectsService, which learned it the hard way: the check
 * there was originally `message.includes("does not exist")`, which never matches
 * what PostgREST actually returns - a missing table comes back as PGRST205
 * "Could not find the table 'public.x' in the schema cache", not as a Postgres
 * 42P01. The guard therefore never fired.
 *
 * It matters because this codebase genuinely runs against databases missing
 * tables that exist in the migration folder - see the header of
 * 20260811001000_schema_drift_repair.sql. Callers use this to degrade a
 * not-provisioned feature into a reported "unavailable" state rather than either
 * crashing or, worse, rendering it as empty.
 */
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /could not find the table|does not exist/i.test(error.message ?? "")
  );
}

/**
 * True when a PostgREST failure means "this COLUMN isn't in this database".
 *
 * The sibling of `isMissingTable`, and it matters for the same reason: code and
 * migrations do not deploy atomically here, so a build can reach production
 * before the SQL that its new columns depend on. PostgREST answers PGRST204
 * ("Could not find the 'x' column of 'y' in the schema cache") and rejects the
 * WHOLE statement, so one new column in a select list takes the entire query
 * down, and one new column in an insert loses the whole row.
 *
 * Callers use this to retry without the not-yet-existing column, so a feature
 * that depends on a pending migration degrades to its old behaviour instead of
 * breaking a screen that already worked.
 */
export function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /could not find the .* column|column .* does not exist/i.test(error.message ?? "")
  );
}

/**
 * Remove the characters that act as wildcards in a PostgREST `like`/`ilike`.
 *
 * `%` and `_` reach SQL LIKE as wildcards and `*` is PostgREST's own alias for
 * `%`, so a search box that passes them through means a term of "100%" quietly
 * matches everything beginning "100". They are stripped rather than
 * backslash-escaped because PostgREST does not pass an ESCAPE clause through,
 * so a literal `\%` would match a backslash as well.
 *
 * Safe on any filter, including the single-filter `.ilike()` builder, which
 * needs no quoting because the client encodes it.
 */
export function stripLikeWildcards(value: string): string {
  return value.replace(/[%_*]/g, "");
}

/**
 * Escape a user-supplied string for use as a value inside a PostgREST filter,
 * specifically the comma-separated expression `.or()` takes.
 *
 * `.or("name.ilike.%foo%,email.ilike.%foo%")` is a *parsed* expression, not a
 * parameterised query: PostgREST splits it on commas and parentheses. So a
 * search box that interpolates the raw term is one comma away from either a
 * 400 or a filter that means something the caller never asked for - a user
 * searching for "Smith, John" got neither an error they could act on nor the
 * right rows.
 *
 * Two things are needed and neither is optional:
 *
 * 1. Wrap the value in double quotes. That is PostgREST's own mechanism for a
 *    value containing reserved characters, and it is what makes a comma inert.
 *    Backslashes and quotes inside must then be backslash-escaped, or the
 *    closing quote can be moved by the input.
 * 2. Neutralise the LIKE wildcards first, which `stripLikeWildcards` above
 *    does and explains.
 *
 * The caller adds its own surrounding `%` for the contains match.
 */
export function escapeFilterValue(value: string): string {
  const escaped = stripLikeWildcards(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** `escapeFilterValue` wrapped in the `%...%` a contains-search wants. */
export function escapeLikeValue(value: string): string {
  const escaped = stripLikeWildcards(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"%${escaped}%"`;
}

/**
 * True when a PostgREST failure means "this FUNCTION isn't in this database".
 *
 * The third sibling of `isMissingTable`/`isMissingColumn`, and it exists for the
 * same deployment reality: SQL in this repo is applied by hand in the Supabase
 * SQL editor, so a build that calls a new `rpc()` reliably reaches production
 * before the migration declaring it does. Callers use this to fall back to the
 * old query path rather than showing an operator an error they cannot act on.
 */
export function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|function .* does not exist/i.test(error.message ?? "")
  );
}
