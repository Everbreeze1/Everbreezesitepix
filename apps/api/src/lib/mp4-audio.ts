/**
 * Pull the AAC narration out of a phone's MP4 / QuickTime recording, in plain
 * TypeScript.
 *
 * WHY THIS EXISTS
 *
 * The phone records a walkthrough as a video file and the server used to send
 * the whole file to Gemini as `input_audio` with format "mp4". Two things went
 * wrong with that, and together they are why a walk the technician can hear
 * themselves narrating came back with no transcript:
 *
 *  1. `input_audio` is audio. A video container labelled "mp4" is not one of
 *     the audio formats the endpoint documents (wav, mp3, aac, ogg, flac,
 *     aiff), and the prompt tells the model to output nothing when it hears
 *     no speech, so an unreadable part came back as an empty transcript rather
 *     than an error.
 *  2. A phone records video at 10 to 20 Mbit/s. The inline ceiling is 12 MB,
 *     which is a handful of seconds of footage, so any real walkthrough was
 *     refused as "too long to transcribe" before the model saw it.
 *
 * The narration itself is small: an AAC track at 64 to 256 kbit/s, about a
 * megabyte a minute. So this reads the file's index (`moov`), finds the sound
 * track, and copies only its samples out, framed as ADTS - the self-describing
 * `.aac` form every decoder, Gemini included, reads. There is no ffmpeg in the
 * API image and no package is needed for this: it is byte copying, not
 * decoding.
 *
 * Reads go through a `ByteSource` so the same code runs against a Buffer in
 * tests and against HTTP range requests on a signed storage URL in production.
 * Over ranges, only the box headers, the index and the audio chunks are ever
 * downloaded, never the video, which is nearly all of the file.
 */

export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface AacTrack {
  /** Core sample rate from the AudioSpecificConfig; frames are 1024 samples at this rate. */
  sampleRate: number;
  /** ADTS profile (audio object type minus one). */
  profile: number;
  freqIndex: number;
  channelConfig: number;
  samples: Array<{ offset: number; size: number }>;
}

export interface AdtsPiece {
  /** Seconds from the start of the recording where this piece begins. */
  startSeconds: number;
  durationSeconds: number;
  bytes: Uint8Array;
}

const SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

/** Largest `moov` this will read. A ten minute phone recording's is a few hundred KB. */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
/** Largest audio track this will copy out. Well past a ten minute walk at 256 kbit/s. */
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function u16(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1];
}

function u64(b: Uint8Array, at: number): number {
  return u32(b, at) * 2 ** 32 + u32(b, at + 4);
}

function fourcc(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

type Box = { type: string; start: number; end: number };

/** The boxes directly inside `[start, end)` of `b`, as payload ranges. */
function children(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = u32(b, at);
    const type = fourcc(b, at + 4);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      size = u64(b, at + 8);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

function child(b: Uint8Array, box: Box | undefined, type: string): Box | undefined {
  if (!box) return undefined;
  return children(b, box.start, box.end).find((c) => c.type === type);
}

/** Find the top-level `moov` box and return its bytes. */
async function readMoov(src: ByteSource): Promise<Uint8Array | null> {
  let at = 0;
  // A few dozen top-level boxes at most in a camera file; the bound stops a
  // corrupt size field from spinning here.
  for (let guard = 0; guard < 256 && at + 8 <= src.size; guard += 1) {
    const head = await src.read(at, Math.min(16, src.size - at));
    if (head.length < 8) return null;
    let size = u32(head, 0);
    const type = fourcc(head, 4);
    let header = 8;
    if (size === 1) {
      if (head.length < 16) return null;
      size = u64(head, 8);
      header = 16;
    } else if (size === 0) {
      size = src.size - at;
    }
    if (size < header) return null;
    if (type === "moov") {
      if (size > MAX_MOOV_BYTES) return null;
      const body = await src.read(at, size);
      return body.length === size ? body : null;
    }
    at += size;
  }
  return null;
}

class Bits {
  private pos = 0;
  constructor(private readonly b: Uint8Array) {}
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      const byte = this.b[this.pos >> 3] ?? 0;
      v = v * 2 + ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos += 1;
    }
    return v;
  }
}

function freqIndexFor(rate: number): number {
  const exact = SAMPLE_RATES.indexOf(rate);
  return exact;
}

