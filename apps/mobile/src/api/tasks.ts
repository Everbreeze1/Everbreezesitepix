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
  /** Photos the task covers. A plain uuid[] with no uniqueness behind it. */
  photo_ids: string[] | null;
  position: number;
  updated_at: string;
};

const TASK_FIELDS =
  "id, project_id, title, description, status, priority, due_date, completed_at, assignee_user_id, assignee_email, photo_ids, position, updated_at";

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

/** The fields a person can set on a task from the phone. */
export type TaskDraft = {
  title: string;
  description: string | null;
  priority: TaskPriority;
  due_date: string | null;
  assignee_user_id: string | null;
  assignee_email: string | null;
};

export type CreateTaskInput = TaskDraft & {
  /** Generated on the device so the optimistic row and the server row share an id. */
  id: string;
  projectId: string;
  createdBy: string;
};

/**
 * Insert a task the phone invented.
 *
 * The id is supplied by the caller rather than left to the column default, and
 * that is what makes this safe to retry. A queued create that was interrupted
 * after the insert landed but before the app heard back would otherwise be sent
 * again and produce a second identical task, which is the exact duplication the
 * photo path solved with `uploadId`. Same trick here: look for the row first,
 * and treat finding it as success.
 *
 * `priority` is typed to the four values the CHECK constraint in
 * `20260618220000` allows. Web shipped a quick-add that sent "medium" for a
 * while and every insert was refused by the database, so the type is doing real
 * work rather than documenting.
 */
export async function createTask(input: CreateTaskInput): Promise<void> {
  const existing = await supabase.from("tasks").select("id").eq("id", input.id).maybeSingle();
  if (existing.data) return;

  const { error } = await supabase.from("tasks").insert({
    id: input.id,
    project_id: input.projectId,
    created_by: input.createdBy,
    title: input.title,
    description: input.description,
    assignee_user_id: input.assignee_user_id,
    assignee_email: input.assignee_email,
    due_date: input.due_date,
    priority: input.priority,
    status: "open",
    completed_at: null,
    photo_ids: [],
  } as never);

  if (error) throw new Error(error.message);
}

/**
 * Save an edit to an existing task.
 *
 * Deliberately separate from `applyTaskPatch`, which only ever moves status and
 * `completed_at`. Folding the two together would mean a queued status change
 * and a queued edit could overwrite each other's fields, because each write
 * carries the whole patch it was given.
 */
export async function applyTaskEdit(taskId: string, draft: TaskDraft): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update(draft as never)
    .eq("id", taskId);

  if (error) throw new Error(error.message);
}
