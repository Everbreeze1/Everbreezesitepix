import { applyItemPatch, attachPhotoToItem } from "@/api/checklists";
import { uploadProjectPhoto, type PhotoPhase } from "@/api/photos";
import type { Coords } from "@/api/photo-meta";
import { applyPhotoPatch, type PhotoPatch } from "@/api/photo-edit";
import { applyProjectPatch } from "@/api/projects";
import { saveSiteLog } from "@/api/site-logs";
import { setTaskPhotoStatus } from "@/api/task-photos";
import type { ProjectPatch } from "@/api/project-patch";
import {
  applyTaskEdit,
  applyTaskPatch,
  createTask,
  type CreateTaskInput,
  type TaskDraft,
} from "@/api/tasks";
import { applyPhasePatch, applyWorkflowItemPatch } from "@/api/workflows";
import { isCompletionRefusal, type TaskStatus } from "@/api/task-status";
import type { OutboxKind, OutboxRow } from "./outbox";
import { completeSessionPhoto } from "./capture-session";

/**
 * What each queued row actually does when its turn comes.
 *
 * Handlers receive the row rather than a parsed payload so they can use the row
 * id, which is what makes a send repeatable.
 */

export class PermanentError extends Error {}

export type PhotoUploadPayload = {
  userId: string;
  projectId: string;
  /**
   * The capture session this shot belongs to.
   *
   * Carried so the Daily Log can be written up when the session finishes, which
   * on a phone is when the queue finishes rather than when the camera closes.
   * Optional because rows queued by a build older than this one do not have it,
   * and those still have to drain.
   */
  captureSessionId?: string | null;
  /**
   * Checklist item this capture is evidence for.
   *
   * The link is made here rather than at capture time because the photo has no
   * id until the upload lands. Queuing the capture and the link separately
   * would mean the link row could be attempted first and fail against a photo
   * that does not exist yet.
   */
  attachToChecklistItemId?: string | null;
  /**
   * Workflow photo step this capture satisfies.
   *
   * Same reasoning as the checklist link: the step is marked complete by
   * writing `photo_id`, and the photo has no id until its upload lands.
   */
  attachToWorkflowItemId?: string | null;
  width?: number | null;
  height?: number | null;
  exif?: Record<string, unknown> | null;
  phase?: PhotoPhase;
  tags?: string[];
  caption?: string;
  deviceCoords?: Coords | null;
  projectCoords?: Coords | null;
};

/**
 * Errors that retrying cannot fix.
 *
 * Signal problems deserve patience. A row-level security refusal, a project
 * that was deleted, or a malformed payload will fail identically in an hour, so
 * retrying only hides the real reason behind a queue that never empties.
 */
function classify(message: string): boolean {
  const lower = message.toLowerCase();
  /*
   * The completion trigger refuses anyone who is not the assignee, the
   * assigner, or a manager. That is a rule the queue cannot outlast, and the
   * sentence it raises is the explanation the user needs to see.
   */
  if (isCompletionRefusal(message)) return true;
  return (
    lower.includes("row-level security") ||
    lower.includes("violates foreign key") ||
    lower.includes("permission denied") ||
    lower.includes("jwt") ||
    lower.includes("no longer on the device") ||
    lower.includes("invalid input syntax")
  );
}

export function isPermanent(error: unknown): boolean {
  if (error instanceof PermanentError) return true;
  return error instanceof Error ? classify(error.message) : false;
}

export type ChecklistItemPatchPayload = {
  itemId: string;
  patch: Record<string, unknown>;
};

/**
 * Row id for a checklist edit, keyed by item *and* by which field is written.
 *
 * Deterministic per field, so a second answer while the first is still queued
 * replaces it rather than queueing behind it: someone correcting a tap should
 * produce one write carrying the final answer, not a queue of every value the
 * item passed through.
 *
 * The field is part of the key because an answer and a note are two different
 * writes to the same row. Sharing one id would mean typing a note discards a
 * queued answer, or the reverse, with no sign that anything was lost.
 */
export function checklistItemRowId(itemId: string, field: "answer" | "notes"): string {
  return `checklist_item_patch:${itemId}:${field}`;
}

export type TaskPatchPayload = {
  taskId: string;
  patch: { status: TaskStatus; completed_at: string | null };
};

/** Row id for a task status change, deterministic per task. */
export type ProjectPatchPayload = {
  projectId: string;
  patch: ProjectPatch;
};

