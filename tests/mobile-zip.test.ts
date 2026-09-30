import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ZipWriter, crc32, dosDateTime } from "../apps/mobile/src/lib/zip";
import {
  ZIP_SIZE_LIMIT,
  createNameAllocator,
  photoBaseName,
  photoExtension,
  projectZipLayout,
  selectionZipLayout,
  zipFileName,
  zipProgressLabel,
  zipResultMessage,
} from "../apps/mobile/src/api/photo-zip-view";

/*
 * The phone's zip of photos.
 *
 * The web uses JSZip; the phone writes the format by hand rather than adding
 * a dependency, so the bytes are what is pinned here. A zip that is off by one
 * field still downloads and still shares, and only fails on the laptop it was
 * sent to, where nobody can tell which device made it.
 */

const bytes = (text: string) => new TextEncoder().encode(text);

function build(entries: [string, string][], folder?: string) {
  const chunks: Uint8Array[] = [];
  const writer = new ZipWriter({ write: (b) => chunks.push(b) });
  if (folder) writer.addDirectory(folder);
  for (const [name, text] of entries) {
    writer.addFile(name, bytes(text), new Date(2026, 8, 29, 14, 30, 10));
  }
  const size = writer.finish();
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return { out, writer };
}

/** Walk the archive from its end record, the way an unzip tool does. */
function read(zip: Uint8Array) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  const cdSize = v.getUint32(end + 12, true);
  const cdOffset = v.getUint32(end + 16, true);
  expect(cdOffset + cdSize).toBe(end);

  const entries: { name: string; crc: number; size: number; data: Uint8Array; flags: number }[] =
    [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const flags = v.getUint16(p + 8, true);
    expect(v.getUint16(p + 10, true)).toBe(0); // stored
    const crc = v.getUint32(p + 16, true);
    const compressed = v.getUint32(p + 20, true);
    const size = v.getUint32(p + 24, true);
    expect(compressed).toBe(size);
    const nameLength = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true);
    const comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLength));

    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint32(local + 14, true)).toBe(crc);
    expect(v.getUint32(local + 22, true)).toBe(size);
    const localName = v.getUint16(local + 26, true);
    const localExtra = v.getUint16(local + 28, true);
    const start = local + 30 + localName + localExtra;
    const data = zip.subarray(start, start + size);
    entries.push({ name, crc, size, data, flags });
    p += 46 + nameLength + extra + comment;
  }
  expect(p).toBe(end);
  return { count, entries };
}

describe("crc32", () => {
  it("matches the known value for hello", () => {
    expect(crc32(bytes("hello"))).toBe(0x3610a686);
  });

  it("is zero for nothing and continues across chunks", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    const whole = crc32(bytes("hello world"));
    expect(crc32(bytes(" world"), crc32(bytes("hello")))).toBe(whole);
  });
});

describe("ZipWriter", () => {
  it("writes two stored entries a reader can walk back from the end", () => {
    const { out, writer } = build([
      ["hello.txt", "hello"],
      ["b.txt", "second file"],
    ]);
    expect(writer.entryCount).toBe(2);
    expect(writer.bytesWritten).toBe(out.length);

    const view = new DataView(out.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);

    const { count, entries } = read(out);
    expect(count).toBe(2);
    expect(entries.map((e) => e.name)).toEqual(["hello.txt", "b.txt"]);
    expect(entries[0].crc).toBe(0x3610a686);
    expect(entries[1].crc).toBe(crc32(bytes("second file")));
    expect(new TextDecoder().decode(entries[0].data)).toBe("hello");
    expect(new TextDecoder().decode(entries[1].data)).toBe("second file");
    // UTF-8 names, so a caption in any language unpacks as typed.
    for (const e of entries) expect(e.flags & 0x0800).toBe(0x0800);
  });

  it("writes a folder entry before the files that sit in it", () => {
    const { out } = build([["Job/a.jpg", "x"]], "Job");
    const { entries } = read(out);
    expect(entries.map((e) => e.name)).toEqual(["Job/", "Job/a.jpg"]);
    expect(entries[0].size).toBe(0);
  });

  it("is a valid empty archive with nothing in it", () => {
    const { out } = build([]);
    expect(out.length).toBe(22);
    expect(read(out).count).toBe(0);
  });

  it("refuses an entry that would take it past its limit, counting what finishing needs", () => {
    const writer = new ZipWriter({ write: () => undefined }, { maxBytes: 200 });
    // 30 + 5 + 50 local, 46 + 5 central, 22 end: 158 fits.
    expect(writer.fits("a.jpg", 50)).toBe(true);
    writer.addFile("a.jpg", new Uint8Array(50));
    expect(writer.fits("b.jpg", 50)).toBe(false);
    expect(() => writer.addFile("b.jpg", new Uint8Array(50))).toThrow(/limit/);
    expect(writer.finish()).toBeLessThanOrEqual(200);
  });

  it("stores dates the DOS way, clamped to 1980", () => {
    expect(dosDateTime(new Date(2026, 8, 29, 14, 30, 10))).toEqual({
      time: (14 << 11) | (30 << 5) | 5,
      date: (46 << 9) | (9 << 5) | 29,
    });
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0);
    expect(dosDateTime(new Date("not a date"))).toEqual({ time: 0, date: (1 << 5) | 1 });
  });
});

