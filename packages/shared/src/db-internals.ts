/**
 * Whether a message is the database talking to a developer.
 *
 * The last branch of `jsonFromUnknownError` forwards the message of any error
 * that carries no status, and about a hundred services do
 * `throw new Error(error.message)` with a PostgrestError. So Postgres's own
 * words reached customers. Seen on a phone, under the comment composer, in red:
 *
 *     new row violates row-level security policy for table "photo_comments"
 *
 * This is a filter, not an allow-list, and the repo argues elsewhere - in
 * `taskPhotoItemErrorMessage` - that filters leak by default. That argument is
 * right and it does not apply here, because here the default is already to leak
 * everything. An allow-list at this level would mean opting in every message the
 * codebase has ever written for a person, and the ~100 that are good copy
 * ("Choose at least one project for this subcontractor.") would all collapse to
 * a generic line. That trades a leak for a hundred regressions.
 *
 * So: catch what is recognisably Postgres, leave prose alone. A shape not listed
 * here still gets through, which is why the real fix stays per-domain - see
 * `photoCommentErrorMessage` - and this is the floor under it.
 */
const DATABASE_INTERNALS = [
  /row-level security/i,
  /violates .*constraint/i,
  /violates row-level/i,
  /relation "[^"]*" does not exist/i,
  /column "[^"]*" (of relation |does not exist)/i,
  /invalid input syntax for type/i,
  /duplicate key value/i,
  /permission denied for (table|relation|schema|function)/i,
  /null value in column "[^"]*"/i,
  /^\s*\d{5}:/,
  /JWT|PGRST\d+/,
];

export function readsAsDatabaseInternals(message: string): boolean {
  return DATABASE_INTERNALS.some((pattern) => pattern.test(message));
}
