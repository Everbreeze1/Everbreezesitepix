import { describe, it, expect } from "vitest";
import {
  PHOTO_ROW_HEIGHT,
  PHOTO_ROW_WIDTH,
  photoPageGroups,
  photoRows,
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

  it("splits four up into a 2x2 grid rather than one four-wide row", () => {
    expect(photoRows([1, 2, 3, 4], 4)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("keeps a short final row rather than padding it", () => {
    expect(photoRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("groups by page, so a 2x2 is one group of two rows", () => {
    expect(photoPageGroups([1, 2, 3, 4, 5, 6, 7, 8], 4)).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
      [
        [5, 6],
        [7, 8],
      ],
    ]);
    expect(photoPageGroups([1, 2, 3, 4], 2)).toEqual([[[1, 2]], [[3, 4]]]);
  });

  it("loses nothing, at any density", () => {
    const items = Array.from({ length: 11 }, (_, i) => i);
    for (const perPage of [1, 2, 3, 4] as const) {
      expect(photoRows(items, perPage).flat(), `perPage ${perPage}`).toEqual(items);
      expect(photoPageGroups(items, perPage).flat(2), `perPage ${perPage}`).toEqual(items);
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
      expect(photoRowHtml(n, 1), `${n} up`).toContain(`width="${PHOTO_ROW_WIDTH[n]}"`);
      expect(photoRowHtml(n, 1), `${n} up`).toContain(`height="${PHOTO_ROW_HEIGHT}"`);
    }
  });

  it("numbers slots continuously from the index it is given", () => {
    const html = photoRowHtml(4, 5);
    for (const n of [5, 6, 7, 8]) expect(html).toContain(`Photo slot ${n}`);
  });
});