/** Parse an AudioSpecificConfig into what an ADTS header needs. */
export function parseAudioSpecificConfig(
  asc: Uint8Array,
): { profile: number; freqIndex: number; channelConfig: number } | null {
  if (asc.length < 2) return null;
  const bits = new Bits(asc);
  const readAot = () => {
    const aot = bits.read(5);
    return aot === 31 ? 32 + bits.read(6) : aot;
  };
  const readFreq = () => {
    const idx = bits.read(4);
    return idx === 15 ? freqIndexFor(bits.read(24)) : idx;
  };
  let aot = readAot();
  let freqIndex = readFreq();
  const channelConfig = bits.read(4);
  if (aot === 5 || aot === 29) {
    // HE-AAC with explicit signalling: the core codec follows the extension
    // rate. ADTS carries the core (implicit SBR), which every decoder handles.
    readFreq();
    aot = readAot();
  }
  const profile = aot - 1;
  if (profile < 0 || profile > 3) return null;
  if (freqIndex < 0 || freqIndex > 12) return null;
  if (channelConfig < 1 || channelConfig > 7) return null;
  return { profile, freqIndex, channelConfig };
}

/** Length of an MPEG-4 descriptor, and where its body starts. */
function descriptor(b: Uint8Array, at: number, end: number) {
  if (at >= end) return null;
  const tag = b[at];
  let len = 0;
  let p = at + 1;
  for (let i = 0; i < 4 && p < end; i += 1) {
    const byte = b[p];
    p += 1;
    len = (len << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) break;
  }
  return { tag, body: p, end: Math.min(end, p + len) };
}

/** The AudioSpecificConfig inside an `esds` box payload. */
function ascFromEsds(b: Uint8Array, box: Box): Uint8Array | null {
  const es = descriptor(b, box.start + 4, box.end);
  if (!es || es.tag !== 0x03) return null;
  let p = es.body + 2;
  const flags = b[p];
  p += 1;
  if (flags & 0x80) p += 2;
  if (flags & 0x40) p += 1 + b[p];
  if (flags & 0x20) p += 2;
  while (p < es.end) {
    const d = descriptor(b, p, es.end);
    if (!d) return null;
    if (d.tag === 0x04) {
      // objectTypeIndication 0x40 is MPEG-4 audio, 0x66-0x68 MPEG-2 AAC.
      const oti = b[d.body];
      if (oti !== 0x40 && (oti < 0x66 || oti > 0x68)) return null;
      let q = d.body + 13;
      while (q < d.end) {
        const inner = descriptor(b, q, d.end);
        if (!inner) return null;
        if (inner.tag === 0x05) return b.slice(inner.body, inner.end);
        q = inner.end;
      }
      return null;
    }
    p = d.end;
  }
  return null;
}

/** Search a sample entry's children (and a QuickTime `wave` inside it) for `esds`. */
function findEsds(b: Uint8Array, start: number, end: number): Box | undefined {
  for (const c of children(b, start, end)) {
    if (c.type === "esds") return c;
    if (c.type === "wave") {
      const inner = findEsds(b, c.start, c.end);
      if (inner) return inner;
    }
  }
  return undefined;
}

function audioConfig(b: Uint8Array, stsd: Box) {
  const entry = children(b, stsd.start + 8, stsd.end)[0];
  if (!entry || entry.type !== "mp4a") return null;
  // SampleEntry (8) + AudioSampleEntry (20) = 28 bytes before child boxes.
  // QuickTime sound descriptions add 16 (version 1) or 36 (version 2).
  const version = u16(b, entry.start + 8);
  const childStart = entry.start + 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
  const esds = findEsds(b, childStart, entry.end);
  const asc = esds ? ascFromEsds(b, esds) : null;
  const parsed = asc ? parseAudioSpecificConfig(asc) : null;
  if (parsed) return parsed;
  // No usable config: fall back to the entry's own fields and assume AAC-LC,
  // which is what a phone records.
  if (version !== 0 && version !== 1) return null;
  const channels = u16(b, entry.start + 16);
  const rate = u32(b, entry.start + 24) >>> 16;
  const freqIndex = freqIndexFor(rate);
  if (freqIndex < 0 || channels < 1 || channels > 7) return null;
  return { profile: 1, freqIndex, channelConfig: channels };
}

