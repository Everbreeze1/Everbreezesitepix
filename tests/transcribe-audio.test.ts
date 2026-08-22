import { describe, it, expect, vi, afterEach } from "vitest";
import { transcribeAudio } from "../apps/api/src/domains/ai/service";

/*
 * How audio is transcribed.
 *
 * The bug this fixes: every walkthrough ever recorded came back with an empty
 * transcript, so a narrated walk was summarised as "silent". The cause was the
 * endpoint - Gemini has no Whisper-style /audio/transcriptions, and the URL the
 * code POSTed to answers nothing (HTTP 000). The fix sends the audio as an
 * `input_audio` part on the ordinary chat endpoint, the way Google documents.
 *
 * The live call is geo-blocked from CI and dev, so these mock fetch and assert
 * the request is built exactly as the working endpoint expects. Getting that
 * shape wrong is the whole failure mode, and it is invisible to a typecheck.
 */

const origFetch = globalThis.fetch;
const origKey = process.env.GEMINI_API_KEY;
afterEach(() => {
  globalThis.fetch = origFetch;
  process.env.GEMINI_API_KEY = origKey;
  vi.restoreAllMocks();
});

function mockFetch(responseText: string, ok = true, status = 200) {
  process.env.GEMINI_API_KEY = "test-key";
  const calls: Array<{ url: string; body: any; headers: any }> = [];
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return {
      ok,
      status,
      json: async () => ({ choices: [{ message: { content: responseText } }] }),
      text: async () => "error body",
    };
  }) as never;
  return calls;
}

describe("transcribeAudio", () => {
  it("posts to the chat endpoint, not a transcription endpoint", async () => {
    const calls = mockFetch("hello from the site");
    await transcribeAudio("QUJD", "wav");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/chat/completions");
    expect(calls[0].url).not.toContain("/audio/transcriptions");
  });

  it("sends the audio as an input_audio content part in the documented shape", async () => {
    const calls = mockFetch("transcript");
    await transcribeAudio("QkFTRTY0", "wav");
    const parts = calls[0].body.messages[0].content;
    const audio = parts.find((p: any) => p.type === "input_audio");
    expect(audio).toBeTruthy();
    expect(audio.input_audio).toEqual({ data: "QkFTRTY0", format: "wav" });
    // And a text instruction alongside it, so the model knows to transcribe.
    const text = parts.find((p: any) => p.type === "text");
    expect(text.text.toLowerCase()).toContain("transcribe");
  });

  it("passes the format through verbatim", async () => {
    const calls = mockFetch("x");
    await transcribeAudio("QQ", "webm");
    const audio = calls[0].body.messages[0].content.find((p: any) => p.type === "input_audio");
    expect(audio.input_audio.format).toBe("webm");
  });

  it("returns the model's text, trimmed", async () => {
    mockFetch("  Checking the roof flashing now.  ");
    expect(await transcribeAudio("QQ", "wav")).toBe("Checking the roof flashing now.");
  });

  it("returns empty string when the model heard no speech, without throwing", async () => {
    // A silent recording is a real, non-error outcome - the caller renders a
    // silent walkthrough differently from a failed one.
    mockFetch("");
    await expect(transcribeAudio("QQ", "wav")).resolves.toBe("");
  });

  it("throws on an HTTP error so the caller can retry or report it", async () => {
    mockFetch("nope", false, 500);
    await expect(transcribeAudio("QQ", "wav")).rejects.toThrow(/500/);
  });

  it("surfaces a rate limit as a friendly message", async () => {
    mockFetch("slow down", false, 429);
    await expect(transcribeAudio("QQ", "wav")).rejects.toThrow(/rate limited/i);
  });
});
