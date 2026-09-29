/**
 * A store-only ZIP writer, small enough to read in one sitting.
 *
 * The web builds its photo zips with JSZip. The phone has no zip module and
 * adding one means a new dependency for something this small, so this writes
 * the format by hand: a local header and the bytes for each entry, then the
 * central directory, then the end record. Nothing is compressed. The entries
 * are JPEGs, which deflate would shrink by a percent or two for a lot of CPU on
 * a phone that is also downloading them.
 *
 * It writes to a sink as it goes rather than building the archive in memory,
 * so a caller can stream each photo into a file on disk and let it go. The
 * only thing held until the end is the central directory, a few dozen bytes per
 * entry.
 *
 * There is no ZIP64. Offsets and sizes are 32-bit, so an archive stops at 4 GB
 * and 65,535 entries; `fits` says whether the next entry would cross either
 * line, and the caller decides what to tell the person. Kept free of React
 * Native so it can be tested.
 */

/** Where the archive's bytes go, in order. */
export type ZipSink = { write(bytes: Uint8Array): void };

/** The format's own ceilings without ZIP64. */
export const ZIP_MAX_BYTES = 0xffffffff;
export const ZIP_MAX_ENTRIES = 0xffff;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;

/** 2.0: the version that introduced folders, and all a stored entry needs. */
const VERSION = 20;
/** Bit 11: names are UTF-8, so a caption in any language unpacks as typed. */
const UTF8_NAMES = 0x0800;
/** The MS-DOS directory attribute, set on folder entries. */
const DIRECTORY_ATTRIBUTE = 0x10;

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/**
 * CRC-32 as ZIP uses it (the IEEE polynomial, reflected).
 *
 * Pass the previous result as `crc` to continue over a second chunk.
 */
export function crc32(data: Uint8Array, crc = 0): number {
  const t = crcTable();
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A date in the two 16-bit MS-DOS fields ZIP stores, in local time.
 *
 * DOS time counts from 1980 and keeps seconds in twos, so earlier dates clamp
 * to 1980 rather than wrapping into the future. An invalid date is written as
 * the format's first day rather than as garbage.
 */
export function dosDateTime(when: Date): { time: number; date: number } {
  const date = Number.isNaN(when.getTime()) ? new Date(1980, 0, 1) : when;
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

type CentralEntry = {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
  attributes: number;
};

export class ZipWriter {
  private readonly sink: ZipSink;
  private readonly maxBytes: number;
  private readonly entries: CentralEntry[] = [];
  private readonly encoder = new TextEncoder();
  private offset = 0;
  private centralSize = 0;
  private finished = false;

  constructor(sink: ZipSink, options: { maxBytes?: number } = {}) {
    this.sink = sink;
    this.maxBytes = Math.min(ZIP_MAX_BYTES, options.maxBytes ?? ZIP_MAX_BYTES);
  }

  /** Bytes handed to the sink so far. */
  get bytesWritten(): number {
    return this.offset;
  }

  get entryCount(): number {
    return this.entries.length;
  }

  /**
   * Whether an entry of `size` bytes named `name` still fits, counting the
   * central directory and end record it will need, so an archive that passes
   * every check can always be finished.
   */
  fits(name: string, size: number): boolean {
    if (this.entries.length + 1 > ZIP_MAX_ENTRIES) return false;
    const nameLength = this.encoder.encode(name).length;
    const total =
      this.offset +
      LOCAL_HEADER_SIZE +
      nameLength +
      size +
      this.centralSize +
      CENTRAL_HEADER_SIZE +
      nameLength +
      END_RECORD_SIZE;
    return total <= this.maxBytes;
  }

  /** One file, stored as it is. Throws when it would not fit. */
  addFile(name: string, data: Uint8Array, modified: Date = new Date()): void {
    this.add(name, data, modified, 0);
  }

  /** A folder entry. `name` gets its trailing slash if it has none. */
  addDirectory(name: string, modified: Date = new Date()): void {
    this.add(
      name.endsWith("/") ? name : `${name}/`,
      new Uint8Array(0),
      modified,
      DIRECTORY_ATTRIBUTE,
    );
  }

  /** Writes the central directory and end record. Returns the archive's size. */
  finish(): number {
    if (this.finished) return this.offset;
    const start = this.offset;
    for (const entry of this.entries) this.emit(centralHeader(entry));
    this.emit(endRecord(this.entries.length, this.offset - start, start));
    this.finished = true;
    return this.offset;
  }

  private add(name: string, data: Uint8Array, modified: Date, attributes: number) {
    if (this.finished) throw new Error("This zip is already finished.");
    if (!name) throw new Error("A zip entry needs a name.");
    if (!this.fits(name, data.length)) throw new Error("This zip has reached its size limit.");
    const encoded = this.encoder.encode(name);
    const { time, date } = dosDateTime(modified);
    const entry: CentralEntry = {
      name: encoded,
      crc: crc32(data),
      size: data.length,
      offset: this.offset,
      time,
      date,
      attributes,
    };
    this.emit(localHeader(entry));
    if (data.length) this.emit(data);
    this.entries.push(entry);
    this.centralSize += CENTRAL_HEADER_SIZE + encoded.length;
  }

  private emit(bytes: Uint8Array) {
    this.sink.write(bytes);
    this.offset += bytes.length;
  }
}

function localHeader(e: CentralEntry): Uint8Array {
  const out = new Uint8Array(LOCAL_HEADER_SIZE + e.name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, LOCAL_HEADER, true);
  v.setUint16(4, VERSION, true);
  v.setUint16(6, UTF8_NAMES, true);
  v.setUint16(8, 0, true); // stored
  v.setUint16(10, e.time, true);
  v.setUint16(12, e.date, true);
  v.setUint32(14, e.crc, true);
  v.setUint32(18, e.size, true); // compressed size, the same when stored
  v.setUint32(22, e.size, true);
  v.setUint16(26, e.name.length, true);
  v.setUint16(28, 0, true); // no extra field
  out.set(e.name, LOCAL_HEADER_SIZE);
  return out;
}

function centralHeader(e: CentralEntry): Uint8Array {
  const out = new Uint8Array(CENTRAL_HEADER_SIZE + e.name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, CENTRAL_HEADER, true);
  v.setUint16(4, VERSION, true); // made by
  v.setUint16(6, VERSION, true); // needed
  v.setUint16(8, UTF8_NAMES, true);
  v.setUint16(10, 0, true);
  v.setUint16(12, e.time, true);
  v.setUint16(14, e.date, true);
  v.setUint32(16, e.crc, true);
  v.setUint32(20, e.size, true);
  v.setUint32(24, e.size, true);
  v.setUint16(28, e.name.length, true);
  v.setUint16(30, 0, true); // extra
  v.setUint16(32, 0, true); // comment
  v.setUint16(34, 0, true); // disk
  v.setUint16(36, 0, true); // internal attributes
  v.setUint32(38, e.attributes, true);
  v.setUint32(42, e.offset, true);
  out.set(e.name, CENTRAL_HEADER_SIZE);
  return out;
}

function endRecord(count: number, size: number, offset: number): Uint8Array {
  const out = new Uint8Array(END_RECORD_SIZE);
  const v = new DataView(out.buffer);
  v.setUint32(0, END_RECORD, true);
  v.setUint16(4, 0, true);
  v.setUint16(6, 0, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  v.setUint16(20, 0, true); // comment
  return out;
}
