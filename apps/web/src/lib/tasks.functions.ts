import { rpcOp } from "./sitepix-api";
import type { TaskComment, TaskWatcher } from "@sitepix/api";

export type { TaskComment, TaskWatcher };

/**
 * The parts of a task the browser cannot do for itself.
 *
 * The task row is still written straight through the Supabase client, the way
 * it always has been - these six exist because a browser cannot send email,
 * cannot read a teammate's address (`profiles` RLS is own-row), and has no
 * grant on `notifications.emailed_at`.
 */

export const listTaskCollaboration = rpcOp<
  { taskId: string },
  { comments: TaskComment[]; watchers: TaskWatcher[] }
>("listTaskCollaboration");

export const createTaskComment = rpcOp<
  { taskId: string; body: string; mentions?: string[]; origin?: string },
  { comment: TaskComment }
>("createTaskComment", { idempotent: true });

export const deleteTaskComment = rpcOp<{ commentId: string }, { ok: true }>("deleteTaskComment");

export const addTaskWatchers = rpcOp<
  { taskId: string; userIds: string[]; origin?: string },
  { ok: true }
>("addTaskWatchers");

export const removeTaskWatcher = rpcOp<{ taskId: string; userId: string }, { ok: true }>(
  "removeTaskWatcher",
);

/**
 * "This task just moved - send whatever that owes."
 *
 * Called after an assignment, a reassignment or a completion. It does not say
 * who to mail: the triggers have already written the notification rows, and the
 * server delivers exactly those. Safe to call twice - `emailed_at` makes the
 * second call a no-op.
 *
 * Every caller fires it without awaiting the result and swallows the error. A
 * mail provider having a bad minute must not turn a saved assignment into a red
 * toast, and the in-app notification is in the bell either way.
 */
export const dispatchTaskNotifications = rpcOp<
  { taskId: string; origin?: string },
  { sent: number }
>("dispatchTaskNotifications");

/** The origin to hand the server, so a preview deployment links back to itself. */
export function appOrigin(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.origin;
}

/**
 * Fire-and-forget delivery for a task that just changed.
 *
 * One helper rather than four copies of the same `.catch(() => {})`, and one
 * place to look when asking "does this write notify anybody".
 */
export function notifyTaskChanged(taskId: string): void {
  void dispatchTaskNotifications({ data: { taskId, origin: appOrigin() } }).catch(() => {});
}
