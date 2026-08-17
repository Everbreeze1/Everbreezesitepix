import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { renderWalkthroughPdf } from "../apps/api/src/domains/walkthroughs/public-pdf";
import { walkthroughSummaryBlocks } from "../packages/shared/src/walkthrough-summary";

/** WinAnsi puts U+2022 at 0x95, which the latin1 read-back returns as this. */
const BULLET = String.fromCharCode(0x95);
const countBullets = (s: string) => s.split(BULLET).length - 1;

/**
 * The complaint, in the client's words: "It looks nice on the modal as I
 * generated but when I click PDF its all very unformatted ... The bullet points
 * show nicely on the modal but when i do the PDF it doesnt render an attractive
 * document."
 *
 * Both halves were true and both were in this file's renderer.
 *
 *  1. `extractSummaryText` deleted every `##` heading, turned each `- bullet`
 *     into a "• " prefix inside one long string, dropped bold and italic,
 *     swept the trailing photo-caption section in behind the prose, and cut the
 *     result at 900 characters. The modal, meanwhile, rendered the same
 *     markdown as real headings and real list items.
 *  2. What survived was handed to a `drawWrapped` bound to a single PDFPage. It
 *     decremented y with no bottom-margin test, so a summary of any length ran
 *     off the foot of the cover page and every viewer clipped it away.
 *
 * Asserting on the markup that goes in cannot catch either. This renders the
 * document and reads the text back out of its content streams.
 *
 * Set DUMP_PDF=<dir> to write the files out and look at them.
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

function solidPng(w = 400, h = 300): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = 120;
      raw[off + 2 + x * 3] = 150;
      raw[off + 3 + x * 3] = 190;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PHOTO_URI = `data:image/png;base64,${solidPng().toString("base64")}`;

/** Every content stream of every page, inflated, in page order. */
async function pageStreams(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = (page.node as any).Contents();
    if (!contents) return "";
    const refs = contents.asArray ? contents.asArray() : [contents];
    let out = "";
    for (const ref of refs) {
      const stream: any = doc.context.lookup(ref);
      if (!stream?.getContents) continue;
      let raw: Buffer = Buffer.from(stream.getContents());
      if (String(stream.dict?.get?.(doc.context.obj("Filter"))).includes("Flate")) {
        try {
          raw = zlib.inflateSync(raw);
        } catch {
          continue;
        }
      }
      out += raw.toString("latin1");
    }
    return out;
  });
}

/**
 * Text out of a rendered PDF.
 *
 * pdf-lib emits one show-text operator per `drawText` call, and `drawRuns`
 * calls it once per styled word, so this returns the words in draw order. That
 * is enough to ask the question that matters: is the text there at all. Strings
 * are written hex-encoded.
 */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const out: string[] = [];
  for (const stream of await pageStreams(bytes)) {
    for (const m of stream.matchAll(/<([0-9A-Fa-f\s]*)>\s*Tj/g)) {
      out.push(Buffer.from(m[1].replace(/\s+/g, ""), "hex").toString("latin1"));
    }
  }
  return out.join(" ");
}

/**
 * Every y a page draws text or an image at.
 *
 * The old renderer's failure is invisible in the text: it drew every line, just
 * at coordinates below the MediaBox, where viewers clip them. This is the only
 * assertion that can see that.
 */
async function drawOrigins(bytes: Uint8Array): Promise<number[][]> {
  const streams = await pageStreams(bytes);
  return streams.map((stream) => {
    const ys: number[] = [];
    const six = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (?:Tm|cm)/g;
    for (const m of stream.matchAll(six)) ys.push(Number(m[6]));
    for (const m of stream.matchAll(/(-?[\d.]+) (-?[\d.]+) Td/g)) ys.push(Number(m[2]));
    return ys;
  });
}

/**
 * The shape `composeSummaryMarkdown` actually writes: an H1 the surfaces render
 * themselves, the AI's `## Overview` prose, its `## Key Points` bullets, then a
 * `## Photos` section of `photo:<id>` refs for raw-markdown consumers.
 */
function summaryMarkdown(bullets: number, photos: number): string {
  const lines = [
    "# Summary - Aug 15, 2026",
    "",
    "## Overview",
    "",
    "The visit covered the exterior condenser unit, the attic air handler and the returns on the second floor. Refrigerant line insulation was replaced where it had degraded and the condensate trap was cleared. All documented work was completed on the same day.",
    "",
    "## Key Points",
    "",
  ];
  for (let i = 0; i < bullets; i++) {
    lines.push(
      `- Condenser coil ${i + 1} rinsed and fin comb run over the bent section along the lower left corner of the housing`,
    );
  }
  lines.push("", "## Photos");
  for (let i = 0; i < photos; i++) {
    lines.push(
      "",
      `### Photo ${i + 1}`,
      "",
      `![Photo ${i + 1}](photo:p${i})`,
      "",
      `*Caption ${i + 1}*`,
    );
  }
  return lines.join("\n");
}

