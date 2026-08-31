/**
 * What to show when the database refuses a comment write.
 *
 * `createPhotoCommentService` threw `new Error(error.message)`, so Postgres's
 * own words went to the phone and rendered in red under the composer:
 *
 *     new row violates row-level security policy for table "photo_comments"
 *
 * Accurate, unreadable, and it names a table. A crew member cannot act on it,
 * and it is exactly the raw identifiers on screen the client has objected to
 * before. Worse, it reads as the app being broken: the button looks dead,
 * because nothing in that sentence says "you do not have access to this job".
 *
 * An allow-list, not a filter, for the reason `taskPhotoItemErrorMessage`
 * spells out: asking whether a message *looks* like Postgres internals leaks by
 * default, and no list of Postgres phrasings is ever finished. An unrecognised
 * refusal gets a plain sentence. That is a worse message, never a leak.
 */
const FRIENDLY_BY_CODE: Record<string, string> = {
  /*
   * RLS. The insert policy requires the writer to be a teammate of whoever
   * created the job, so this is what a collaborator who was removed from it
   * gets, and what anybody gets on a job whose `created_by` is not set.
   */
  "42501":
    "You do not have access to comment on this job. Ask whoever owns it to share it with you.",
  // The photo or the job went while the screen was open: deleted, or purged
  // out of the trash by the nightly sweep.
  "23503": "That photo is no longer on this job. Go back and open it again.",
  "23514": "That comment could not be saved as written.",
};

export function photoCommentErrorMessage(
  error: { message?: string; code?: string } | null | undefined,
): string {
  const code = String(error?.code ?? "");
  return FRIENDLY_BY_CODE[code] ?? "Could not post that comment. Try again in a moment.";
}

/** The same, for removing one: the only refusal worth naming is "not yours". */
export function photoCommentDeleteErrorMessage(
  error: { message?: string; code?: string } | null | undefined,
): string {
  const code = String(error?.code ?? "");
  if (code === "42501") return "You can only delete comments you wrote.";
  return "Could not delete that comment. Try again in a moment.";
}

/** And for reading them, where there is nothing the reader can do but retry. */
export function photoCommentListErrorMessage(
  error: { message?: string; code?: string } | null | undefined,
): string {
  const code = String(error?.code ?? "");
  if (code === "42501") return "You do not have access to this job any more.";
  return "Could not load the comments. Pull down to try again.";
}
