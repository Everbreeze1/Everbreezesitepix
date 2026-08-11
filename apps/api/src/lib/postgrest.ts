/**
 * True when a PostgREST failure means "this table isn't in this database".
 *
 * Lifted out of combineProjectsService, which learned it the hard way: the check
 * there was originally `message.includes("does not exist")`, which never matches
 * what PostgREST actually returns — a missing table comes back as PGRST205
 * "Could not find the table 'public.x' in the schema cache", not as a Postgres
 * 42P01. The guard therefore never fired.
 *
 * It matters because this codebase genuinely runs against databases missing
 * tables that exist in the migration folder — see the header of
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
