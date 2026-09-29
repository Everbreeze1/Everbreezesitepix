import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adtsHeader,
  bufferSource,
  extractAdtsPieces,
  findAacTrack,
  parseAudioSpecificConfig,
  rangeSource,
} from "../apps/api/src/lib/mp4-audio";

/*
 * Why a narrated walkthrough came back with no transcript.
 *
 * The phone's recording is a video file, and the server sent the whole thing
 * to the model as `input_audio` format "mp4": a video container is not an
 * audio format the endpoint reads, and at phone bitrates anything past a few
 * seconds broke the 12 MB inline cap first. The narration was in the file all
 * along - Jon could hear it on playback.
 *
 * The fix copies the AAC sound track out of the MP4 as ADTS. These build a
 * small but structurally real MP4 (moov after mdat, as phones write it, with
 * video chunks interleaved between the audio) and check the copy.
 */

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(new TextEncoder().encode(type), 4);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function u32s(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v));
  return out;
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** AAC-LC, 44.1 kHz, mono: AudioSpecificConfig 0x12 0x08. */
const ASC = bytes(0x12, 0x08);

function esds(): Uint8Array {
  const decSpecific = concat(bytes(0x05, ASC.length), ASC);
  const decoderConfig = concat(
    bytes(0x04, 13 + decSpecific.length, 0x40, 0x15, 0, 0, 0),
    u32s(128000, 128000),
    decSpecific,
  );
  const sl = bytes(0x06, 1, 2);
  const es = concat(bytes(0x03, 3 + decoderConfig.length + sl.length, 0, 1, 0), decoderConfig, sl);
  return box("esds", u32s(0), es);
}

function mp4a(): Uint8Array {
  return box(
    "mp4a",
    bytes(0, 0, 0, 0, 0, 0, 0, 1), // reserved + data reference index
    bytes(0, 0, 0, 0, 0, 0, 0, 0), // version, revision, vendor
    bytes(0, 1, 0, 16, 0, 0, 0, 0), // channels, sample size, compression, packet size
    u32s(44100 * 65536),
    esds(),
  );
}

function soundTrak(sampleSizes: number[], chunkOffsets: number[], perChunk: number): Uint8Array {
  const stbl = box(
    "stbl",
    box("stsd", u32s(0, 1), mp4a()),
    box("stsz", u32s(0, 0, sampleSizes.length, ...sampleSizes)),
    box("stsc", u32s(0, 1, 1, perChunk, 1)),
    box("stco", u32s(0, chunkOffsets.length, ...chunkOffsets)),
  );
  const hdlr = box("hdlr", u32s(0, 0), new TextEncoder().encode("soun"), u32s(0, 0, 0), bytes(0));
  return box("trak", box("mdia", hdlr, box("minf", stbl)));
}

function videoTrak(): Uint8Array {
  const hdlr = box("hdlr", u32s(0, 0), new TextEncoder().encode("vide"), u32s(0, 0, 0), bytes(0));
  return box("trak", box("mdia", hdlr, box("minf", box("stbl"))));
}

/**
 * A file shaped like a phone's: ftyp, then mdat with video and audio chunks
 * interleaved, then moov at the end.
 */
function phoneFile(frameCount: number, perChunk = 4) {
  const frames = Array.from({ length: frameCount }, (_, i) =>
    new Uint8Array(20 + (i % 5)).fill((i % 250) + 1),
  );
  const ftyp = box("ftyp", new TextEncoder().encode("isom"), u32s(0));
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = ftyp.length + 8;
  for (let first = 0; first < frames.length; first += perChunk) {
    const video = new Uint8Array(300).fill(0xee);
    chunks.push(video);
    at += video.length;
    offsets.push(at);
    const audio = concat(...frames.slice(first, first + perChunk));
    chunks.push(audio);
    at += audio.length;
  }
  const mdat = box("mdat", ...chunks);
  const moov = box(
    "moov",
    videoTrak(),
    soundTrak(
      frames.map((f) => f.length),
      offsets,
      perChunk,
    ),
  );
  return { file: concat(ftyp, mdat, moov), frames };
}

/** Undo the ADTS framing, checking every header on the way. */
function unframe(adts: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at < adts.length) {
    expect(adts[at]).toBe(0xff);
    expect(adts[at + 1] & 0xf0).toBe(0xf0);
    const len = ((adts[at + 3] & 3) << 11) | (adts[at + 4] << 3) | (adts[at + 5] >> 5);
    out.push(adts.slice(at + 7, at + len));
    at += len;
  }
  return out;
}

