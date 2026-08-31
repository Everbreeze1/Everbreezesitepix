import { randomUUID } from "expo-crypto";
import { api, webAppUrl } from "@/lib/api";
import type { MentionMember } from "./task-mentions";

/**
 * Task conversation.
 *
 * All through `/v1/rpc`. Comments fan out into notifications and mentions, and
 * `docs/data-access.md` puts anything with that reach behind the API rather
 * than client RLS.
 */

/**
 * Mirrors `TaskComment` in `apps/api/src/domains/tasks/service.ts`.
 *
 * **These were snake_case and the service sends camelCase**, which is the most
 * repeated mistake in this port and the quietest: `comment.author_id` on a
 * payload carrying `authorId` is `undefined`, not an error. The thread rendered
 * every comment with a fallback author name and a blank timestamp, because
 * `relativeTime(undefined)` returns an empty string rather than throwing.
 *
 * The service also sends the author's name and avatar outright, so the screen
 * no longer needs to look them up in a roster that may not contain somebody who
 * has since left the team.
 */
export type TaskComment = {
  id: string;
  taskId: string;
  projectId: string;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
};

/**
 * Somebody looped in on a task.
 *
 * Same correction as above: this was snake_case against a camelCase payload.
 * It went unnoticed because nothing rendered watchers at all - the screen typed
 * them `unknown[]` and dropped them - so the wrong field names cost nothing
 * until the moment they were read.
 */
export type TaskWatcher = {
  userId: string;
  addedBy: string | null;
  createdAt: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type TaskCollaboration = {
  comments: TaskComment[];
  watchers: TaskWatcher[];
};

export async function listTaskCollaboration(taskId: string): Promise<TaskCollaboration> {
  const result = await api.rpc<Partial<TaskCollaboration>>("listTaskCollaboration", { taskId });
  return {
    comments: result?.comments ?? [],
    watchers: result?.watchers ?? [],
  };
}

export async function createTaskComment(input: {
  taskId: string;
  body: string;
  mentions: string[];
}): Promise<TaskComment | null> {
  const result = await api.rpc<{ comment?: TaskComment }>(
    "createTaskComment",
    {
      taskId: input.taskId,
      body: input.body,
      mentions: input.mentions,
    },
    /*
     * The op is marked idempotent, and it needs to be: a comment retried after
     * a dropped response would otherwise post twice and notify everyone it
     * mentions twice.
     */
    { idempotencyKey: randomUUID() },
  );
  return result?.comment ?? null;
}

/** Teammates on this project, used for the mention picker. */
export async function getProjectContributors(projectId: string): Promise<MentionMember[]> {
  const result = await api.rpc<{ contributors?: MentionMember[] } | MentionMember[]>(
    "getProjectContributors",
    { projectId },
  );

  if (Array.isArray(result)) return result;
  return result?.contributors ?? [];
}

/**
 * Loop people in on a task.
 *
 * Takes a list rather than one id, matching the service: the surface that needs
 * it most is "everyone with the Manager role", and one request per person would
 * fire one email each with no way to tell a batch from a series of accidents.
 *
 * Adding somebody already watching is a no-op rather than an error - the upsert
 * ignores duplicates - so this is safe to press twice, and the second press
 * notifies nobody because no row is inserted and the trigger never fires.
 */
export async function addTaskWatchers(taskId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await api.rpc("addTaskWatchers", {
    taskId,
    userIds,
    /*
     * The origin the emailed links point at, which is the WEB app rather than
     * the API. Sending the wrong one here would mail somebody a link into a
     * host that serves no pages. Omitted entirely when unset, because the
     * schema takes a URL and the server has its own default.
     */
    ...(webAppUrl ? { origin: webAppUrl } : {}),
  });
}

export async function removeTaskWatcher(taskId: string, userId: string): Promise<void> {
  await api.rpc("removeTaskWatcher", { taskId, userId });
}
