import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { renderPagePdf } from "../apps/api/src/domains/projects/page-pdf";
import { resolvePageImages } from "../apps/api/src/domains/projects/pages";
import { photoRowHtml, sectionHtml } from "../apps/web/src/lib/tiptap-photo-slot";

/**
 * A photo the user can see in the document has to come out in the PDF.
 *
 * The reported failure: "after using a document template for a project I create
 * a section and add pictures from that project, but the exported PDF doesn't
 * render the pictures". The renderer only looked for an `<img>` as a direct
 * child of `<p>`, and that is not where photos reliably sit:
 *
 *   - the editor's image node is inline, so it carries marks - any styling that
 *     covers a photo ships it as `<p><span style="font-size:14px"><img></span></p>`
 *   - the picker inserts at the caret, which is inside a list item whenever the
 *     section is a "Photo notes" block, or a table cell in an "Action items" one
 *   - a caret left in a section heading puts it there
 *
 * Every one of those renders in the browser, so the editor and the shared page
 * showed the photos while the PDF handed to the client silently had none. These
 * tests count the image objects in a real rendered document, because "the
 * markup has an img in it" was never the claim in doubt.
 */

// --- a minimal solid-colour PNG, so there is something real to embed ---------
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

/**
 * Each fixture gets its own colour, so two images in one document are two
 * distinct objects rather than one cache hit counted twice.
 */
function solidPng(tint: number, w = 400, h = 300): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = tint;
      raw[off + 2 + x * 3] = 90;
      raw[off + 3 + x * 3] = 255 - tint;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = (tint: number, w?: number, h?: number) =>
  `data:image/png;base64,${solidPng(tint, w, h).toString("base64")}`;

const A = png(210);
const B = png(40, 300, 400);
const C = png(120);

/** How many image objects the rendered document actually contains. */
async function imageCount(contentHtml: string): Promise<number> {
  const { pdfBase64 } = await renderPagePdf("Site report", contentHtml, null, null);
  const doc = await PDFDocument.load(Buffer.from(pdfBase64, "base64"));
  let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const s = String(obj);
    if (s.includes("/Subtype /Image") || s.includes("/Subtype/Image")) n++;
  }
  return n;
}

/** An inserted project photo, as ProjectImage.renderHTML serialises one. */
function photo(src: string, id: string, box = ""): string {
  return `<img src="${src}" alt="A caption" ${box}data-photo-id="${id}">`;
}

const ID = (n: number) => `11111111-2222-3333-4444-55555555555${n}`;

describe("a photo renders wherever the document puts it", () => {
  it("as a direct child of a paragraph", async () => {
    expect(await imageCount(`<p>${photo(A, ID(1))}</p>`)).toBe(1);
  });

  it("inside a text-style span, which is how a styled photo is stored", async () => {
    expect(await imageCount(`<p><span style="font-size: 14px">${photo(A, ID(1))}</span></p>`)).toBe(
      1,
    );
  });

  it("inside bold or italic marks", async () => {
    expect(await imageCount(`<p><strong>${photo(A, ID(1))}</strong></p>`)).toBe(1);
    expect(await imageCount(`<p><em><u>${photo(B, ID(2))}</u></em></p>`)).toBe(1);
  });

  it("in a bullet list item, the 'Photo notes' section preset", async () => {
    const html =
      `<h3>Photo notes</h3><ul><li>Location: ${photo(A, ID(1))}</li>` +
      `<li>Observation: ${photo(B, ID(2))}</li></ul>`;
    expect(await imageCount(html)).toBe(2);
  });

  it("in a task list item", async () => {
    const html =
      `<ul data-type="taskList"><li data-type="taskItem" data-checked="true">` +
      `<p>Verified ${photo(A, ID(1))}</p></li></ul>`;
    expect(await imageCount(html)).toBe(1);
  });

  it("in a table cell, the 'Action items' section preset", async () => {
    const html =
      `<table><thead><tr><th>#</th><th>Item</th><th>Evidence</th></tr></thead>` +
      `<tbody><tr><td>1</td><td>Flashing replaced</td><td>${photo(A, ID(1))}</td></tr>` +
      `<tr><td>2</td><td>Drain cleared</td><td>${photo(B, ID(2))}</td></tr></tbody></table>`;
    expect(await imageCount(html)).toBe(2);
  });

  it("in a section heading", async () => {
    expect(await imageCount(`<h2>Section 1 ${photo(A, ID(1))}</h2>`)).toBe(1);
  });

  it("in a blockquote", async () => {
    expect(await imageCount(`<blockquote><p>${photo(A, ID(1))}</p></blockquote>`)).toBe(1);
  });

  /*
   * Counted, not just "at least one": a nested image used to be findable by
   * both the paragraph walk and the fallback child walk, and drawing it twice
   * is a duplicated photo on the page rather than a missing one.
   */
  it("draws a photo once, not once per level it is nested at", async () => {
    expect(
      await imageCount(
        `<p><span style="color: #112233"><strong>${photo(A, ID(1))}</strong></span></p>`,
      ),
    ).toBe(1);
  });

  it("still keeps unfilled template photo slots out of a delivered document", async () => {
    // The slot art is an inline SVG data URI, which pdf-lib cannot embed - and
    // must not, because "Click to add" is an authoring affordance.
    expect(await imageCount(photoRowHtml(2, 1))).toBe(0);
  });

  it("renders the filled slots of a half-filled row", async () => {
    const row = photoRowHtml(2, 1);
    // One slot clicked and filled, one left empty.
    const html = row.replace(/<img[^>]*>/, photo(A, ID(1)));
    expect(await imageCount(html)).toBe(1);
  });
});

describe("the whole export path, from stored document to rendered PDF", () => {
  /**
   * `data-photo-id` is the persisted value and the `src` beside it is a signed
   * URL that has almost certainly expired, so the export re-signs before it
   * renders. This drives that resolution for real and then counts what came
   * out, which is the claim the client's complaint was actually about.
   */
  it("re-signs every photo id and renders all of them", async () => {
    const ids = [ID(1), ID(2), ID(3)];
    const bySignedPath: Record<string, string> = {
      [`u/${ids[0]}.jpg`]: A,
      [`u/${ids[1]}.jpg`]: B,
      [`u/${ids[2]}.jpg`]: C,
    };

    const supabase = {
      from() {
        const q: any = {
          select: () => q,
          in: () => q,
          eq: () => q,
          then: (resolve: any) =>
            Promise.resolve({
              data: ids.map((id) => ({ id, storage_path: `u/${id}.jpg`, image_url: null })),
            }).then(resolve),
        };
        return q;
      },
      storage: {
        from: () => ({
          // Data URIs stand in for freshly signed URLs, so the render needs no
          // network of its own.
          createSignedUrl: async (path: string) => ({ data: { signedUrl: bySignedPath[path] } }),
        }),
      },
    } as any;

    const stale =
      "https://example.supabase.co/storage/v1/object/sign/site-photos/u/old.jpg?token=EXPIRED";
    let n = 0;
    const stored =
      sectionHtml(1, 0, 1) +
      photoRowHtml(3, 1).replace(/<img[^>]*>/g, () =>
        photo(stale, ids[n++], 'width="32%" height="260" '),
      );

    const resolved = await resolvePageImages(stored, supabase);
    expect(resolved).not.toContain("EXPIRED");
    expect(await imageCount(resolved)).toBe(3);
  });
});
