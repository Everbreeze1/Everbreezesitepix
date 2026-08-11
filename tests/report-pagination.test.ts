import { describe, it, expect } from "vitest";
import { parseRich, richIsEmpty, richToPlainText } from "../packages/shared/src/report-rich";
import { splitOnPageBreak, planSectionPages } from "../packages/shared/src/report-pagination";

/*
 * A report is rendered three times — the builder's Preview tab, the public
 * share link (literally the same component), and the pdf-lib download. They
 * used to decide page boundaries independently: the preview drew exactly one
 * page per section with no way to split a long one, while the PDF used
 * `!(i === 0 && py > PAGE_H * 0.55)` — a font-metrics cursor test no DOM
 * renderer can reproduce, so the page count moved when you added a sentence.
 *
 * `planSectionPages` is the single rule both now execute. It is deliberately
 * data-only (no font metrics) so a browser and pdf-lib get identical answers.
 */
describe("page breaks: <hr> in a report body", () => {
  it("parses <hr> into a pageBreak block", () => {
    const blocks = parseRich("<p>One</p><hr><p>Two</p>");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "pageBreak", "paragraph"]);
  });

  it("closes open blocks so a nested break still lands between them", () => {
    // Pasted markup can nest the rule; a break stranded mid-paragraph would
    // split a run rather than a page.
    const blocks = parseRich("<p>One<hr>Two</p>");
    const kinds = blocks.map((b) => b.type);
    expect(kinds).toContain("pageBreak");
    expect(kinds.indexOf("pageBreak")).toBeGreaterThan(0);
  });

  it("counts a break as content, so a break-only body still renders", () => {
    // richIsEmpty gates the body render in BOTH ReportDocument and public-pdf.
    // Treating a break as empty made the button appear to do nothing.
    expect(richIsEmpty("<hr>")).toBe(false);
    expect(richIsEmpty("<p></p>")).toBe(true);
    expect(richIsEmpty("")).toBe(true);
  });

  it("richToPlainText skips breaks instead of throwing on b.runs", () => {
    expect(() => richToPlainText("<p>a</p><hr><p>b</p>")).not.toThrow();
    expect(richToPlainText("<p>a</p><hr><p>b</p>")).toBe("a\nb");
  });
});

describe("splitOnPageBreak", () => {
  it("splits into one group per page", () => {
    const groups = splitOnPageBreak(parseRich("<p>a</p><hr><p>b</p><hr><p>c</p>"));
    expect(groups).toHaveLength(3);
  });

  it("never yields a blank page from leading, trailing or doubled breaks", () => {
    // Pressing the button twice must not punish the author with an empty sheet
    // in the client's PDF.
    for (const html of ["<hr><p>a</p>", "<p>a</p><hr>", "<p>a</p><hr><hr><p>b</p>", "<hr>"]) {
      const groups = splitOnPageBreak(parseRich(html));
      expect(groups.every((g) => g.length > 0)).toBe(true);
    }
    expect(splitOnPageBreak(parseRich("<hr>"))).toHaveLength(0);
    expect(splitOnPageBreak(parseRich("<p>a</p><hr><hr><p>b</p>"))).toHaveLength(2);
  });
});

describe("planSectionPages — the one page rule both renderers execute", () => {
  const photos = (n: number) => Array.from({ length: n }, (_, i) => ({ photo_id: `p${i}` }));

  it("a plain section is one page", () => {
    const pages = planSectionPages({ body: "<p>hello</p>", photos: [], photosPerPage: 2 });
    expect(pages).toHaveLength(1);
    expect(pages[0].blocks).toHaveLength(1);
  });

  it("an empty section still yields one page rather than none", () => {
    expect(planSectionPages({ body: "", photos: [], photosPerPage: 2 })).toHaveLength(1);
  });

  it("each page break adds a page", () => {
    const pages = planSectionPages({
      body: "<p>a</p><hr><p>b</p><hr><p>c</p>",
      photos: [],
      photosPerPage: 2,
    });
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.blocks.length)).toEqual([1, 1, 1]);
  });

  it("a photos-only section keeps its first batch on the same page", () => {
    // The common "gallery section": forcing batch one onto a second sheet
    // would leave a page holding nothing but a heading.
    const pages = planSectionPages({ body: "", photos: photos(4), photosPerPage: 2 });
    expect(pages).toHaveLength(2);
    expect(pages[0].photos).toHaveLength(2);
    expect(pages[1].photos).toHaveLength(2);
  });

  it("photos start on their own page once there is body text", () => {
    const pages = planSectionPages({ body: "<p>a</p>", photos: photos(2), photosPerPage: 2 });
    expect(pages).toHaveLength(2);
    expect(pages[0].blocks).toHaveLength(1);
    expect(pages[0].photos).toHaveLength(0);
    expect(pages[1].photos).toHaveLength(2);
  });

  it("batches photos by photosPerPage", () => {
    const pages = planSectionPages({ body: "", photos: photos(5), photosPerPage: 2 });
    expect(pages.map((p) => p.photos.length)).toEqual([2, 2, 1]);
  });

  it("is deterministic — no font metrics, so browser and pdf-lib agree", () => {
    const input = { body: "<p>a</p><hr><p>b</p>", photos: photos(3), photosPerPage: 1 } as const;
    const a = planSectionPages({ ...input, photos: [...input.photos] });
    const b = planSectionPages({ ...input, photos: [...input.photos] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("clamps an out-of-range photosPerPage instead of looping forever", () => {
    const pages = planSectionPages({
      body: "",
      photos: photos(3),
      photosPerPage: 0 as unknown as 1,
    });
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.reduce((n, p) => n + p.photos.length, 0)).toBe(3);
  });
});
