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

  /*
   * WHAT CHANGED, AND WHY
   *
   * These used to assert that a provider failure threw an Error carrying the
   * upstream status in its text. It did - and with no `status` property, which
   * is what `jsonFromUnknownError` reads. So every one of them reached the
   * customer, and `api_audit_logs`, as HTTP 500 `internal_error`: the provider
   * throttling us, reported as this server crashing. Thirty of the hundred 5xx
   * on record were exactly this.
   *
   * What matters now is the status, not the prose, so that is what is asserted.
   */
  it("reports an upstream outage as 503, not as our own 500", async () => {
    mockFetch("nope", false, 500);
    const err = await transcribeAudio("QQ", "wav").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status, "upstream failing is not a bug in this codebase").toBe(503);
    // Opted in, so the human-readable half reaches the toast while the raw
    // provider body stays in the server log.
    expect(err.expose).toBe(true);
    expect(err.message).not.toContain("error body");
  });

  it("reports a rate limit as 429 so the caller knows to retry", async () => {
    mockFetch("slow down", false, 429);
    const err = await transcribeAudio("QQ", "wav").catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/try again/i);
  });

  it("reports exhausted credits as 402", async () => {
    mockFetch("no credits", false, 402);
    const err = await transcribeAudio("QQ", "wav").catch((e) => e);
    expect(err.status).toBe(402);
    expect(err.message).toMatch(/credits/i);
  });

  it("never leaks the raw provider body to the caller", async () => {
    // It goes to console.error for an operator; the customer gets a sentence.
    mockFetch("stack trace with internal hostnames", false, 503);
    const err = await transcribeAudio("QQ", "wav").catch((e) => e);
    expect(err.message).not.toContain("error body");
    expect(err.message.length).toBeLessThan(120);
  });
});
