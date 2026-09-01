import { personName } from "@everlumen/shared";
/**
 * Talking about one photograph.
 *
 * Import-free so every rule below is testable, which matters more here than
 * usual because two of them decide who gets notified. A mention is a push to
 * somebody's phone, and getting it wrong is not a cosmetic bug: it either
 * interrupts the wrong person or silently fails to reach the one who was asked
 * a question.
 *
 * The server contract is `apps/api/src/domains/photos/comments.ts`. It takes a
 * body and an explicit array of user ids to notify; it does not parse the text
 * itself. So deciding what goes in that array is entirely the client's job,
 * which is why it lives here and is tested rather than sitting inline in a
 * screen.
 */

/** Mirrors `PhotoComment` in the service. Field names are the server's. */
export type PhotoComment = {
  id: string;
  photoId: string;
  projectId: string;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
};

/** Somebody who can be mentioned: a teammate on the project. */
export type Mentionable = {
  userId: string;
  fullName: string | null;
  email: string | null;
};

/** A mention chosen from the picker, held until the comment is sent. */
export type PendingMention = { userId: string; handle: string };

/** The server's own ceiling, mirrored so the composer can say so first. */
export const MAX_COMMENT_LENGTH = 4000;

/**
 * What an `@` is allowed to be followed by.
 *
 * Unicode-aware rather than `\w`, which is ASCII only: a crew with a Jimenez or
 * a Nowak spelled properly would otherwise have their handle cut in half at the
 * accent, and the mention would neither highlight nor resolve. Apostrophes and
 * hyphens are in because O'Brien and Anne-Marie are names.
 */
const HANDLE_CHARS = "\\p{L}\\p{N}._'-";
const TRAILING_HANDLE_RE = new RegExp(`(?:^|\\s)@([${HANDLE_CHARS}]*)$`, "u");

/** A fresh matcher each time: a shared global regex carries `lastIndex`. */
function handlePattern(): RegExp {
  return new RegExp(`@[${HANDLE_CHARS}]+`, "gu");
}

function stripToHandle(value: string): string {
  return value.replace(new RegExp(`[^${HANDLE_CHARS}]`, "gu"), "");
}

/**
 * The single word that follows the `@`.
 *
 * One word, because a mention has to be typed and read inline: "@Sam Whitfield"
 * would need the highlighter to know where a name ends, and where a name ends
 * is not something you can work out by looking. Matches the web, so the same
 * person is `@Sam` in both places.
 */
export function mentionHandle(person: Mentionable): string {
  const name = (person.fullName ?? "").trim();
  if (name) {
    // Stripped back to what the handle pattern would match, so inserting a
    // handle and then looking for it again cannot disagree.
    const cleaned = stripToHandle(name.split(/\s+/)[0]);
    if (cleaned) return cleaned;
  }
  const email = (person.email ?? "").trim();
  if (email) {
    const local = stripToHandle(email.split("@")[0]);
    if (local) return local;
  }
  return "teammate";
}

/**
 * How a comment signs itself.
 *
 * Same fallback ORDER the server uses - a typed name, then the address, then
 * "Someone" - but the address is reduced to its handle, which the server's own
 * copy does not do. That is deliberate and the shapes are different: the server
 * builds notification prose ("marklagura223@gmail.com commented on your
 * photo"), which has room, while this is a byline on a card next to a timestamp
 * and a delete button. At that width the full address truncated to
 * "marklagura223@gmail..." - long enough to fill the row and too short to say
 * who wrote it.
 *
 * Same reasoning, and the same helper, as the team roster and the
 * subcontractor list.
 */
export function authorLabel(comment: {
  authorName: string | null;
  authorEmail: string | null;
}): string {
  return personName(comment.authorName, comment.authorEmail, "Someone");
}

/**
 * Why this cannot be sent, or null.
 *
 * Deliberately the same two bounds the server enforces (`min(1).max(4000)` on
 * the trimmed string), because a client that allowed more would turn a long
 * note into a validation error from a server the person cannot see.
 */
export function commentError(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return "Write something first.";
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return `That is ${trimmed.length - MAX_COMMENT_LENGTH} characters too long.`;
  }
  return null;
}

/**
 * The handle being typed right now, or null when the caret is not in one.
 *
 * Returns an empty string for a bare `@`, which is not the same as null: a bare
 * `@` should open the picker showing everybody, and null should close it.
 */
