/**
 * Who a comment actually mentions.
 *
 * Import-free so the rules can be tested directly. They match
 * `apps/web/src/features/projects/components/TaskCollaboration.tsx`, because a
 * mention writes a notification: if the two clients disagreed about who is
 * named, the same sentence would notify different people depending on which app
 * typed it.
 */

export type MentionMember = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

/**
 * The handle typed after the `@`.
 *
 * First name, or the local part of the email when there is no name. Matches
 * web exactly.
 *
 * Handles are not unique: two teammates called Dana produce the same handle,
 * and both are notified by a message naming it. That is web's behaviour too,
 * and copying it is deliberate. Making mobile pick one of the two would mean a
 * comment notifies a different person depending on where it was written, which
 * is worse than notifying one teammate too many.
 */
export function mentionHandle(member: Pick<MentionMember, "full_name" | "email">): string {
  const name = member.full_name?.trim() || member.email?.split("@")[0] || "teammate";
  return name.split(/\s+/)[0];
}

/**
 * The `@` query the caret is sitting in, or null.
 *
 * Read from the text before the cursor, not the whole draft, so going back to
 * fix a word mid-sentence does not reopen the picker on an `@handle` typed
 * earlier.
 */
export function mentionQueryAt(draft: string, cursor: number): string | null {
  const match = draft.slice(0, Math.max(0, cursor)).match(/(?:^|\s)@([\w.-]*)$/);
  return match ? match[1].toLowerCase() : null;
}

/** Replace the partial `@handle` before the cursor with a chosen member's. */
export function applyMention(
  draft: string,
  cursor: number,
  member: MentionMember,
): { text: string; cursor: number } {
  const handle = mentionHandle(member);
  const before = draft.slice(0, cursor).replace(/@[\w.-]*$/, `@${handle} `);
  return { text: before + draft.slice(cursor), cursor: before.length };
}

/** Members whose handle matches what is being typed, excluding the author. */
export function mentionMatches(
  members: MentionMember[],
  query: string | null,
  currentUserId: string | null,
  limit = 6,
): MentionMember[] {
  if (query === null) return [];
  return members
    .filter((member) => member.user_id !== currentUserId)
    .filter((member) => !query || mentionHandle(member).toLowerCase().includes(query))
    .slice(0, limit);
}

/**
 * The ids to send as `mentions`.
 *
 * Only people still named in the finished message. Picking a handle from the
 * list and then deleting the text would otherwise notify somebody whose name is
 * nowhere in what was sent: a "mentioned you" pointing at a sentence that does
 * not mention them.
 */
export function resolveMentions(
  body: string,
  picked: Iterable<string>,
  members: MentionMember[],
): string[] {
  const byId = new Map(members.map((member) => [member.user_id, member]));
  return [...picked].filter((id) => {
    const member = byId.get(id);
    return member ? body.includes(`@${mentionHandle(member)}`) : false;
  });
}

/** Display name for a teammate, for the picker and the comment header. */
export function memberLabel(member: MentionMember | undefined | null): string {
  if (!member) return "Someone";
  return member.full_name?.trim() || member.email || "Someone";
}
