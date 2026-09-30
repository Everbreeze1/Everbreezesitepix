import { supabase } from "@/lib/supabase";
import { createPhotoShareToken, publicUrl } from "./sharing";
import { normaliseSectionPhotos } from "./report-builder-view";
import {
  planPhotoDrop,
  sectionPhotosFor,
  shareLinkRefusal,
  type AttachablePhoto,
} from "./photo-selection-view";

/**
 * What the bulk bar does with a selection that is not a patch: hand the photos
 * over. Links or a report here; the phone's own gallery and a zip are
 * `photo-download.ts`.
 *
 * None of it is queued. A link or a report section only means something once
 * it exists on the server, so each of these runs now and says so when it
 * cannot.
 */

/**
 * One public link per photo, the web's `BulkShareDialog`.
 *
 * `createPhotoShare` with no expiry and downloads allowed, the terms every
 * other share in the product uses. One photo failing is not the batch
 * failing: the links that were made are still returned, with a count of the
 * rest.
 */
export async function createSelectionShareLinks(
  photoIds: readonly string[],
  onProgress?: (done: number) => void,
): Promise<{ links: string[]; failed: number }> {
  const refusal = shareLinkRefusal(photoIds.length);
  if (refusal) throw new Error(refusal);
  const links: string[] = [];
  let failed = 0;
  let done = 0;
  for (const id of photoIds) {
    try {
      const url = publicUrl("photos", await createPhotoShareToken(id, 0, true));
      if (url) links.push(url);
      else failed += 1;
    } catch {
      failed += 1;
    }
    done += 1;
    onProgress?.(done);
  }
  return { links, failed };
}

/**
 * File a selection into a report that already exists, as one new section.
 *
 * The web's `AddToReportDialog`, the same RLS read and insert. The rules for
 * skipping duplicates and naming the section are `planPhotoDrop`.
 */
export async function addPhotosToExistingReport(
  reportId: string,
  photos: readonly AttachablePhoto[],
): Promise<{ added: number; skipped: number }> {
  const { data, error } = await supabase
    .from("project_report_sections")
    .select("id, position, title, photos")
    .eq("report_id", reportId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);

  const existing = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    title: String(row.title ?? ""),
    position: Number(row.position) || 0,
    photos: normaliseSectionPhotos(row.photos),
  }));
  const plan = planPhotoDrop(existing, photos);
  if (plan.fresh.length === 0) return { added: 0, skipped: plan.skipped };

  const { error: insertError } = await supabase.from("project_report_sections").insert({
    report_id: reportId,
    position: plan.position,
    title: plan.title,
    body: null,
    photos: sectionPhotosFor(plan.fresh),
  } as never);
  if (insertError) throw new Error(insertError.message);
  return { added: plan.fresh.length, skipped: plan.skipped };
}
