import { randomUUID } from "expo-crypto";
import { api } from "@/lib/api";
import type { MentionMember } from "./task-mentions";

/**
 * Task conversation.
 *
 * All through `/v1/rpc`. Comments fan out into notifications and mentions, and
 * `docs/data-access.md` puts anything with that reach behind the API rather
 * than client RLS.
 */

export type TaskComment = {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  mentions: string[];
  created_at: string;
};

export type TaskWatcher = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
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
