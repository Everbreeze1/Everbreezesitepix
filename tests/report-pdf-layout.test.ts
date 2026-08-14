import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  photoEvidenceHtml,
  type GeneratedPhoto,
} from "../apps/api/src/domains/projects/page-generate";
import { renderPagePdf } from "../apps/api/src/domains/projects/page-pdf";

/**
 * The photos-per-page setting is a claim about pages, and pages only exist once
 * pdf-lib has laid the document out. Every other test in this repo asserts the
 * markup that goes in; this one renders a real PDF and counts what comes out.
 *
 * That distinction is not academic. The complaint that started this work -
 * "report generation left to its own devices is one pic per page" - was true of
 * the rendered document while the markup looked perfectly reasonable, because
 * `renderImageRow` lays out whatever images share a paragraph and a card per
 * photo only ever gave it one.
 *
 * Set DUMP_PDF=<dir> to write the rendered files out and look at them.
 */

// --- a minimal solid-colour PNG, so the renderer has real images to embed ---
const CRC_TABLE = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 4:3, the aspect ratio a phone camera actually produces. */
function solidPng(rgb: [number, number, number], w = 400, h = 300): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    for (let x = 0; x < w; x++) {
      // A darker stripe down the left edge so each photo's own boundary is
      // visible when the pages are inspected by eye.
      const edge = x < w * 0.12 ? 70 : 0;
      raw[off + 1 + x * 3] = Math.max(0, rgb[0] - edge);
      raw[off + 2 + x * 3] = Math.max(0, rgb[1] - edge);
      raw[off + 3 + x * 3] = Math.max(0, rgb[2] - edge);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const HUES: Array<[number, number, number]> = [
  [214, 92, 92],
  [92, 140, 214],
  [96, 176, 118],
  [214, 168, 76],
  [158, 108, 200],
  [92, 190, 196],
  [212, 122, 168],
  [140, 150, 96],
];
const PNG_URIS = HUES.map((h) => `data:image/png;base64,${solidPng(h).toString("base64")}`);

const photos = (n: number): GeneratedPhoto[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    caption: `Sample caption for photo ${i + 1}, long enough to wrap onto a second line.`,
    takenAt: "2026-08-03T10:00:00.000Z",
  }));

/** Stands in for resolvePageImages: fills each empty src in document order. */
function withImages(html: string): string {
  let n = 0;
  return html.replace(/src=""/g, () => `src="${PNG_URIS[n++ % PNG_URIS.length]}"`);
}

async function renderAt(perPage: 1 | 2 | 3 | 4, count: number) {
  const body =
    `<h2>Executive Summary</h2><p>Two sentences of opening prose, as the generator emits them.</p>` +
    withImages(photoEvidenceHtml(photos(count), perPage)) +
    `<h2>Conclusion</h2><p>Closing prose.</p>`;
  const { pdfBase64 } = await renderPagePdf(`Report ${perPage} up`, body, null, null);
  const buf = Buffer.from(pdfBase64, "base64");
  const dump = process.env.DUMP_PDF;
  if (dump) fs.writeFileSync(path.join(dump, `report-${perPage}up.pdf`), buf);
  return (await PDFDocument.load(buf)).getPageCount();
}

describe("generated Report, rendered", () => {
  it("puts eight photos on fewer pages as the density rises", async () => {
    const pages = {
      1: await renderAt(1, 8),
      2: await renderAt(2, 8),
      3: await renderAt(3, 8),
      4: await renderAt(4, 8),
    };
    expect(pages[2]).toBeLessThan(pages[1]);
    expect(pages[3]).toBeLessThanOrEqual(pages[2]);
    /*
     * Strictly fewer, not "no more". Four-up used to lay out as a 2x2 grid,
     * which renders at two-up's size and cost exactly as many sheets - the top
     * of the control did nothing, and three-up was denser than four. Measured
     * on these very files: 248pt wide four to a sheet, against three-up's 163pt
     * six to a sheet.
     */
    expect(pages[4]).toBeLessThan(pages[2]);
  }, 60_000);

  /*
   * The regression itself, stated as a number. Eight photos across eight sheets
   * is what the client received; anything near that is the bug back again.
   */
  it("never returns to one photo per sheet at the default density", async () => {
    const pages = await renderAt(2, 8);
    expect(pages).toBeLessThanOrEqual(4);
  }, 60_000);

  it("still gives each photo room of its own when one per page is asked for", async () => {
    // 1-up is a heading, a card and writing space per photo - it should cost
    // noticeably more paper, not less.
    expect(await renderAt(1, 8)).toBeGreaterThanOrEqual(await renderAt(4, 8));
  }, 60_000);
});
