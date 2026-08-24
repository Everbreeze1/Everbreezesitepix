/**
 * Builders for the "click to add" photo slots and report sections that the
 * pre-built document templates ship with (see
 * supabase/migrations/*_document_template_00*.sql).
 *
 * Those templates could only ever be authored in SQL, so a user building their
 * own page had no way to lay out a section + photo row by hand. These helpers
 * emit byte-compatible markup so a slot inserted from the editor is
 * indistinguishable from a slot that came out of a seeded template - same SVG,
 * same width/height attrs - and therefore flows through the identical
 * click-to-fill path in ProjectPageEditorPage (`isPhotoSlot` → picker →
 * `replaceImageAt`, which swaps the slot node for the photo and carries the
 * slot's dimensions across).
 */

import { PHOTO_ROW_HEIGHT, photoRows, photoWidthFor } from "@everlumen/shared";

/** Matches the slot art in the seeded templates: dashed rounded rect, caption, hint. */
function slotSvg(label: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='280'>` +
    `<rect x='0.5' y='0.5' width='219' height='279' rx='6' fill='rgb(244,245,247)' ` +
    `stroke='rgb(203,208,216)' stroke-dasharray='5 4'/>` +
    `<text x='110' y='132' font-family='sans-serif' font-size='14' font-weight='700' ` +
    `fill='rgb(107,114,128)' text-anchor='middle'>${label}</text>` +
    `<text x='110' y='152' font-family='sans-serif' font-size='11' ` +
    `fill='rgb(156,163,175)' text-anchor='middle'>Click to add</text>` +
    `</svg>`;
  // `;utf8,` + encodeURIComponent is the exact form the SQL templates use, and
  // `isPhotoSlot` keys off the `data:image/svg+xml` prefix.
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/*
 * The widths, the height and the four-up-is-a-2x2-grid rule now live in
 * @everlumen/shared so the Report generator can share the arithmetic. Slots stay
 * in "slots" mode: an empty box is a tap target first, so four-up stacks 2x2
 * rather than shrinking to a quarter width. See photo-row-layout.ts.
 */
const SLOT_HEIGHT = PHOTO_ROW_HEIGHT;

function slotImg(index: number, width: string): string {
  return (
    `<img src="${slotSvg(`Photo ${index}`)}" width="${width}" height="${SLOT_HEIGHT}" ` +
    `alt="Photo slot ${index}">`
  );
}

/**
 * A row of photo slots numbered from `startIndex`.
 *
 * Four-up renders as a 2x2 grid (two stacked 2-up paragraphs) rather than one
 * four-wide row - the same choice template 004 makes, so each photo stays a
 * readable size instead of being squeezed to a quarter of the page.
 */
export function photoRowHtml(count: 1 | 2 | 3 | 4, startIndex: number): string {
  const width = photoWidthFor(count, "slots");
  const indices = Array.from({ length: count }, (_, i) => startIndex + i);
  return photoRows(indices, count, "slots")
    .map((row) => `<p>${row.map((i) => slotImg(i, width)).join("")}</p>`)
    .join("");
}

/**
 * A numbered report section: heading, italic summary line, and a body prompt -
 * mirroring the structure of the seeded report templates. `photos` optionally
 * appends a slot row beneath it.
 */
export function sectionHtml(
  sectionNumber: number,
  photos: 0 | 1 | 2 | 3 | 4,
  startPhotoIndex: number,
): string {
  const head =
    `<h2>Section ${sectionNumber}</h2>` +
    `<p><em>Section summary</em></p>` +
    `<p>Click to add important info or findings.</p>`;
  return photos === 0 ? head : head + photoRowHtml(photos, startPhotoIndex);
}
