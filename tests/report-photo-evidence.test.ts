import { describe, it, expect } from "vitest";
import {
  photoEvidenceHtml,
  type GeneratedPhoto,
} from "../apps/api/src/domains/projects/page-generate";

/**
 * The generated Report's evidence body.
 *
 * The client's complaint: at two-up the report drew a row of images and then
 * all of that row's captions bunched together underneath, so no caption sat
 * with its photo and you could not tell which was which. The layout is now a
 * grid of cards - one photo per cell, its caption directly beneath it - the
 * same shape the walkthrough Summary uses. These tests are about that shape.
 *
 * The cells are nested InfoPanels (`data-panel="photocell"`) inside a
 * `data-panel="photogridN"` container, because Tiptap drops any element it does
 * not recognise; the column count rides in the variant name so it survives the
 * editor. renderPhotoGrid in page-pdf.ts lays the same structure out for the
 * PDF, and tests/photo-grid-pdf.test.ts drives that end to end.
 */

const photos = (n: number): GeneratedPhoto[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `photo-${i}`,
    caption: `Caption ${i}`,
    takenAt: "2026-08-03T10:00:00.000Z",
  }));

const imgCount = (html: string) => (html.match(/<img /g) ?? []).length;
const cellCount = (html: string) => (html.match(/data-panel="photocell"/g) ?? []).length;

describe("photoEvidenceHtml", () => {
  it("gives every photo its own captioned cell, whatever the density", () => {
    for (const perPage of [2, 3, 4] as const) {
      const html = photoEvidenceHtml(photos(7), perPage);
      expect(cellCount(html), `perPage ${perPage}`).toBe(7);
    }
  });

  it("puts one image in each cell, never a shared row of images", () => {
    const html = photoEvidenceHtml(photos(6), 2);
    // No paragraph carries two images any more - that was the bunched layout.
    expect(html).not.toMatch(/<p>(?:<img [^>]*>){2,}<\/p>/);
  });

  it("keeps the caption inside the same cell as its photo", () => {
    // The heart of the fix: image and caption are one unit, so the reader can
    // always tell which caption belongs to which photo.
    const html = photoEvidenceHtml(photos(2), 2);
    const cells = html.match(/<div data-panel="photocell">[\s\S]*?<\/div>/g) ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[0]).toContain('data-photo-id="photo-0"');
    expect(cells[0]).toContain("Caption 0");
    expect(cells[1]).toContain("Caption 1");
  });

  it("carries the density in the container variant so both surfaces agree", () => {
    expect(photoEvidenceHtml(photos(4), 2)).toContain('data-panel="photogrid2"');
    expect(photoEvidenceHtml(photos(4), 3)).toContain('data-panel="photogrid3"');
    expect(photoEvidenceHtml(photos(4), 4)).toContain('data-panel="photogrid4"');
  });

  it("sizes a cell photo to its column, not to a fixed row width", () => {
    // Full-cell width; the column count does the sizing, so a denser setting
    // yields smaller photos. This is the "photos are a little big" half.
    const html = photoEvidenceHtml(photos(4), 2);
    expect(html).toContain('width="100%"');
  });

  it("keeps one photo per paragraph at one per page, which is what that setting means", () => {
    const html = photoEvidenceHtml(photos(3), 1);
    const perPara = (html.match(/<p>(?:<img [^>]*>)+<\/p>/g) ?? []).map(
      (p) => (p.match(/<img /g) ?? []).length,
    );
    expect(perPara).toEqual([1, 1, 1]);
    // One-up is the older per-photo card layout, not the grid.
    expect(html).not.toContain("photogrid");
  });

  it("never drops or duplicates a photo", () => {
    for (const perPage of [1, 2, 3, 4] as const) {
      const html = photoEvidenceHtml(photos(9), perPage);
      expect(imgCount(html), `perPage ${perPage}`).toBe(9);
      for (let i = 0; i < 9; i++) {
        expect(html, `perPage ${perPage}`).toContain(`data-photo-id="photo-${i}"`);
      }
    }
  });

  it("numbers captions continuously across the grid", () => {
    const html = photoEvidenceHtml(photos(5), 2);
    for (let n = 1; n <= 5; n++) expect(html).toContain(`Photo ${n}`);
    expect(html).not.toContain("Photo 6");
  });

  it("heads the grid record once rather than once per photo", () => {
    const html = photoEvidenceHtml(photos(6), 3);
    expect((html.match(/<h2>/g) ?? []).length).toBe(1);
    expect(html).toContain("<h2>Photographic record</h2>");
  });

  it("gives each photo its own heading and writing space at one per page", () => {
    const html = photoEvidenceHtml(photos(3), 1);
    expect((html.match(/<h2>/g) ?? []).length).toBe(3);
    expect((html.match(/<p><\/p>/g) ?? []).length).toBe(3);
  });

  it("escapes caption text before it reaches the document", () => {
    const html = photoEvidenceHtml(
      [{ id: "p", caption: "Crack <2mm> & spalling", takenAt: null }],
      2,
    );
    expect(html).toContain("Crack &lt;2mm&gt; &amp; spalling");
  });

  it("survives a report with no photos", () => {
    expect(imgCount(photoEvidenceHtml([], 2))).toBe(0);
    expect(imgCount(photoEvidenceHtml([], 1))).toBe(0);
  });
});