function input(over: Partial<Parameters<typeof renderWalkthroughPdf>[0]> = {}) {
  const photoCount = 4;
  return {
    title: "Summary - Aug 15, 2026",
    isSummary: true,
    startedAt: "2026-08-15T10:00:00.000Z",
    durationSeconds: 0,
    summaryMarkdown: summaryMarkdown(5, photoCount),
    transcript: "",
    project: {
      name: "Buddy",
      street: "9610 Upper Valley Road",
      city: "Auburn",
      state: "CA",
      zip: "95602",
    },
    profile: { full_name: "Mike", company: "Everbreeze" },
    photos: Array.from({ length: photoCount }, (_, i) => ({
      photo_id: `p${i}`,
      offset_seconds: 0,
      spoken_note: null,
      caption: `Caption ${i + 1}`,
      url: PHOTO_URI,
    })),
    ...over,
  };
}

async function render(over: Parameters<typeof input>[0] = {}, tag = "summary") {
  const bytes = await renderWalkthroughPdf(input(over));
  const dump = process.env.DUMP_PDF;
  if (dump) fs.writeFileSync(path.join(dump, `walkthrough-${tag}.pdf`), Buffer.from(bytes));
  return bytes;
}

describe("walkthrough Summary, rendered to PDF", () => {
  it("prints the section headings the modal shows", async () => {
    const text = await drawnText(await render());
    // Deleted outright by the old extractor's `^#{1,6}\s+.*$` sweep.
    expect(text).toContain("Overview");
    expect(text).toContain("Key");
    expect(text).toContain("Points");
  }, 30_000);

  it("draws a real bullet marker for every Key Point", async () => {
    const text = await drawnText(await render());
    // U+2022 is WinAnsi 0x95, which latin1 reads back as .
    const bullets = countBullets(text);
    expect(bullets).toBe(5);
  }, 30_000);

  it("keeps the whole summary, however long", async () => {
    /*
     * 24 bullets is roughly 2,400 characters of body. The old path cut at 900
     * and drew the remainder below y=0. Both failures look identical to a
     * reader: the document simply stops.
     */
    const bytes = await render({ summaryMarkdown: summaryMarkdown(24, 4) }, "long");
    const text = await drawnText(bytes);
    expect(countBullets(text)).toBe(24);
    // The last bullet is the one that used to be missing.
    expect(text).toContain("comb");
    expect(text).not.toContain("...");
  }, 30_000);

  it("never draws a line below the page, at any length", async () => {
    for (const n of [5, 24, 60]) {
      const bytes = await render({ summaryMarkdown: summaryMarkdown(n, 4) }, `len-${n}`);
      for (const ys of await drawOrigins(bytes)) {
        for (const y of ys) {
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(792);
        }
      }
    }
  }, 60_000);

  it("continues a long summary onto a sheet of its own", async () => {
    const short = await PDFDocument.load(await render({ summaryMarkdown: summaryMarkdown(3, 4) }));
    const long = await PDFDocument.load(await render({ summaryMarkdown: summaryMarkdown(60, 4) }));
    expect(long.getPageCount()).toBeGreaterThan(short.getPageCount());
  }, 60_000);

  it("does not reprint the photo section as cover prose", async () => {
    /*
     * `## Photos` exists so raw-markdown consumers can find the images. The PDF
     * lays out its own photo pages, so the old extractor's habit of sweeping
     * those captions into the cover summary printed each of them twice.
     */
    const blocks = walkthroughSummaryBlocks(summaryMarkdown(5, 4));
    const flat = JSON.stringify(blocks);
    expect(flat).not.toContain("photo:p0");
    expect(flat).not.toContain("Caption 1");
    expect(flat).toContain("Key Points");
  });

  it("drops the H1, which every surface renders from its own title field", () => {
    const blocks = walkthroughSummaryBlocks(summaryMarkdown(3, 2));
    expect(blocks.some((b) => b.type === "heading" && b.level === 1)).toBe(false);
  });

  it("keeps a recorded walkthrough's duration and timestamps", async () => {
    const text = await drawnText(
      await render(
        {
          isSummary: false,
          durationSeconds: 185,
          transcript: "Checking the condenser now, the fin pack looks clean on this side.",
          photos: input().photos.map((p, i) => ({ ...p, offset_seconds: i * 30 })),
        },
        "recorded",
      ),
    );
    expect(text).toContain("Duration");
    expect(text).toContain("3:05");
  }, 30_000);
});
