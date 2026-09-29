import type { PhotoPhase } from "../api/photos";
import { phasePatch, type PhotoPatch } from "../api/photo-patch";

/**
 * The camera's rules for each shot, free of React and native imports so they
 * can be tested directly.
 *
 * WHY PER SHOT
 *
 * The phase used to be one value for the whole batch, read when Save was
 * pressed. A technician who took a Before shot, flipped the toggle to After
 * and took an After shot then saved both under whichever side the toggle was
 * left on, so a before/after pair came out as two Befores (Jon, 2026-09-29).
 * Each shot now carries the phase that was selected at the moment its shutter
 * fired.
 *
 * WHY NO SAVE STEP
 *
 * The batch and its review screen are gone too (Jon, 2026-09-29): its
 * batch-wide Before/Untagged/After row relabelled every photo the same, and a
 * photo was not on the timeline until Save. Every shot is now queued the
 * moment it is taken, with its own phase, caption and tags, and can be
 * retagged on its own afterwards, never all at once.
 */

/** What a shot needs for these rules. */
export type PhasedShot = { phase?: PhotoPhase; scan?: boolean };

/** The tag a Scan mode capture is filed under, so scans can be found later. */
export const SCAN_TAG = "scan";

/** How many recent shots the camera keeps to hand for retagging. */
export const RECENT_MAX = 60;

/**
 * The phase a new shot is stamped with, read when the shutter is pressed.
 *
 * Only Before/After mode tags a shot; every other mode is untagged whatever
 * the toggle last said. A scan never carries a before/after pill.
 */
export function phaseAtShutter(mode: string, selected: PhotoPhase, scan = false): PhotoPhase {
  if (scan) return "untagged";
  return mode === "before-after" ? selected : "untagged";
}

/** The phase a shot is saved with. Rows from before this field read as untagged. */
export function shotPhase(shot: PhasedShot): PhotoPhase {
  if (shot.scan) return "untagged";
  return shot.phase ?? "untagged";
}

/** The pill burnt into a shot's picture, if any. A scan never has one. */
export function pillOf(shot: PhasedShot): "before" | "after" | null {
  const phase = shotPhase(shot);
  return phase === "before" || phase === "after" ? phase : null;
}

/** Whether a retag changes the picture itself (its pill), not only the row. */
export function pillChanged(before: PhasedShot, after: PhasedShot): boolean {
  return pillOf(before) !== pillOf(after);
}

/**
 * The caption and tags set on the camera for the shots that follow. Sticky
 * until cleared, and shown on the camera whenever either is set.
 */
export type CaptureNote = { caption: string; tags: string[] };

export const EMPTY_NOTE: CaptureNote = { caption: "", tags: [] };

export function noteIsActive(note: CaptureNote): boolean {
  return note.caption.trim().length > 0 || note.tags.length > 0;
}

/**
 * The camera pill's words for an active note: the caption, cut short, and how
 * many tags ride with it. Null when nothing is set.
 */
export function noteSummary(note: CaptureNote, maxLength = 18): string | null {
  const caption = note.caption.trim().replace(/\s+/g, " ");
  const short =
    caption.length > maxLength ? `${caption.slice(0, maxLength - 1).trimEnd()}...` : caption;
  const count = note.tags.length;
  if (short && count) return `${short} +${count} tag${count === 1 ? "" : "s"}`;
  if (short) return short;
  if (count === 1) return note.tags[0];
  if (count > 1) return `${count} tags`;
  return null;
}

/** A new shot's own caption and tags, copied from the camera's note. */
export function metaForNewShot(
  note: CaptureNote,
  scan: boolean,
): { caption: string; tags: string[] } {
  return {
    caption: note.caption.trim(),
    tags: uniqueTags([...note.tags, ...(scan ? [SCAN_TAG] : [])]),
  };
}

/** A shot's own record, as the camera keeps it. */
export type ShotMeta = PhasedShot & { caption: string; tags: string[] };

/**
 * The fields of a queued `photo_upload` payload a retag rewrites, while the
 * upload has not gone yet. An empty caption is left out, so the upload falls
 * back to its dated default as it always has.
 */
export function queuedMetaPatch(shot: ShotMeta): {
  phase: PhotoPhase;
  tags: string[];
  caption: string | undefined;
} {
  const caption = shot.caption.trim();
  return { phase: shotPhase(shot), tags: uniqueTags(shot.tags), caption: caption || undefined };
}

/**
 * The same retag as a patch on a photo that has landed. Carries every column
 * it sets, so replaying it lands on the same row. `untagged` is stored as
 * null, as every other phase write does (`phasePatch`).
 */
export function uploadedMetaPatch(shot: ShotMeta): PhotoPatch {
  const caption = shot.caption.trim();
  return {
    ...phasePatch(shotPhase(shot)),
    tags: uniqueTags(shot.tags),
    caption: caption || null,
  };
}

/** Put a new shot first, keeping at most `max`. */
export function addRecent<T extends { id: string }>(list: T[], shot: T, max = RECENT_MAX): T[] {
  return [shot, ...list.filter((item) => item.id !== shot.id)].slice(0, max);
}

/** Change one shot, leaving every other shot exactly as it was. */
export function patchRecent<T extends { id: string }>(
  list: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return list.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}
