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
