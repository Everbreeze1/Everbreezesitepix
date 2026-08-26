import { applyItemPatch } from "@/api/checklists";
import { uploadProjectPhoto, type PhotoPhase } from "@/api/photos";
import type { Coords } from "@/api/photo-meta";
import type { OutboxKind, OutboxRow } from "./outbox";

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
 * Row id for a checklist edit.
 *
 * Deterministic per item, so a second answer while the first is still queued
 * replaces it rather than queueing behind it. Someone correcting a tap should
 * produce one write carrying the final answer, not a queue of every value the
 * item passed through on the way there.
 */
export function checklistItemRowId(itemId: string): string {
  return `checklist_item_patch:${itemId}`;
}

type Handler = (row: OutboxRow) => Promise<void>;

const handlers: Record<OutboxKind, Handler> = {
  photo_upload: async (row) => {
    const payload = JSON.parse(row.payload) as PhotoUploadPayload;

    if (!row.local_uri) {
      throw new PermanentError("Queued photo has no file on this device");
    }

    await uploadProjectPhoto({
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
};

export function handlerFor(kind: OutboxKind): Handler | null {
  return handlers[kind] ?? null;
}
