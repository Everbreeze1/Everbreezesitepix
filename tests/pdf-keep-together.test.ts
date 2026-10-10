import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { PDFDocument, PDFArray, PDFRawStream, type PDFRef } from "pdf-lib";
import { renderPagePdf } from "../apps/api/src/domains/projects/page-pdf";

/*
 * "the page break should be there nicely formatted and not distort document and
 * show in the middle of a form and break that form into another page."
 *
 * A form (a table) that fits on one page moves to the next page whole, its
 * heading goes with it, and every page after the first carries a header.
 */

/** Every word drawn on each page, in drawing order. */
async function pageWords(title: string, html: string): Promise<string[][]> {
  const { pdfBase64 } = await renderPagePdf(title, html, null, null);
  const doc = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
  return doc.getPages().map((page) => {
    const c = page.node.Contents();
    const refs = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
    let text = "";
    for (const r of refs) {
      const raw = Buffer.from((doc.context.lookup(r as PDFRef) as PDFRawStream).contents);
      try {
        text += zlib.inflateSync(raw).toString("latin1");
      } catch {
        text += raw.toString("latin1");
      }
    }
    return [...text.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((m) =>
      Buffer.from(m[1], "hex").toString("latin1"),
    );
  });
}

const filler = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `<p>Filler line ${i + 1} with enough words to take a line of the page.</p>`,
  ).join("");

const form = (rows: number) =>
  "<table><tbody><tr><th>Element</th><th>Installed</th><th>Notes</th></tr>" +
  Array.from({ length: rows }, (_, i) => `<tr><td>Row${i + 1}</td><td></td><td></td></tr>`).join(
    "",
  ) +
  "</tbody></table>";

function pageOf(pages: string[][], word: string): number {
  return pages.findIndex((words) => words.includes(word));
}

describe("forms are kept together in the PDF", () => {
  it("moves a table that would straddle the page to the next page whole", async () => {
    const pages = await pageWords("Landscape report", filler(30) + form(8));
    const first = pageOf(pages, "Row1");
    expect(first).toBeGreaterThan(0);
    expect(pageOf(pages, "Row8")).toBe(first);
    expect(pageOf(pages, "Element")).toBe(first);
  });

  it("takes the form's heading along with it", async () => {
    const pages = await pageWords("Landscape report", filler(30) + "<h2>Scope</h2>" + form(8));
    expect(pageOf(pages, "Scope")).toBe(pageOf(pages, "Row1"));
    expect(pageOf(pages, "Scope")).toBe(pageOf(pages, "Row8"));
    expect(pageOf(pages, "Scope")).toBeGreaterThan(0);
  });

  it("repeats the header row when a table is longer than a page", async () => {
    const pages = await pageWords("Long form", form(80));
    expect(pages.length).toBeGreaterThan(1);
    for (const words of pages) expect(words).toContain("Element");
  });

  it("puts the document title at the top of every page after the first", async () => {
    const pages = await pageWords("Landscape report", filler(30) + form(8));
    expect(pages.length).toBeGreaterThan(1);
    for (const words of pages.slice(1)) expect(words.slice(0, 2)).toEqual(["Landscape", "report"]);
  });

  it("leaves a table that fits where it is", async () => {
    const pages = await pageWords("Short", filler(2) + form(4));
    expect(pages.length).toBe(1);
  });
});