/**
 * One queue row per project per field being written.
 *
 * Keyed on the field so a star toggled twice replaces its own row rather than
 * stacking, while an edit to the name and a change of status stay independent
 * and both land.
 */
export function projectPatchRowId(field: string, projectId: string): string {
  return `project-patch:${field}:${projectId}`;
}

/**
 * A site log edit, queued.
 *
 * Idempotent for the same reason `project_patch` is: the patch carries the
 * WHOLE value of every field it writes - the notes object entire, not a
 * delta - so replaying it lands on the same row content rather than compounding.
 *
 * This one matters more than most. A site log is the technician's own record of
 * a day, written on the job, and the job is where there is no signal. It went
 * unqueued only because the module mirrored what the web does, where an
 * unreachable server is a broken page rather than a normal Tuesday.
 */
export type SiteLogPatchPayload = {
  logId: string;
  patch: { title?: string; photo_ids?: string[]; notes?: Record<string, unknown> };
};

/**
 * One queue row per log per field.
 *
 * Keyed like the project patch: retyping a title replaces its own row instead
 * of stacking, while a note added to a photograph queues separately and both
 * still land.
 */
export function siteLogPatchRowId(field: string, logId: string): string {
  return `site-log-patch:${field}:${logId}`;
}

/**
 * Ticking one photograph off a task, queued.
 *
 * Naturally idempotent rather than made so: the write is an upsert on
 * `(task_id, photo_id)` carrying the whole row, so replaying it lands on the
 * same state. `completed_at` and `completed_by` are stamped by a trigger and
 * never sent, which is also what makes a late replay honest - the timestamp is
 * when the server recorded it, not when the phone guessed.
 *
 * Queued because this is the most on-site act in the app after taking the
 * photograph: somebody is standing in front of the thing, deciding it is done.
 */
export type TaskPhotoPatchPayload = {
  taskId: string;
  photoId: string;
  status: "open" | "done";
};

/**
 * One queue row per photograph per task.
 *
 * Ticking and unticking the same photo replaces its own row, so the last state
 * the person chose is the one that lands - rather than a tick and an untick
 * both queueing and racing.
 */
export function taskPhotoRowId(taskId: string, photoId: string): string {
  return `task-photo:${taskId}:${photoId}`;
}

export type PhotoPatchPayload = {
  photoIds: string[];
  patch: PhotoPatch;
};

/**
 * One queue row per bulk action, keyed by what it does and to what.
 *
 * Not keyed on the photo ids alone: tagging a set and then trashing the same
 * set are two different intents that must both land, in order. Keyed on the
 * field being written, so correcting a phase replaces the queued phase write
 * rather than stacking a second one behind it.
 */
export function photoPatchRowId(field: string, photoIds: string[]): string {
  return `photo-patch:${field}:${photoIds.join(",")}`;
}

export type TaskCreatePayload = {
  input: CreateTaskInput;
};

export type TaskEditPayload = {
  taskId: string;
  draft: TaskDraft;
};

/**
 * The queue row id for a create.
 *
 * Keyed on the task id the device generated, so a create that is edited again
 * before it drains replaces its own queued row instead of stacking a second
 * insert behind the first.
 */
export function taskCreateRowId(taskId: string): string {
  return `task-create:${taskId}`;
}

/** Separate from the status row, so an edit and a status change cannot clobber each other. */
export function taskEditRowId(taskId: string): string {
  return `task-edit:${taskId}`;
}

export function taskRowId(taskId: string): string {
  return `task_patch:${taskId}`;
}

export type WorkflowItemPatchPayload = {
  itemId: string;
  patch: Record<string, unknown>;
};

export type WorkflowPhasePatchPayload = {
  phaseId: string;
  patch: Record<string, unknown>;
};

/** Row ids for workflow writes, deterministic per row so edits supersede. */
export function workflowItemRowId(itemId: string): string {
  return `workflow_item_patch:${itemId}`;
}

/**
 * Row id for a phase write, keyed by phase *and* by which field is being
 * written.
 *
 * A single id per phase looked tidy and was wrong: sign-off and the phase note
 * are two different writes to the same row, so sharing an id means saving a
 * note replaces a queued signature, or the other way round, and one of them is
 * silently lost. Separate lanes keep the supersede behaviour within a field,
 * where it is wanted, and out of it, where it is not.
 */
export function workflowPhaseRowId(phaseId: string, field: "signoff" | "notes"): string {
  return `workflow_phase_patch:${phaseId}:${field}`;
}