describe("zip names, as the web names them", () => {
  it("lays a whole job out in one folder, as the project menu's export does", () => {
    const layout = projectZipLayout("Smith Kitchen / Phase 2");
    expect(layout.fileName).toBe("Smith_Kitchen___Phase_2-photos.zip");
    expect(layout.folder).toBe("Smith_Kitchen___Phase_2");
    expect(
      layout.entryName({ id: "p1", caption: "Rating plate!", storage_path: "u/a.PNG" }, 0, ""),
    ).toBe("Smith_Kitchen___Phase_2/Rating_plate_-1.png");
    expect(layout.entryName({ id: "p2", caption: null, storage_path: "u/b" }, 4, "")).toBe(
      "Smith_Kitchen___Phase_2/photo_5-5.jpg",
    );
    expect(projectZipLayout("").folder).toBe("project");
  });

  it("names a bulk selection flat, with repeats numbered", () => {
    const layout = selectionZipLayout("Smith Kitchen", new Date("2026-09-29T12:00:00Z"));
    expect(layout.fileName).toBe("Smith_Kitchen-photos-2026-09-29.zip");
    expect(layout.folder).toBeNull();
    const photo = { id: "abcdef1234", caption: "Kitchen", storage_path: "u/a.jpg" };
    expect(layout.entryName(photo, 0, "image/jpeg")).toBe("Kitchen.jpg");
    expect(layout.entryName(photo, 1, "image/jpeg")).toBe("Kitchen-2.jpg");
    expect(layout.entryName({ ...photo, caption: "kitchen" }, 2, "image/jpeg")).toBe(
      "kitchen-3.jpg",
    );
    // The web says "photos" twice for a mixed selection, and so does the phone.
    expect(zipFileName(null, new Date("2026-09-29T12:00:00Z"))).toBe(
      "photos-photos-2026-09-29.zip",
    );
  });

  it("keeps the web's base names and extensions", () => {
    expect(photoBaseName({ id: "abcdef1234", caption: " ../Roof: north " })).toBe("Roof_north");
    expect(photoBaseName({ id: "abcdef1234", caption: null })).toBe("photo_abcdef12");
    expect(photoExtension("image/heic")).toBe("heic");
    expect(photoExtension("application/octet-stream", "u/a.webp")).toBe("webp");
    expect(photoExtension("")).toBe("jpg");
    const next = createNameAllocator();
    expect([next("a", "jpg"), next("A", "jpg"), next("a", "png")]).toEqual([
      "a.jpg",
      "A-2.jpg",
      "a.png",
    ]);
  });
});

describe("zip progress and result", () => {
  it("counts photos, and says when it is still finding them", () => {
    expect(zipProgressLabel(0, 0)).toBe("Finding the photos");
    expect(zipProgressLabel(3, 12)).toBe("Adding 3 of 12");
  });

  it("says nothing when every photo went in, and says why when some did not", () => {
    expect(zipResultMessage({ added: 12, failed: 0, leftOut: 0 })).toBeNull();
    expect(zipResultMessage({ added: 10, failed: 2, leftOut: 0 })).toMatch(
      /2 photos could not be downloaded/,
    );
    expect(zipResultMessage({ added: 400, failed: 0, leftOut: 25 })).toMatch(/past 2 GB/);
    expect(ZIP_SIZE_LIMIT).toBeLessThan(0xffffffff);
  });
});

describe("where the zip is offered", () => {
  const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  it("is in the project's actions menu and on the bulk bar", () => {
    expect(src("apps/mobile/app/(app)/project/[id]/index.tsx")).toMatch(/projectZipLayout\(/);
    expect(src("apps/mobile/src/components/PhotoBulkBar.tsx")).toMatch(/label="Download zip"/);
  });

  it("streams into the file and shares it as a zip", () => {
    const download = src("apps/mobile/src/api/photo-download.ts");
    expect(download).toMatch(/handle\.writeBytes\(/);
    expect(download).toMatch(/mimeType: "application\/zip"/);
  });
});
