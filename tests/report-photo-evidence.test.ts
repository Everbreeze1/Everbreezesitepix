import { describe, it, expect } from "vitest";
import {
  photoEvidenceHtml,
  type GeneratedPhoto,
} from "../apps/api/src/domains/projects/page-generate";
import { PHOTO_ROW_HEIGHT, photoWidthFor } from "../packages/shared/src/index";

/**
 * The generated Report's evidence body.
 *
 * The PDF renderer lays out every image inside one paragraph side by side
 * across the content width (renderImageRow in page-pdf.ts). A card per photo
 * therefore gave it exactly one image to place at a time, which is how a report
 * came back at one picture per sheet however many photos were selected. These
 * tests are about the batching that fixes it.
 */

const photos = (n: number): GeneratedPhoto[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `photo-${i}`,
    caption: `Caption ${i}`,
    takenAt: "2026-08-03T10:00:00.000Z",
  }));

const imgCount = (html: string) => (html.match(/<img /g) ?? []).length;
/** How many images share each paragraph, which is what decides the PDF row. */
const paragraphImageCounts = (html: string) =>
  (html.match(/<p>(?:<img [^>]*>)+<\/p>/g) ?? []).map((p) => (p.match(/<img /g) ?? []).length);

describe("photoEvidenceHtml", () => {
  it("batches photos into rows at the requested density", () => {
    expect(paragraphImageCounts(photoEvidenceHtml(photos(7), 2))).toEqual([2, 2, 2, 1]);
    expect(paragraphImageCounts(photoEvidenceHtml(photos(7), 3))).toEqual([3, 3, 1]);
  });

  /*
   * Finished evidence, not tap targets. page-pdf.ts divides the content column
   * between the images sharing a paragraph and ignores the width attribute, so
   * images-per-paragraph is the only lever on density - and a 2x2 at four-up
   * renders exactly like two-up, which made the top of the control useless.
   */
  it("puts four up in one row, so each step of the setting fits more than the last", () => {
    expect(paragraphImageCounts(photoEvidenceHtml(photos(8), 4))).toEqual([4, 4]);
  });

  it("groups each page's photos into one card", () => {
    const cards = (html: string) => (html.match(/<div data-panel="photo">/g) ?? []).length;
    expect(cards(photoEvidenceHtml(photos(8), 4))).toBe(2);
    expect(cards(photoEvidenceHtml(photos(6), 3))).toBe(2);
  });

  it("sizes photos with the shared row rule", () => {
    for (const perPage of [2, 3, 4] as const) {
      const html = photoEvidenceHtml(photos(4), perPage);
      expect(html, `perPage ${perPage}`).toContain(`width="${photoWidthFor(perPage, "photos")}"`);
      expect(html, `perPage ${perPage}`).toContain(`height="${PHOTO_ROW_HEIGHT}"`);
    }
  });

  it("keeps one photo per paragraph at one per page, which is what that setting means", () => {
    expect(paragraphImageCounts(photoEvidenceHtml(photos(3), 1))).toEqual([1, 1, 1]);
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

  it("numbers captions continuously across rows", () => {
    const html = photoEvidenceHtml(photos(5), 2);
    for (let n = 1; n <= 5; n++) expect(html).toContain(`Photo ${n}`);
    expect(html).not.toContain("Photo 6");
  });

  /*
   * "Observation 1, Observation 2, ..." read as machine output rather than as a
   * document. Grouped densities carry one heading for the whole record.
   */
  it("heads the grouped record once rather than once per photo", () => {
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