describe("finding the narration in a phone recording", () => {
  it("finds the AAC sound track behind a video track, with moov after mdat", async () => {
    const { file, frames } = phoneFile(10);
    const track = await findAacTrack(bufferSource(file));
    expect(track).not.toBeNull();
    expect(track!.sampleRate).toBe(44100);
    expect(track!.profile).toBe(1); // AAC-LC
    expect(track!.channelConfig).toBe(1);
    expect(track!.samples).toHaveLength(frames.length);
  });

  it("copies exactly the audio frames, in order, as ADTS", async () => {
    const { file, frames } = phoneFile(23, 4);
    const source = bufferSource(file);
    const track = (await findAacTrack(source))!;
    const pieces = await extractAdtsPieces(source, track, { pieceSeconds: 600 });
    expect(pieces).toHaveLength(1);
    const out = unframe(pieces[0].bytes);
    expect(out.map((f) => Array.from(f))).toEqual(frames.map((f) => Array.from(f)));
    // None of the video bytes (0xee) leaked into the audio.
    expect(pieces[0].bytes.includes(0xee)).toBe(false);
  });

  it("cuts long audio into pieces that know where they start", async () => {
    // 44.1 kHz AAC is 1024 samples a frame: 431 frames is about 10 seconds.
    const { file } = phoneFile(431, 8);
    const source = bufferSource(file);
    const track = (await findAacTrack(source))!;
    const pieces = await extractAdtsPieces(source, track, { pieceSeconds: 2 });
    expect(pieces.length).toBe(5);
    expect(pieces[0].startSeconds).toBe(0);
    expect(pieces[1].startSeconds).toBeCloseTo(2, 1);
    const total = pieces.reduce((n, p) => n + p.durationSeconds, 0);
    expect(total).toBeCloseTo((431 * 1024) / 44100, 3);
  });

  it("answers null for a file with no sound track, so the old path is used", async () => {
    const ftyp = box("ftyp", new TextEncoder().encode("isom"), u32s(0));
    const file = concat(ftyp, box("mdat", new Uint8Array(64)), box("moov", videoTrak()));
    expect(await findAacTrack(bufferSource(file))).toBeNull();
  });

  it("answers null for something that is not an MP4 at all (the web's WAV)", async () => {
    const wav = concat(new TextEncoder().encode("RIFF"), u32s(4000), new Uint8Array(4000));
    expect(await findAacTrack(bufferSource(wav))).toBeNull();
  });
});

describe("ADTS framing", () => {
  it("writes a header decoders accept", () => {
    const h = adtsHeader(100, 1, 4, 2);
    expect(h).toHaveLength(7);
    expect(h[0]).toBe(0xff);
    expect(h[1]).toBe(0xf1);
    expect((h[2] >> 6) & 3).toBe(1); // LC
    expect((h[2] >> 2) & 15).toBe(4); // 44.1 kHz
    const len = ((h[3] & 3) << 11) | (h[4] << 3) | (h[5] >> 5);
    expect(len).toBe(107);
  });

  it("reads the core codec from an HE-AAC config", () => {
    // AOT 5 (SBR), 24 kHz core, stereo, extension 48 kHz, core AOT 2.
    // 00101 0110 0010 0011 00010 -> 0x2B 0x11 0x88 (padded)
    expect(parseAudioSpecificConfig(bytes(0x2b, 0x11, 0x88, 0x00))).toEqual({
      profile: 1,
      freqIndex: 6,
      channelConfig: 2,
    });
  });
});

describe("reading over range requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  function rangeServer(file: Uint8Array) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const range = new Headers(init?.headers).get("range") ?? "";
        calls.push(range);
        const m = /bytes=(\d+)-(\d+)/.exec(range);
        if (!m) return new Response(file, { status: 200 });
        const start = Number(m[1]);
        const end = Math.min(file.length - 1, Number(m[2]));
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: { "content-range": `bytes ${start}-${end}/${file.length}` },
        });
      }),
    );
    return calls;
  }

  it("downloads the index and the audio, not the whole file", async () => {
    const { file, frames } = phoneFile(40, 4);
    const calls = rangeServer(file);
    const source = (await rangeSource("https://storage.example/signed"))!;
    expect(source.size).toBe(file.length);
    const track = (await findAacTrack(source))!;
    const pieces = await extractAdtsPieces(source, track, { pieceSeconds: 600 });
    expect(unframe(pieces[0].bytes)).toHaveLength(frames.length);
    expect(calls.every((c) => c.startsWith("bytes="))).toBe(true);
  });

  it("gives up on ranges when the server ignores them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(10), { status: 200 })),
    );
    expect(await rangeSource("https://storage.example/signed")).toBeNull();
  });
});