function sampleTable(b: Uint8Array, stbl: Box): Array<{ offset: number; size: number }> | null {
  const stsz = child(b, stbl, "stsz");
  const stsc = child(b, stbl, "stsc");
  const stco = child(b, stbl, "stco");
  const co64 = child(b, stbl, "co64");
  if (!stsz || !stsc || (!stco && !co64)) return null;

  const fixedSize = u32(b, stsz.start + 4);
  const sampleCount = u32(b, stsz.start + 8);
  const sizeAt = (i: number) => (fixedSize ? fixedSize : u32(b, stsz.start + 12 + i * 4));
  if (!fixedSize && stsz.start + 12 + sampleCount * 4 > stsz.end) return null;

  const offsets: number[] = [];
  if (co64) {
    const n = u32(b, co64.start + 4);
    for (let i = 0; i < n && co64.start + 8 + i * 8 + 8 <= co64.end; i += 1) {
      offsets.push(u64(b, co64.start + 8 + i * 8));
    }
  } else if (stco) {
    const n = u32(b, stco.start + 4);
    for (let i = 0; i < n && stco.start + 8 + i * 4 + 4 <= stco.end; i += 1) {
      offsets.push(u32(b, stco.start + 8 + i * 4));
    }
  }

  const runs: Array<{ firstChunk: number; perChunk: number }> = [];
  const runCount = u32(b, stsc.start + 4);
  for (let i = 0; i < runCount && stsc.start + 8 + i * 12 + 12 <= stsc.end; i += 1) {
    const at = stsc.start + 8 + i * 12;
    runs.push({ firstChunk: u32(b, at), perChunk: u32(b, at + 4) });
  }
  if (!runs.length) return null;

  const samples: Array<{ offset: number; size: number }> = [];
  let sample = 0;
  for (let r = 0; r < runs.length && sample < sampleCount; r += 1) {
    const lastChunk = r + 1 < runs.length ? runs[r + 1].firstChunk - 1 : offsets.length;
    for (let chunk = runs[r].firstChunk; chunk <= lastChunk && sample < sampleCount; chunk += 1) {
      let at = offsets[chunk - 1];
      if (at === undefined) return samples.length ? samples : null;
      for (let k = 0; k < runs[r].perChunk && sample < sampleCount; k += 1) {
        const size = sizeAt(sample);
        samples.push({ offset: at, size });
        at += size;
        sample += 1;
      }
    }
  }
  return samples;
}

/**
 * Locate the AAC sound track in an MP4 or QuickTime file.
 *
 * Null when there is none that can be copied out as ADTS: no `moov` (a
 * fragmented or truncated file), no sound track, or a codec other than AAC.
 * The caller then falls back to sending the file as it is.
 */
export async function findAacTrack(src: ByteSource): Promise<AacTrack | null> {
  const moov = await readMoov(src);
  if (!moov) return null;
  const root: Box = { type: "moov", start: 8, end: moov.length };
  if (u32(moov, 0) === 1) root.start = 16;

  for (const trak of children(moov, root.start, root.end).filter((c) => c.type === "trak")) {
    const mdia = child(moov, trak, "mdia");
    const hdlr = child(moov, mdia, "hdlr");
    if (!hdlr || fourcc(moov, hdlr.start + 8) !== "soun") continue;
    const stbl = child(moov, child(moov, mdia, "minf"), "stbl");
    const stsd = child(moov, stbl, "stsd");
    if (!stbl || !stsd) continue;
    const config = audioConfig(moov, stsd);
    if (!config) continue;
    const samples = sampleTable(moov, stbl);
    if (!samples || !samples.length) continue;
    return { ...config, sampleRate: SAMPLE_RATES[config.freqIndex], samples };
  }
  return null;
}

/** The seven byte ADTS header for one raw AAC frame. */
export function adtsHeader(
  frameBytes: number,
  profile: number,
  freqIndex: number,
  channelConfig: number,
): Uint8Array {
  const len = frameBytes + 7;
  return Uint8Array.from([
    0xff,
    0xf1,
    ((profile & 3) << 6) | ((freqIndex & 15) << 2) | ((channelConfig >> 2) & 1),
    ((channelConfig & 3) << 6) | ((len >> 11) & 3),
    (len >> 3) & 0xff,
    ((len & 7) << 5) | 0x1f,
    0xfc,
  ]);
}

/**
 * Copy the track's frames out and cut them into ADTS pieces of about
 * `pieceSeconds` each.
 *
 * Pieces rather than one blob so each fits the inline ceiling comfortably, and
 * so a transcript's timestamps can never drift further than one piece: each
 * piece knows exactly where in the recording it starts, counted in frames.
 *
 * `mergeGap` joins neighbouring reads whose gap is at most that many bytes.
 * Over HTTP that trades a little wasted video for far fewer requests.
 */
