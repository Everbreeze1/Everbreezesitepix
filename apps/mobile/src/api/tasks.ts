import { supabase } from "@/lib/supabase";
import type { TaskPriority, TaskStatus } from "./task-status";

/**
 * Project tasks.
 *
 * Read and progress only. Creating, assigning, and re-prioritising are manager
 * actions that belong on the web board; what the field needs is to see what is
 * outstanding on this job and move it along.
 */

export type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  completed_at: string | null;
  assignee_user_id: string | null;
  assignee_email: string | null;
  position: number;
  updated_at: string;
};

const TASK_FIELDS =
  "id, project_id, title, description, status, priority, due_date, completed_at, assignee_user_id, assignee_email, position, updated_at";

export async function listProjectTasks(projectId: string): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_FIELDS)
    .eq("project_id", projectId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data as TaskRow[]) ?? [];
}

export async function applyTaskPatch(
  taskId: string,
  patch: { status: TaskStatus; completed_at: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update(patch as never)
    .eq("id", taskId);
  /*
   * The completion trigger raises the sentence that should be shown, so the
   * message is passed through rather than replaced with a generic one. It
   * already explains who is allowed to mark the task done.
   */
  if (error) throw new Error(error.message);
}

export type { TaskPriority, TaskStatus };
