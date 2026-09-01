/**
 * Who else is being told about a task.
 *
 * A watcher gets an email and a notification when the task moves. That makes
 * this a rule about interrupting people, which is why it is import-free and
 * tested rather than inline in a screen.
 *
 * It also holds `commentAuthor`, because the two share a correction: the task
 * collaboration payload is camelCase throughout, and the phone was reading
 * snake_case. Comments rendered with a fallback name and a blank timestamp;
 * watchers were typed `unknown[]` and dropped entirely. Both are the same
 * mistake, so both are named here where a test can see them.
 */

/** Mirrors `TaskWatcher` in the service. Field names are the server's. */
export type WatcherLike = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl?: string | null;
};

/**
 * Somebody who could be added. The mention roster, reused.
 *
 * Loose on purpose, and `addableWatchers` is generic over it: the caller passes
 * its own richer member type and gets that type back, rather than having it
 * widened to this one and then failing to satisfy the roster helpers it is
 * handed on to.
 */
export type CandidateLike = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
};

/**
 * How a watcher is named.
 *
 * Falls back to the email rather than to "Teammate" where it can, because the
 * question being answered is "who is getting mailed about this", and an address
 * answers it where a placeholder does not.
 *
 * Deliberately the WHOLE address, unlike every other name in the app, which now
 * shows only the handle so it fits a row title. Here the domain is the
 * informative half: it is how you tell a colleague from a subcontractor you are
 * about to copy in. Do not "make this consistent".
 */
export function watcherName(watcher: WatcherLike): string {
  return watcher.fullName?.trim() || watcher.email?.trim() || "Teammate";
}

/**
 * How a comment signs itself.
 *
 * From the comment's own fields rather than from a roster lookup. The service
 * joins `profiles` and sends the name outright, and a lookup fails for anybody
 * who has since left the team - which is exactly whose old comments are most
 * likely to be sitting in a long thread.
 */
export function commentAuthor(comment: {
  authorName: string | null;
  authorEmail: string | null;
}): string {
  return comment.authorName?.trim() || comment.authorEmail?.trim() || "Someone";
}

/**
 * Who is worth offering to add.
 *
 * Anyone already watching is filtered out, and so is the caller. Both would be
 * accepted by the server - the upsert ignores duplicates and a self-watch is
 * legal - but offering an action that visibly does nothing is worse than not
 * offering it.
 */
export function addableWatchers<T extends CandidateLike>(
  candidates: T[],
  watching: WatcherLike[],
  selfId: string | null,
): T[] {
  const already = new Set(watching.map((w) => w.userId));
  return candidates.filter((c) => c.user_id !== selfId && !already.has(c.user_id));
}

/**
 * The line under the section heading.
 *
 * Says what watching MEANS rather than counting, because the count is already
 * on the heading and "nobody is watching" is not the useful half. What somebody
 * needs to know before adding a colleague is that it mails them.
 */
export function watcherSummary(watching: WatcherLike[]): string {
  if (watching.length === 0) return "Nobody is being told when this task moves.";
  const names = watching.map(watcherName);
  if (names.length === 1) return `${names[0]} is told when this task moves.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are told when this task moves.`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more are told when this task moves.`;
}

/** What the confirmation says before somebody is looped in. */
export function addWarning(names: string[]): string {
  if (names.length === 1) return `${names[0]} will be emailed when this task changes.`;
  return `${names.length} people will be emailed when this task changes.`;
}

/**
 * Watchers in a stable, readable order.
 *
 * Alphabetical rather than by when they were added: the list is read to answer
 * "is so-and-so on this", and scanning for a name is what alphabetical is for.
 */
export function sortedWatchers<T extends WatcherLike>(watching: T[]): T[] {
  return [...watching].sort((a, b) => watcherName(a).localeCompare(watcherName(b)));
}

/**
 * Whether to offer a delete on this task comment.
 *
 * Author only, matching the RLS policy exactly. An admin sees no delete because
 * an admin pressing it would get a silent no-op: a delete that matches no row
 * is not an error, so a button offered on somebody else's comment would appear
 * to work and change nothing.
 */
export function canDeleteTaskComment(
  comment: { authorId: string },
  userId: string | null,
): boolean {
  return Boolean(userId) && comment.authorId === userId;
}