export async function extractAdtsPieces(
  src: ByteSource,
  track: AacTrack,
  options: { pieceSeconds?: number; mergeGap?: number; concurrency?: number } = {},
): Promise<AdtsPiece[]> {
  const pieceSeconds = options.pieceSeconds ?? 60;
  const mergeGap = options.mergeGap ?? 0;
  const concurrency = Math.max(1, options.concurrency ?? 6);

  const total = track.samples.reduce((sum, s) => sum + s.size, 0);
  if (total > MAX_AUDIO_BYTES) {
    throw new Error("The recording's audio track is too large to transcribe automatically.");
  }

  // Contiguous (or nearly) samples become one read.
  const sorted = track.samples
    .map((s, index) => ({ ...s, index }))
    .filter((s) => s.size > 0 && s.offset + s.size <= src.size)
    .sort((a, b) => a.offset - b.offset);
  const ranges: Array<{ start: number; end: number; data?: Uint8Array }> = [];
  for (const s of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && s.offset <= last.end + mergeGap) {
      last.end = Math.max(last.end, s.offset + s.size);
    } else {
      ranges.push({ start: s.offset, end: s.offset + s.size });
    }
  }

  let next = 0;
  async function worker() {
    while (next < ranges.length) {
      const range = ranges[next];
      next += 1;
      range.data = await src.read(range.start, range.end - range.start);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ranges.length) }, worker));

  // Frames back in presentation order, each sliced out of its read.
  const frames: Uint8Array[] = new Array(track.samples.length);
  let r = 0;
  for (const s of sorted) {
    while (r < ranges.length && ranges[r].end < s.offset + s.size) r += 1;
    const range = ranges[r];
    if (!range?.data) continue;
    const at = s.offset - range.start;
    frames[s.index] = range.data.subarray(at, at + s.size);
  }

  const frameSeconds = 1024 / track.sampleRate;
  const perPiece = Math.max(1, Math.round(pieceSeconds / frameSeconds));
  const pieces: AdtsPiece[] = [];
  for (let first = 0; first < frames.length; first += perPiece) {
    const slice = frames.slice(first, first + perPiece).filter(Boolean);
    if (!slice.length) continue;
    const size = slice.reduce((sum, f) => sum + f.length + 7, 0);
    const out = new Uint8Array(size);
    let at = 0;
    for (const f of slice) {
      out.set(adtsHeader(f.length, track.profile, track.freqIndex, track.channelConfig), at);
      out.set(f, at + 7);
      at += f.length + 7;
    }
    pieces.push({
      startSeconds: first * frameSeconds,
      durationSeconds: Math.min(perPiece, frames.length - first) * frameSeconds,
      bytes: out,
    });
  }
  // A last sliver of a second or two carries little speech and costs a whole
  // model call; fold it into the piece before.
  if (pieces.length > 1 && pieces[pieces.length - 1].durationSeconds < 5) {
    const tail = pieces.pop()!;
    const prev = pieces[pieces.length - 1];
    const joined = new Uint8Array(prev.bytes.length + tail.bytes.length);
    joined.set(prev.bytes, 0);
    joined.set(tail.bytes, prev.bytes.length);
    pieces[pieces.length - 1] = {
      startSeconds: prev.startSeconds,
      durationSeconds: prev.durationSeconds + tail.durationSeconds,
      bytes: joined,
    };
  }
  return pieces;
}

/** A `ByteSource` over bytes already in memory. */
export function bufferSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
  };
}

/**
 * A `ByteSource` over HTTP range requests, or null when the server does not
 * honour ranges (the caller then downloads the file whole, as before).
 */
export async function rangeSource(url: string): Promise<ByteSource | null> {
  const first = await fetch(url, { headers: { Range: "bytes=0-15" } });
  if (first.status !== 206) {
    await first.body?.cancel().catch(() => {});
    return null;
  }
  const total = Number(/\/(\d+)\s*$/.exec(first.headers.get("content-range") ?? "")?.[1] ?? NaN);
  await first.arrayBuffer().catch(() => null);
  if (!Number.isFinite(total) || total <= 0) return null;

  return {
    size: total,
    async read(offset, length) {
      const end = Math.min(total, offset + length) - 1;
      if (end < offset) return new Uint8Array(0);
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const res = await fetch(url, { headers: { Range: `bytes=${offset}-${end}` } });
          if (res.status !== 206 && res.status !== 200) {
            throw new Error(`HTTP ${res.status}`);
          }
          const buf = new Uint8Array(await res.arrayBuffer());
          // A server that ignored the range sent the whole file; take our slice.
          return res.status === 200 ? buf.subarray(offset, end + 1) : buf;
        } catch (e) {
          lastError = e;
        }
      }
      throw new Error(
        `Could not download the recording to transcribe: ${(lastError as Error)?.message ?? "unknown error"}`,
      );
    },
  };
}