type Handler = (row: OutboxRow) => Promise<void>;

const handlers: Record<OutboxKind, Handler> = {
  photo_upload: async (row) => {
    const payload = JSON.parse(row.payload) as PhotoUploadPayload;

    if (!row.local_uri) {
      throw new PermanentError("Queued photo has no file on this device");
    }

    const uploaded = await uploadProjectPhoto({
      userId: payload.userId,
      projectId: payload.projectId,
      asset: {
        uri: row.local_uri,
        width: payload.width,
        height: payload.height,
        exif: payload.exif,
      },
      phase: payload.phase,
      tags: payload.tags,
      caption: payload.caption,
      deviceCoords: payload.deviceCoords,
      projectCoords: payload.projectCoords,
      // The row id is the idempotency key: same key, same storage path, same
      // duplicate check, so a repeat of a half-finished send converges.
      uploadId: row.id,
    });

    // The photo has an id for the first time here, which is the only moment the
    // Daily Log's record of this session can be completed.
    if (payload.captureSessionId) {
      await completeSessionPhoto(row.id, uploaded.id).catch(() => {
        // A log that does not get written is a worse outcome than a photo that
        // does not get delivered, but only just: never fail the upload for it.
      });
    }

    if (payload.attachToChecklistItemId) {
      await attachPhotoToItem(payload.attachToChecklistItemId, uploaded.id, payload.userId);
    }

    if (payload.attachToWorkflowItemId) {
      // Writing `photo_id` is what completes a photo step, so this single
      // update both attaches the evidence and closes the item.
      await applyWorkflowItemPatch(payload.attachToWorkflowItemId, {
        photo_id: uploaded.id,
        completed_at: new Date().toISOString(),
        completed_by: payload.userId,
      });
    }
  },

  checklist_item_patch: async (row) => {
    const payload = JSON.parse(row.payload) as ChecklistItemPatchPayload;
    /*
     * Naturally idempotent: the patch carries the whole answer, so applying it
     * twice lands on the same value. That is why this kind needs no equivalent
     * of the photo path's duplicate check.
     */
    await applyItemPatch(payload.itemId, payload.patch);
  },

  workflow_item_patch: async (row) => {
    const payload = JSON.parse(row.payload) as WorkflowItemPatchPayload;
    await applyWorkflowItemPatch(payload.itemId, payload.patch);
  },

  workflow_phase_patch: async (row) => {
    const payload = JSON.parse(row.payload) as WorkflowPhasePatchPayload;
    await applyPhasePatch(payload.phaseId, payload.patch);
  },

  task_photo_patch: async (row) => {
    const payload = JSON.parse(row.payload) as TaskPhotoPatchPayload;
    await setTaskPhotoStatus(payload.taskId, payload.photoId, payload.status);
  },

  site_log_patch: async (row) => {
    const payload = JSON.parse(row.payload) as SiteLogPatchPayload;
    // Idempotent: the patch carries the whole value for every column it sets.
    await saveSiteLog(payload.logId, payload.patch as never);
  },

  project_patch: async (row) => {
    const payload = JSON.parse(row.payload) as ProjectPatchPayload;
    // Idempotent: the patch carries the whole value for every column it sets.
    await applyProjectPatch(payload.projectId, payload.patch);
  },

  photo_patch: async (row) => {
    const payload = JSON.parse(row.payload) as PhotoPatchPayload;
    // Idempotent: the patch carries the whole value for every column it sets,
    // so replaying it lands on the same result.
    await applyPhotoPatch(payload.photoIds, payload.patch);
  },

  task_create: async (row) => {
    const payload = JSON.parse(row.payload) as TaskCreatePayload;
    // Idempotent because the id travels in the payload: see createTask.
    await createTask(payload.input);
  },

  task_edit: async (row) => {
    const payload = JSON.parse(row.payload) as TaskEditPayload;
    // Carries the whole draft, so replaying it lands on the same values.
    await applyTaskEdit(payload.taskId, payload.draft);
  },

  task_patch: async (row) => {
    const payload = JSON.parse(row.payload) as TaskPatchPayload;
    // Idempotent for the same reason as a checklist patch: the write carries
    // the whole state, so repeating it lands on the same value.
    await applyTaskPatch(payload.taskId, payload.patch);
  },
};

export function handlerFor(kind: OutboxKind): Handler | null {
  return handlers[kind] ?? null;
}
