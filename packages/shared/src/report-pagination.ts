// Where a report's pages begin - decided once, for every renderer.
//
// A report is drawn three times: the builder's Preview tab and the public share
// link both render `ReportDocument`, and the download renders pdf-lib in
// public-pdf.ts. Those had independently invented page rules, so the preview
// could show a different number of pages than the file a client received. The
// PDF's rule was worse than different: `!(i === 0 && py > PAGE_H * 0.55)` was a
// font-metrics cursor test that no DOM renderer can reproduce, which meant the
// page count moved when you added a sentence.
//
// `planSectionPages` is deliberately data-only - no font metrics, no measured
// heights - so the browser and pdf-lib can both execute it and get identical
// answers. Anything that genuinely needs measurement (a paragraph overflowing
// the bottom margin) stays inside the PDF renderer as *additional* pages; this
// module fixes the boundaries the author asked for.

import { parseRich, richIsEmpty, type RichBlock } from "./report-rich";

/**
 * US Letter geometry, owned in one place.
 *
 * public-pdf.ts used to redeclare these as local consts, which is how the PDF's
 * page size and the preview's aspect ratio could drift apart unnoticed.
 */
export const REPORT_PAGE = {
  width: 612,
  height: 792,
  margin: 54,
  contentWidth: 504,
  bodySize: 11,
  bodyLineGap: 4,
  titleSize: 26,
  titleLineGap: 6,
} as const;

/**
 * Split a block list at every explicit page break.
 *
 * Empty groups are dropped, so a leading break, a trailing break, or two in a
 * row never produce a blank page - an author pressing the button twice should
 * not be punished with an empty sheet in the client's PDF.
 */
export function splitOnPageBreak(blocks: RichBlock[]): RichBlock[][] {
  const groups: RichBlock[][] = [];
  let cur: RichBlock[] = [];
  for (const b of blocks) {
    if (b.type === "pageBreak") {
      if (cur.length) groups.push(cur);
      cur = [];
      continue;
    }
    cur.push(b);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

export interface SectionPagePlan<P> {
  blocks: RichBlock[];
  photos: P[];
}

/**
 * The page boundaries for one section: its body split on explicit breaks, then
 * its photos batched `photosPerPage` at a time.
 *
 * A photos-only section stays a single page - that is the common "gallery
 * section", and forcing its first batch onto a second sheet would leave a page
 * holding nothing but a heading.
 */
export function planSectionPages<P>(input: {
  body: string | null | undefined;
  photos: P[];
  photosPerPage: 1 | 2 | 3 | 4;
}): SectionPagePlan<P>[] {
  const groups = splitOnPageBreak(parseRich(input.body));
  const pages: SectionPagePlan<P>[] = (groups.length ? groups : [[]]).map((blocks) => ({
    blocks,
    photos: [] as P[],
  }));

  const perPage = Math.min(4, Math.max(1, input.photosPerPage)) as 1 | 2 | 3 | 4;
  const batches: P[][] = [];
  for (let i = 0; i < input.photos.length; i += perPage) {
    batches.push(input.photos.slice(i, i + perPage));
  }

  if (batches.length && pages.length === 1 && richIsEmpty(input.body)) {
    pages[0].photos = batches.shift()!;
  }
  for (const b of batches) pages.push({ blocks: [], photos: b });

  return pages;
}
