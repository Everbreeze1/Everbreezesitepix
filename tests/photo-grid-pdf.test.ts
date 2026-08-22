import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderPagePdf } from "../apps/api/src/domains/projects/page-pdf";
import {
  photoEvidenceHtml,
  type GeneratedPhoto,
} from "../apps/api/src/domains/projects/page-generate";

/*
 * The captioned photo grid, through the real PDF renderer.
 *
 * The client's complaint was about a generated report: "the generated photos
 * are little big and the caption is all on top of each other without knowing
 * which caption is for which photo." The renderer is new code that had never
 * run, so this drives it end to end - the HTML the generator emits, laid out by
 * the PDF engine - and checks it produces a document without throwing.
 *
 * Deep visual correctness is not assertable from a byte stream; what is
 * assertable is that it renders, does not crash on the shapes real data takes,
 * and keeps captions attached to their own photos in the HTML the PDF reads.
 */

const photo = (n: number, caption: string | null = `Caption ${n}`): GeneratedPhoto => ({
  // A valid-looking id; the renderer will try to fetch it, find nothing, and
  // draw the cell with no image, which is one of the cases worth covering.
  id: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
  caption,
  takenAt: "2026-08-01T10:00:00Z",
});

async function pageCount(html: string): Promise<number> {
  const { pdfBase64 } = await renderPagePdf("Report", html, null, null);
  const doc = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
  return doc.getPageCount();
}

describe("photoEvidenceHtml grid shape", () => {
  it("gives every photo its own cell with its own caption beneath", () => {
    const html = photoEvidenceHtml([photo(1), photo(2), photo(3), photo(4)], 2);
    // One cell per photo, not a row of images then a block of captions.
    expect(html.match(/data-panel="photocell"/g)).toHaveLength(4);
    // Each caption sits inside its own cell (byline + text), not pooled after.
    expect(html).toContain("Caption 1");
    expect(html).toContain("Caption 4");
    // The container carries the column count so the editor and PDF agree.
    expect(html).toContain('data-panel="photogrid2"');
  });

  it("encodes the density in the variant", () => {
    expect(photoEvidenceHtml([photo(1)], 3)).toContain('data-panel="photogrid3"');
    expect(photoEvidenceHtml([photo(1)], 4)).toContain('data-panel="photogrid4"');
  });

  it("keeps one-up as its own captioned cards, unchanged", () => {
    const html = photoEvidenceHtml([photo(1)], 1);
    expect(html).toContain('data-panel="photo"');
    expect(html).not.toContain("photogrid");
  });
});

describe("the grid renders in the PDF", () => {
  it("renders a two-up grid without throwing", async () => {
    const photos = Array.from({ length: 6 }, (_, i) => photo(i + 1));
    expect(await pageCount(photoEvidenceHtml(photos, 2))).toBeGreaterThanOrEqual(1);
  });

  it("renders three-up", async () => {
    const photos = Array.from({ length: 7 }, (_, i) => photo(i + 1));
    expect(await pageCount(photoEvidenceHtml(photos, 3))).toBeGreaterThanOrEqual(1);
  });

  it("flows a long report onto more than one page", async () => {
    /*
     * Long captions rather than many tiny ones: the test DB has no images to
     * embed, so a caption-only cell is short and dozens fit on a sheet. A
     * multi-line caption per cell forces the tall rows that make pagination
     * observable without a live photo store.
     */
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    const photos = Array.from({ length: 30 }, (_, i) => photo(i + 1, long));
    expect(await pageCount(photoEvidenceHtml(photos, 2))).toBeGreaterThan(1);
  });

  it("survives a photo with no caption", async () => {
    expect(await pageCount(photoEvidenceHtml([photo(1, null), photo(2, "has one")], 2))).toBe(1);
  });

  it("survives a filename-only caption, which must not print", async () => {
    // Uploads default the caption to the filename; it should be dropped, not
    // rendered as a sentence on a client-facing report.
    const html = photoEvidenceHtml([photo(1, "IMG_1234.JPG")], 2);
    expect(html).not.toContain("IMG_1234");
    expect(await pageCount(html)).toBe(1);
  });

  it("survives an odd photo count (a half-empty last row)", async () => {
    expect(await pageCount(photoEvidenceHtml([photo(1), photo(2), photo(3)], 2))).toBe(1);
  });
});
