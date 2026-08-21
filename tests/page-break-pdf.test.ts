import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderPagePdf } from "../apps/api/src/domains/projects/page-pdf";

/*
 * Does a page break actually break a page?
 *
 * "with option to put a page break when we are editing the report."
 *
 * The node, the toolbar entry, the editor styling and the renderer branch were
 * all written before any of them had run once. Only the PDF acts on a page
 * break - on screen it is a dashed guide and nothing more - so this is the only
 * place the feature can be shown to work at all.
 */

const para = (n: number) => `<p>Paragraph ${n}. Some body text to occupy the page.</p>`;
const BREAK = '<div data-page-break="true"></div>';

/** Render some body HTML and report how many sheets came out. */
async function pageCount(html: string): Promise<number> {
  const { pdfBase64 } = await renderPagePdf("Page break check", html, null, null);
  const doc = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
  return doc.getPageCount();
}

describe("page break in the exported PDF", () => {
  it("keeps short content on one page without one", async () => {
    expect(await pageCount(para(1) + para(2))).toBe(1);
  });

  it("starts a new page where the author put a break", async () => {
    expect(await pageCount(para(1) + BREAK + para(2))).toBe(2);
  });

  it("breaks once per break", async () => {
    expect(await pageCount(para(1) + BREAK + para(2) + BREAK + para(3))).toBe(3);
  });

  it("breaks below the title when the author puts one first", async () => {
    /*
     * The first page is not blank - `renderPagePdf` draws the document title
     * onto it before any of the body. So a break at the top of the body means
     * "title page, then the content", and honouring it is correct.
     */
    expect(await pageCount(BREAK + para(1))).toBe(2);
  });

  it("does not emit a blank sheet for two breaks in a row", async () => {
    expect(await pageCount(para(1) + BREAK + BREAK + para(2))).toBe(2);
  });

  it("does not leave a trailing blank sheet for a break at the end", async () => {
    // Nothing follows it, so the second page would have nothing on it.
    expect(await pageCount(para(1) + BREAK)).toBe(1);
  });

  it("leaves the horizontal rule alone", async () => {
    /*
     * `<hr>` is the decorative rule this renderer draws as a line, and the
     * generated cover pages use two of them. If a break had been implemented by
     * overloading it, every cover page would silently have gained two.
     */
    expect(await pageCount(para(1) + "<hr>" + para(2))).toBe(1);
  });

  it("survives the attribute spelling the editor actually emits", async () => {
    // Tiptap renders the node's attribute; the renderer tests for presence, not
    // for a particular value, so both spellings have to work.
    expect(await pageCount(para(1) + '<div data-page-break=""></div>' + para(2))).toBe(2);
    expect(await pageCount(para(1) + "<div data-page-break></div>" + para(2))).toBe(2);
  });
});
