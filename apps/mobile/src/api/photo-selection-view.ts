import { sanitizeCaption } from "@everlumen/shared";
import type { ReportSection, SectionPhoto } from "./report-builder-view";

/**
 * The rules behind the bulk bar's hand-over actions, kept free of React Native
 * so they can be tested: share links, filing photos into a report, and saving
 * them to the phone.
 *
 * Every rule here is the web bulk bar's (`PhotoBulkActionBar.tsx`), so a
 * selection does the same thing whichever device made it.
 */

/**
 * The most photos one share can mint links for.
 *
 * Each photo gets its own `photo_shares` row, as on the web, so the number is
 * the number of separate links a recipient is sent. Past forty a report is the
 * better way to hand the set over, and the web says so at the same count.
 */
export const SHARE_LINK_LIMIT = 40;

export function shareLinkRefusal(count: number): string | null {
  if (count <= 0) return "Pick at least one photo to share.";
  if (count > SHARE_LINK_LIMIT) {
    return `That is ${count} separate links. Narrow the selection to ${SHARE_LINK_LIMIT} or fewer, or build a report to hand over the whole set at once.`;
  }
  return null;
}

/** One link per line, the text the web's Copy button puts on the clipboard. */
export function shareLinksMessage(links: readonly string[]): string {
  return links.join("\n");
}

/** What to say when some links were made and some were not. */
export function shareLinksShortfall(made: number, total: number): string | null {
  if (made === 0) return "Could not create any share links.";
  if (made < total) return `${made} of ${total} links were created. The rest failed.`;
  return null;
}

/**
 * Reports and documents belong to one job.
 *
 * The library can select across jobs; the web disables Report and Generate for
 * such a selection, and the phone says why instead of greying the button out.
 */
export function singleProjectRefusal(projectIds: readonly string[]): string | null {
  const distinct = new Set(projectIds.filter(Boolean));
  if (distinct.size === 0) return "Pick at least one photo first.";
  if (distinct.size > 1) {
    return "These photos are from more than one project. Narrow the selection to one to build a report or a document.";
  }
  return null;
}

/** The heading attached photos are filed under. Renameable in the builder. */
export const ATTACHED_SECTION_TITLE = "Photos";

export type AttachablePhoto = { id: string; caption: string | null };

/** The section entries for a set of photos, captions cleaned as the web does. */
export function sectionPhotosFor(photos: readonly AttachablePhoto[]): SectionPhoto[] {
  return photos.map((p) => ({ photo_id: p.id, caption: sanitizeCaption(p.caption) }));
}

/**
 * How a selection is filed into an EXISTING report, as the web does it.
 *
 * One new section at the end, not one per few photos: the report paginates at
 * its own photos-per-page. Photos already anywhere in the report are skipped,
 * because a photo filed twice renders twice in the PDF. A second drop is
 * titled "Photos 2", then "Photos 3", so it does not collide with the first.
 */
export function planPhotoDrop(
  existing: readonly Pick<ReportSection, "title" | "position" | "photos">[],
  selected: readonly AttachablePhoto[],
): { fresh: AttachablePhoto[]; skipped: number; title: string; position: number } {
  const already = new Set<string>();
  for (const section of existing) {
    for (const photo of section.photos ?? []) if (photo?.photo_id) already.add(photo.photo_id);
  }
  const fresh = selected.filter((p) => !already.has(p.id));
  const priorDrops = existing.filter((s) => /^Photos( \d+)?$/.test(String(s.title ?? ""))).length;
  const title = priorDrops === 0 ? ATTACHED_SECTION_TITLE : `Photos ${priorDrops + 1}`;
  const position = existing.reduce((max, s) => Math.max(max, Number(s.position) || 0), -1) + 1;
  return { fresh, skipped: selected.length - fresh.length, title, position };
}

export function photoDropMessage(added: number, skipped: number): string {
  const lead = `${added} photo${added === 1 ? "" : "s"} added to the report.`;
  if (!skipped) return lead;
  return `${lead} ${skipped} ${skipped === 1 ? "was" : "were"} already in it, so ${
    skipped === 1 ? "it was" : "they were"
  } skipped.`;
}

/**
 * The most photos one Save to phone goes through.
 *
 * Each one is downloaded at full size and written to the gallery in turn, so
 * the cap is about how long a person will hold the screen open: a whole job is
 * better handed over as a zip, which is what the refusal points at.
 */
export const SAVE_TO_PHONE_LIMIT = 200;

export function saveToPhoneRefusal(count: number): string | null {
  if (count <= 0) return "Pick at least one photo to save.";
  if (count > SAVE_TO_PHONE_LIMIT) {
    return `Save up to ${SAVE_TO_PHONE_LIMIT} photos at a time. For more, use Download zip, which keeps them together as one file.`;
  }
  return null;
}

/** The line under the progress bar while photos are being saved. */
export function saveProgressLabel(done: number, total: number): string {
  return `Saving ${Math.min(done + 1, total)} of ${total}`;
}

/**
 * What to say when the phone will not let the app add photos.
 *
 * `blocked` is a refusal the system will not ask about again, so the only way
 * forward is Settings, and the message names where in it to look.
 */
export function savePermissionMessage(state: "denied" | "blocked", platform: string): string {
  const where =
    platform === "ios"
      ? 'In Settings, open Everlumen, then Photos, and choose "Add Photos Only" or "Full Access".'
      : "In Settings, open Apps, then Everlumen, then Permissions, and allow Photos and videos.";
  return state === "blocked"
    ? `Everlumen is not allowed to add photos to this phone. ${where}`
    : `Everlumen needs your permission to add photos to this phone. Try again and allow it, or change it in Settings. ${where}`;
}

/** The gallery album saved photos are filed in, where the phone allows it. */
export const PHONE_ALBUM = "Everlumen";

export type SaveOutcome = {
  saved: number;
  failed: number;
  total: number;
  cancelled: boolean;
  /** Whether the photos went into the app's own album as well as the library. */
  inAlbum: boolean;
};

/** Where the photos went, said once the run is over. */
export function saveResultMessage({ saved, failed, total, cancelled, inAlbum }: SaveOutcome): {
  title: string;
  body: string;
} {
  const photos = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;
  const where = inAlbum ? `the ${PHONE_ALBUM} album in your photos` : "your photos";
  if (saved === 0) {
    return {
      title: cancelled ? "Stopped" : "Nothing was saved",
      body: cancelled
        ? "No photos were saved."
        : "The photos could not be downloaded. Check the connection and try again.",
    };
  }
  const lead = `${photos(saved)} saved to ${where}.`;
  if (cancelled) {
    const rest = total - saved - failed;
    return {
      title: "Stopped",
      body: rest > 0 ? `${lead} The other ${rest} ${rest === 1 ? "was" : "were"} not.` : lead,
    };
  }
  if (failed > 0) {
    return {
      title: "Saved, with gaps",
      body: `${lead} ${photos(failed)} could not be downloaded.`,
    };
  }
  return { title: "Saved", body: lead };
}

/** A file name for a downloaded photo, which the gallery keeps as its title. */
export function savedPhotoFileName(photo: { id: string; storage_path: string }): string {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(photo.storage_path)?.[1]?.toLowerCase() ?? "jpg";
  return `photo-${photo.id.slice(0, 8)}.${ext}`;
}
