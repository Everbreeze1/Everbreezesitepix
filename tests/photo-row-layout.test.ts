import { describe, it, expect } from "vitest";
import {
  PHOTO_ROW_HEIGHT,
  PHOTO_ROW_WIDTH,
  photoPageGroups,
  photoRows,
  photoWidthFor,
} from "../packages/shared/src/index";
import { photoRowHtml } from "../apps/web/src/lib/tiptap-photo-slot";

/**
 * One layout rule, three consumers: the editor's Insert menu, the seeded SQL
 * templates, and the Report generator. The generator had invented its own
 * (four across at a quarter width) which is why this module exists at all, so
 * the test that matters most is the one asserting the editor still emits what
 * it always did.
 */
describe("photo row layout", () => {
  it("puts one, two and three up in a single row", () => {
    expect(photoRows([1], 1)).toEqual([[1]]);
    expect(photoRows([1, 2], 2)).toEqual([[1, 2]]);
    expect(photoRows([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it("splits four up into a 2x2 grid for tap-target slots", () => {
    expect(photoRows([1, 2, 3, 4], 4, "slots")).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  /*
   * The measured reason the modes exist: page-pdf.ts divides the content column
   * between the images sharing a paragraph, so a 2x2 renders at two-up's size.
   * Four finished photos on a sheet the same size as two is a control whose top
   * setting does nothing.
   */
  it("keeps four finished photos in one row, so density is monotonic", () => {
    expect(photoRows([1, 2, 3, 4], 4, "photos")).toEqual([[1, 2, 3, 4]]);
    expect(photoWidthFor(4, "photos")).toBe(PHOTO_ROW_WIDTH[4]);
    expect(photoWidthFor(4, "slots")).toBe(PHOTO_ROW_WIDTH[2]);
  });

  it("agrees between the modes everywhere except four up", () => {
    for (const perPage of [1, 2, 3] as const) {
      const items = [1, 2, 3].slice(0, perPage);
      expect(photoRows(items, perPage, "slots")).toEqual(photoRows(items, perPage, "photos"));
      expect(photoWidthFor(perPage, "slots")).toBe(photoWidthFor(perPage, "photos"));
    }
  });

  it("keeps a short final row rather than padding it", () => {
    expect(photoRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("groups by page, so a 2x2 slot block is one group of two rows", () => {
    expect(photoPageGroups([1, 2, 3, 4, 5, 6, 7, 8], 4, "slots")).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
      ],
    ]);
    expect(photoPageGroups([1, 2, 3, 4, 5, 6, 7, 8], 4, "photos")).toEqual([
      [[1, 2, 3, 4]],
      [[5, 6, 7, 8]],
    ]);
    expect(photoPageGroups([1, 2, 3, 4], 2)).toEqual([[[1, 2]], [[3, 4]]]);
  });

  it("loses nothing, at any density or mode", () => {
    const items = Array.from({ length: 11 }, (_, i) => i);
    for (const perPage of [1, 2, 3, 4] as const) {
      for (const mode of ["slots", "photos"] as const) {
        expect(photoRows(items, perPage, mode).flat(), `${perPage}/${mode}`).toEqual(items);
        expect(photoPageGroups(items, perPage, mode).flat(2), `${perPage}/${mode}`).toEqual(items);
      }
    }
  });

  it("does not mutate its input", () => {
    const items = [1, 2, 3];
    photoRows(items, 2);
    photoPageGroups(items, 2);
    expect(items).toEqual([1, 2, 3]);
  });

  it("survives an empty list", () => {
    expect(photoRows([], 3)).toEqual([]);
    expect(photoPageGroups([], 3)).toEqual([]);
  });
});

/*
 * The editor's slot markup has to stay byte-compatible with the seeded SQL
 * templates: ProjectPageEditorPage's click-to-fill path keys off the exact
 * width/height attributes, so a change here silently breaks filling a slot in
 * a template that shipped months ago.
 */
describe("photoRowHtml, after moving its arithmetic into the shared rule", () => {
  const imgsPerParagraph = (html: string) =>
    (html.match(/<p>(?:<img [^>]*>)+<\/p>/g) ?? []).map((p) => (p.match(/<img /g) ?? []).length);

  it("still emits 1, 2 and 3 up as one paragraph", () => {
    expect(imgsPerParagraph(photoRowHtml(1, 1))).toEqual([1]);
    expect(imgsPerParagraph(photoRowHtml(2, 1))).toEqual([2]);
    expect(imgsPerParagraph(photoRowHtml(3, 1))).toEqual([3]);
  });

  it("still emits four up as two stacked paragraphs of two", () => {
    expect(imgsPerParagraph(photoRowHtml(4, 1))).toEqual([2, 2]);
  });

  it("still carries the widths and height the seeded templates use", () => {
    for (const n of [1, 2, 3, 4] as const) {
      expect(photoRowHtml(n, 1), `${n} up`).toContain(`width="${photoWidthFor(n, "slots")}"`);
      expect(photoRowHtml(n, 1), `${n} up`).toContain(`height="${PHOTO_ROW_HEIGHT}"`);
    }
    // Four-up slots are 48% wide (two per row), which is the pre-existing
    // markup the seeded SQL templates and the click-to-fill path depend on.
    expect(photoRowHtml(4, 1)).toContain(`width="${PHOTO_ROW_WIDTH[2]}"`);
  });

  it("numbers slots continuously from the index it is given", () => {
    const html = photoRowHtml(4, 5);
    for (const n of [5, 6, 7, 8]) expect(html).toContain(`Photo slot ${n}`);
  });
});