export function mentionQuery(text: string, cursor: number): string | null {
  const upto = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const match = TRAILING_HANDLE_RE.exec(upto);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Who the picker offers.
 *
 * Never yourself: the server drops a self-mention before notifying, so offering
 * it is offering something that does nothing. Capped because the picker sits
 * above the keyboard, and a long list would cover the comment being written.
 */
export function mentionCandidates(
  people: Mentionable[],
  query: string | null,
  selfId: string | null,
  limit = 6,
): Mentionable[] {
  if (query === null) return [];
  const needle = query.toLowerCase();
  return people
    .filter((person) => person.userId !== selfId)
    .filter((person) => {
      if (!needle) return true;
      const haystack = `${person.fullName ?? ""} ${person.email ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, limit);
}

/**
 * Replace the half-typed handle at the caret with a complete one.
 *
 * Returns the new caret position as well, so the screen can put it after the
 * inserted space rather than leaving it wherever the re-render decided. Typing
 * on a phone is fiddly enough without the caret jumping to the end of the line.
 */
export function withMention(
  text: string,
  cursor: number,
  handle: string,
): { text: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  /*
   * The trailing space is what lets the next word be typed straight away, but
   * only when there is not already one waiting. Completing `@sa` in the middle
   * of "@sa can you check" would otherwise leave "@Sam  can", a double space
   * that nobody typed and everybody notices.
   */
  const trailer = /^\s/.test(after) ? "" : " ";
  const replaced = before.replace(new RegExp(`@[${HANDLE_CHARS}]*$`, "u"), `@${handle}${trailer}`);
  /*
   * No partial handle at the caret means the picker was opened some other way,
   * so the handle is inserted rather than substituted. The leading space is
   * conditional for the same reason: without the check, tapping a name as the
   * first thing you do gives a comment that starts with a space.
   */
  const spacer = before.length === 0 || /\s$/.test(before) ? "" : " ";
  const head = replaced === before ? `${before}${spacer}@${handle}${trailer}` : replaced;
  return { text: head + after, cursor: head.length };
}

/**
 * Who to actually notify.
 *
 * **This is the rule the web version gets wrong**, and the reason it is a
 * function rather than a `Set` the composer appends to. There, choosing a name
 * from the picker adds an id that is never removed: delete the `@Sam` you just
 * inserted, or rewrite the sentence without it, and Sam is still notified about
 * a comment that does not mention him. The notification and the text disagree,
 * and the only person who ever finds out is the one interrupted by it.
 *
 * So the selection is intersected with the text at send time. Somebody is
 * mentioned when they were picked AND their handle is still written. That also
 * settles two teammates sharing a first name without notifying the wrong one:
 * only an id actually chosen from the picker is eligible, so `@Sam` reaches the
 * Sam who was selected rather than both of them.
 *
 * Typing `@Sam` by hand without going through the picker notifies nobody, which
 * is the right way round: a silent no-op is recoverable by writing it again,
 * and guessing which Sam was meant is not.
 */
export function mentionsInBody(body: string, pending: PendingMention[]): string[] {
  if (pending.length === 0) return [];
  const written = new Set(
    (body.match(handlePattern()) ?? []).map((raw) => raw.slice(1).toLowerCase()),
  );
  if (written.size === 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (const mention of pending) {
    if (!written.has(mention.handle.toLowerCase())) continue;
    if (seen.has(mention.userId)) continue;
    seen.add(mention.userId);
    out.push(mention.userId);
  }
  return out;
}

/** One run of comment text, flagged when it is a mention. For highlighting. */
export type BodySegment = { text: string; mention: boolean };

/**
 * Split a body so the mentions in it can be drawn differently.
 *
 * Presentational only, and knowingly loose: it highlights anything shaped like
 * a handle rather than only the ids that were notified, because the alternative
 * is a comment where `@Sam` renders as plain text and the writer assumes it
 * failed. The array that decides notifications is `mentions`, not this.
 */
export function bodySegments(body: string): BodySegment[] {
  const out: BodySegment[] = [];
  let index = 0;
  const pattern = handlePattern();
  let match = pattern.exec(body);
  while (match) {
    if (match.index > index) out.push({ text: body.slice(index, match.index), mention: false });
    out.push({ text: match[0], mention: true });
    index = match.index + match[0].length;
    match = pattern.exec(body);
  }
  if (index < body.length) out.push({ text: body.slice(index), mention: false });
  return out.length > 0 ? out : [{ text: body, mention: false }];
}

/**
 * Whether to offer a delete on this comment.
 *
 * Author only, and that is the database's answer rather than a guess: the
 * policy is "Authors delete own comments" with `author_id = auth.uid()`, in
 * `supabase/migrations/20260703230955_photo_comments.sql`. An admin sees no
 * delete because an admin pressing it would get a silent no-op from RLS, and a
 * button that does nothing is worse than no button at all.
 */
export function canDeleteComment(comment: { authorId: string }, userId: string | null): boolean {
  return Boolean(userId) && comment.authorId === userId;
}

/** The subtitle under the screen title. */
export function commentsSummary(count: number): string {
  if (count === 0) return "No comments yet";
  return `${count} comment${count === 1 ? "" : "s"}`;
}
