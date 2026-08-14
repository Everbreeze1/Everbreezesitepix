// Keeps a generated report's section list from paginating into one photo per
// page.
//
// Sections are pages: `planSectionPages` gives every section its own page for
// the body and then batches that section's photos `photosPerPage` at a time.
// That rule is fine for a report someone wrote. It is ruinous for a report a
// model wrote, because the model's instinct is one section per photo - eight
// photos came back as eight headings holding one photo each, and the client
// received eight sheets with a single picture on them however the density was
// set. The setting was not being ignored; there was never more than one photo
// in a batch to begin with.
//
// The prompt asks for grouped sections. This is the guard for when it does not
// comply, and it is deliberately structural rather than cosmetic: a section
// thinner than the requested density is folded into the photo section before
// it, keeping its heading as an <h3> inside the merged body so no wording the
// model produced is lost.

/** A section on its way into `project_report_sections`, before it has an id. */
export interface DraftReportSection<P> {
  title: string;
  body: string;
  photos: P[];
}

/**
 * How many photo-bearing sections a generated report may carry.
 *
 * Four is the point past which a walkthrough report stops reading as a document
 * with a structure and starts reading as a list of headings. Narrative sections
 * (Introduction, Conclusion) hold no photos and are never counted or merged.
 */
export const MAX_AUTO_REPORT_PHOTO_SECTIONS = 4;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function countPhotoSections<P>(sections: DraftReportSection<P>[]): number {
  return sections.reduce((n, s) => n + (s.photos.length > 0 ? 1 : 0), 0);
}

/**
 * Indices that can be folded into the section immediately before them.
 *
 * Adjacency is required. Merging a photo section into a distant one would pull
 * its photos back past whatever narrative sits between them, which silently
 * reorders the document - the photos would end up under a heading that was
 * written about something else.
 */
function mergeableIndices<P>(sections: DraftReportSection<P>[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < sections.length; i++) {
    if (sections[i].photos.length > 0 && sections[i - 1].photos.length > 0) out.push(i);
  }
  return out;
}

/** Thinnest first; on a tie the later one, so merging works from the back. */
function thinnest<P>(sections: DraftReportSection<P>[], candidates: number[]): number {
  let best = candidates[0];
  for (const i of candidates) {
    if (sections[i].photos.length <= sections[best].photos.length) best = i;
  }
  return best;
}

function mergeInto<P>(target: DraftReportSection<P>, source: DraftReportSection<P>): void {
  const heading =
    source.title.trim() && source.title.trim() !== target.title.trim()
      ? `<h3>${escapeHtml(source.title.trim())}</h3>`
      : "";
  target.body = [target.body, heading, source.body].filter((part) => part && part.trim()).join("");
  target.photos = [...target.photos, ...source.photos];
}

/**
 * Fold thin and surplus photo sections into their neighbours.
 *
 * Two reasons to merge, in priority order:
 *
 *   1. There are more photo-bearing sections than `maxPhotoSections`.
 *   2. A photo-bearing section holds fewer photos than `photosPerPage`, so its
 *      last page is padded out with blank space that the author did not ask
 *      for.
 *
 * Rule 2 is a no-op at `photosPerPage: 1`, which is the correct reading of that
 * setting: someone who asked for one photo per page wants one photo per page.
 *
 * Returns a new list; the input is not mutated. Order is preserved, and
 * sections holding no photos are never touched, so the Introduction stays first
 * and the Conclusion stays last.
 */
export function consolidateReportSections<P>(
  sections: DraftReportSection<P>[],
  opts: { photosPerPage: 1 | 2 | 3 | 4; maxPhotoSections?: number },
): DraftReportSection<P>[] {
  const maxPhotoSections = Math.max(1, opts.maxPhotoSections ?? MAX_AUTO_REPORT_PHOTO_SECTIONS);
  const out = sections.map((s) => ({ ...s, photos: [...s.photos] }));

  // Each pass removes one element, so the loop cannot outrun the list.
  for (;;) {
    const candidates = mergeableIndices(out);
    if (!candidates.length) break;

    const overCap = countPhotoSections(out) > maxPhotoSections;
    const thin = candidates.filter((i) => out[i].photos.length < opts.photosPerPage);
    const pool = overCap ? candidates : thin;
    if (!pool.length) break;

    const i = thinnest(out, pool);
    mergeInto(out[i - 1], out[i]);
    out.splice(i, 1);
  }

  return out;
}
