/**
 * Asking the assistant.
 *
 * Import-free so the rules can be tested, and two of them are worth testing:
 * what counts as a sendable message, and how a conversation gets its name. The
 * second matters more than it sounds - a list of threads all called "Untitled"
 * is a list nobody opens twice.
 */

/** A turn in the conversation. Field names are the `messages` table's. */
export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

/** A saved thread. Field names are the `conversations` table's. */
export type Conversation = {
  id: string;
  title: string;
  updated_at: string;
};

/** The server's own ceiling, mirrored so the composer can refuse first. */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * How long the server lets a derived title be.
 *
 * `data.title ?? data.message.slice(0, 60)` in `chatWithAssistantService`. The
 * column takes 120, but a title the server derived is 60, so a client sending
 * its own should not quietly produce longer ones than the same thread would
 * have got by saying nothing.
 */
export const TITLE_LENGTH = 60;

/** Why this cannot be sent, or null. Mirrors the registry's inline schema. */
export function messageError(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return "Ask something first.";
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return `That is ${trimmed.length - MAX_MESSAGE_LENGTH} characters too long.`;
  }
  return null;
}

/**
 * A thread name derived from the first thing asked.
 *
 * The server would do this itself with a bare `slice(0, 60)`, which cuts
 * mid-word. Sending a tidier one costs nothing and is the difference between a
 * list of readable threads and a list of truncated fragments.
 */
export function derivedTitle(message: string): string {
  const text = message.trim().replace(/\s+/g, " ");
  if (!text) return "New question";
  if (text.length <= TITLE_LENGTH) return text;
  const cut = text.slice(0, TITLE_LENGTH);
  const space = cut.lastIndexOf(" ");
  // Cut on a word boundary where there is a sensible one, otherwise take the
  // hard slice rather than returning something absurdly short.
  return (space > TITLE_LENGTH / 2 ? cut.slice(0, space) : cut).trim();
}

/** Whether this turn came from the person or the assistant. */
export function isFromUser(message: { role: string }): boolean {
  return message.role === "user";
}

/**
 * Oldest first, which is how a conversation reads.
 *
 * Ordered here rather than trusted from the query, because the optimistic turn
 * added while a reply is in flight has a timestamp minted on the device and
 * would otherwise sort against timestamps minted on the server.
 */
export function inOrder<T extends { created_at: string }>(messages: T[]): T[] {
  return [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

/**
 * What to say when the assistant is unavailable.
 *
 * Gemini is geo-blocked on some networks, so a failure in the field is a real
 * condition rather than a bug, and it deserves wording that does not send
 * somebody hunting for a fault in the app. The provider's own message is passed
 * through when there is one, because "quota exceeded" and "blocked in your
 * region" call for completely different responses from the person reading it.
 */
export function assistantFailure(message: string | null): string {
  if (!message) return "The assistant could not answer. It may not be reachable from here.";
  if (/not configured/i.test(message)) return "The assistant is not set up for this workspace.";
  if (/pro feature|upgrade to pro/i.test(message)) return message;
  return message;
}

/**
 * Whether a failure is worth offering a retry for.
 *
 * A misconfiguration and a plan refusal will fail identically every time, and a
 * retry button on those is a button that wastes somebody's time twice.
 */
export function canRetry(message: string | null): boolean {
  if (!message) return true;
  return !/not configured|pro feature|upgrade to pro/i.test(message);
}

/** The subtitle over the thread. */
export function threadSummary(messages: ChatMessage[]): string {
  const asked = messages.filter(isFromUser).length;
  if (asked === 0) return "Ask about a job, a part, or what to check next";
  return `${asked} question${asked === 1 ? "" : "s"} in this thread`;
}
