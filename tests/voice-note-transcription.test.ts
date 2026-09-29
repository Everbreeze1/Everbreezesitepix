import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A photo note spoken into the phone's note editor, turned into text.
 *
 * Jon wants to tap the mic, say what a photo shows and have the words become
 * its caption. The phone records an .m4a (AAC in an MP4 container) and sends
 * it to `transcribeVoiceNote`. An MP4 is not an audio format `input_audio`
 * reads, so the AAC track has to go as ADTS "aac", as walkthroughs do. These
 * build a small real .m4a and check the request the model gets, the caps, and
 * that a signed-in member without a live plan is refused before any AI call.
 */

const plan = vi.hoisted(() => ({ isActive: true }));
vi.mock("../apps/api/src/lib/team-plan", () => ({
  getCallerTeamPlan: async () => ({
    isActive: plan.isActive,
    isPro: plan.isActive,
    isTeam: false,
    tier: "pro",
  }),
}));

import {
  VOICE_NOTE_MAX_BYTES,
  transcribeVoiceNoteInputSchema,
  transcribeVoiceNoteService,
  voiceNoteFormat,
} from "../apps/api/src/domains/ai/voice-note";
import { rpcRegistry } from "../apps/api/src/domains/rpc/registry";

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

const bytes = (...values: number[]) => Uint8Array.from(values);

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
function esds(): Uint8Array {
  const asc = bytes(0x12, 0x08);
  const decSpecific = concat(bytes(0x05, asc.length), asc);
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
    bytes(0, 0, 0, 0, 0, 0, 0, 1),
    bytes(0, 0, 0, 0, 0, 0, 0, 0),
    bytes(0, 1, 0, 16, 0, 0, 0, 0),
    u32s(44100 * 65536),
    esds(),
  );
}

/** An audio-only .m4a as expo-audio writes one: ftyp, mdat, then moov. */
function m4a(frameCount: number): Uint8Array {
  const frames = Array.from({ length: frameCount }, (_, i) =>
    new Uint8Array(20).fill((i % 250) + 1),
  );
  const ftyp = box("ftyp", new TextEncoder().encode("M4A "), u32s(0));
  const audio = concat(...frames);
  const mdat = box("mdat", audio);
  const stbl = box(
    "stbl",
    box("stsd", u32s(0, 1), mp4a()),
    box("stsz", u32s(0, 0, frames.length, ...frames.map((f) => f.length))),
    box("stsc", u32s(0, 1, 1, frames.length, 1)),
    box("stco", u32s(0, 1, ftyp.length + 8)),
  );
  const hdlr = box("hdlr", u32s(0, 0), new TextEncoder().encode("soun"), u32s(0, 0, 0), bytes(0));
  const moov = box("moov", box("trak", box("mdia", hdlr, box("minf", stbl))));
  return concat(ftyp, mdat, moov);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
/** One AAC frame at 44.1 kHz is 1024 samples. */
const framesFor = (seconds: number) => Math.ceil((seconds * 44100) / 1024);

const origFetch = globalThis.fetch;
const origKey = process.env.GEMINI_API_KEY;
let calls: Array<{ url: string; body: any }> = [];
let userSeq = 0;

function ctx() {
  userSeq += 1;
  return { supabase: {} as never, userId: `user-${userSeq}`, claims: {} as never };
}

beforeEach(() => {
  plan.isActive = true;
  process.env.GEMINI_API_KEY = "test-key";
  calls = [];
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: " Loose flashing on the north side. " } }],
      }),
      text: async () => "",
    };
  }) as never;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  process.env.GEMINI_API_KEY = origKey;
});

describe("transcribeVoiceNote", () => {
  it("is an authenticated RPC", () => {
    const entry = rpcRegistry.transcribeVoiceNote;
    expect(entry).toBeTruthy();
    expect(entry.public).toBeFalsy();
  });

  it("sends the .m4a's AAC track as aac audio and returns plain text", async () => {
    const result = await transcribeVoiceNoteService(ctx(), {
      audioBase64: b64(m4a(framesFor(5))),
      mimeType: "audio/m4a",
    });
    expect(result).toEqual({ text: "Loose flashing on the north side." });
    expect(calls).toHaveLength(1);
    const audio = calls[0].body.messages[0].content.find((p: any) => p.type === "input_audio");
    expect(audio.input_audio.format).toBe("aac");
    // ADTS sync word, not the MP4's "ftyp".
    const sent = Buffer.from(audio.input_audio.data, "base64");
    expect(sent[0]).toBe(0xff);
    expect(sent[1] & 0xf0).toBe(0xf0);
  });

  it("refuses a note over two minutes before calling the model", async () => {
    const err = await transcribeVoiceNoteService(ctx(), {
      audioBase64: b64(m4a(framesFor(130))),
      mimeType: "audio/m4a",
    }).catch((e) => e);
    expect(err.status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("refuses an empty clip", async () => {
    const err = await transcribeVoiceNoteService(ctx(), {
      audioBase64: b64(new Uint8Array(100)),
      mimeType: "audio/m4a",
    }).catch((e) => e);
    expect(err.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("caps the upload size in the schema", () => {
    const tooBig = "A".repeat(Math.ceil(VOICE_NOTE_MAX_BYTES / 3) * 4 + 4);
    expect(() => transcribeVoiceNoteInputSchema.parse({ audioBase64: tooBig })).toThrow();
    expect(() => transcribeVoiceNoteInputSchema.parse({ audioBase64: "QUJD" })).not.toThrow();
  });

  it("needs an active plan", async () => {
    plan.isActive = false;
    const err = await transcribeVoiceNoteService(ctx(), {
      audioBase64: b64(m4a(framesFor(5))),
      mimeType: "audio/m4a",
    }).catch((e) => e);
    expect(err.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("rate limits one member's notes", async () => {
    const me = ctx();
    const clip = { audioBase64: b64(m4a(framesFor(2))), mimeType: "audio/m4a" };
    for (let i = 0; i < 30; i += 1) await transcribeVoiceNoteService(me, clip);
    const err = await transcribeVoiceNoteService(me, clip).catch((e) => e);
    expect(err.status).toBe(429);
    // Someone else is not held up by it.
    await expect(transcribeVoiceNoteService(ctx(), clip)).resolves.toBeTruthy();
  });

  it("passes audio formats the model reads through, and refuses the rest", () => {
    expect(voiceNoteFormat("audio/wav")).toBe("wav");
    expect(voiceNoteFormat("audio/webm;codecs=opus")).toBe("webm");
    expect(voiceNoteFormat("audio/aac")).toBe("aac");
    expect(voiceNoteFormat("video/mp4")).toBeNull();
    expect(voiceNoteFormat(undefined)).toBeNull();
  });
});
