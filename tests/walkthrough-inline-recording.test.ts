import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RECORDING_BYTES,
  inlineRecordingAsBase64,
  recordingTooLargeMessage,
} from "../apps/api/src/lib/inline-recording";

/*
 * Reading a walkthrough recording out of storage so the phone does not have to
 * upload it twice.
 *
 * The size ceiling is the interesting part. Gemini's compatibility endpoint
 * takes inline data only, so a long recording cannot be transcribed this way at
 * all, and the difference between failing here and failing at the gateway is
 * the difference between a sentence someone can act on and INVALID_ARGUMENT.
 */

function response(body: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inlineRecordingAsBase64", () => {
  it("returns the object as base64", async () => {
    const bytes = new Uint8Array(4096).fill(7);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(bytes)),
    );

    const encoded = await inlineRecordingAsBase64("https://storage.example/signed");

    expect(Buffer.from(encoded, "base64")).toHaveLength(4096);
  });

  it("rejects on the declared length without downloading the file", async () => {
    /*
     * Buffering 60 MB into the API process only to reject it is the expensive
     * way to find out, and this runs on a shared Node process rather than a
     * per-request sandbox. `content-length` answers it for free.
     */
    const fetchMock = vi.fn(async () =>
      response(new Uint8Array(8), { "content-length": String(MAX_RECORDING_BYTES + 1) }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(inlineRecordingAsBase64("https://storage.example/big")).rejects.toThrow(
      /too long to transcribe/i,
    );
  });

  it("still rejects when the server declared no length", async () => {
    // Supabase signed URLs normally set it, but a proxy in between may not, and
    // the cap has to hold either way.
    const oversized = new Uint8Array(MAX_RECORDING_BYTES + 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(oversized)),
    );

    await expect(inlineRecordingAsBase64("https://storage.example/big")).rejects.toThrow(
      /too long to transcribe/i,
    );
  });

  it("says what to do about it, not just that it failed", async () => {
    const message = recordingTooLargeMessage(40 * 1024 * 1024);
    expect(message).toContain("40 MB");
    expect(message).toMatch(/shorter walkthrough|web app/i);
  });

  it("treats a file with no audio as a failure worth naming", async () => {
    // Below this there is nothing in it but container headers.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(new Uint8Array(64))),
    );

    await expect(inlineRecordingAsBase64("https://storage.example/empty")).rejects.toThrow(
      /no audio in it/i,
    );
  });

  it("reports a download failure readably", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );

    await expect(inlineRecordingAsBase64("https://storage.example/gone")).rejects.toThrow(
      /could not download the recording/i,
    );
  });

  it("reports a network failure readably", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    );

    await expect(inlineRecordingAsBase64("https://storage.example/x")).rejects.toThrow(
      /could not download the recording.*socket hang up/i,
    );
  });
});

describe("the ceiling itself", () => {
  it("leaves room for base64 inflation inside the inline-data limit", () => {
    /*
     * Base64 is 4/3 of the raw bytes. The cap has to land under the endpoint's
     * inline ceiling with the prompt still to fit, which is the same reasoning
     * `inline-image.ts` documents for photos.
     */
    const onTheWire = (MAX_RECORDING_BYTES * 4) / 3;
    expect(onTheWire).toBeLessThan(20 * 1024 * 1024);
  });
});

describe("controls over the camera preview stay legible", () => {
  /*
   * "Snap photo" was white text painted straight onto the live preview, while
   * Close, the elapsed timer and the photo count all sat on `chip` - a dark
   * translucent pill. Three of the four controls were readable over anything;
   * the fourth was readable over whatever happened to be dark.
   *
   * On a jobsite the bright subject is the normal case: a sunlit wall, a white
   * ceiling, a snow-covered roof, a lit ceiling void. White on white is nothing
   * at all, and this is the control that captures the still somebody walked
   * across a site to take.
   *
   * Seen on a device. It cannot be seen anywhere else: the accessibility tree
   * reports the label whatever colour it is drawn in, and every type and test
   * was green.
   */
  const screen = () =>
    readFileSync(
      join(process.cwd(), "apps/mobile/app/(app)/project/[id]/walkthrough-record.tsx"),
      "utf8",
    );

  it("the snap control sits on the same pill as the others", () => {
    expect(screen()).toContain("style={[styles.chip, styles.sideAction]}");
  });

  it("the pill is actually opaque enough to read on", () => {
    /*
     * Tied to the value rather than the name: a `chip` that became transparent
     * would leave the control exactly as unreadable while this test still
     * passed on the style reference alone.
     */
    /*
     * Sliced forward from the style's definition, not between two names:
     * `recordingChip` is referenced in the JSX long before the style block, so
     * slicing to its first mention ran backwards and searched an empty string -
     * which reported the background missing while it was there.
     */
    const s = screen();
    const at = s.indexOf("  chip: {");
    const chip = at === -1 ? "" : s.slice(at, at + 200);
    const alpha = chip.match(/rgba\(0,0,0,([\d.]+)\)/);
    expect(alpha, "chip should keep a solid dark background").not.toBeNull();
    expect(Number(alpha![1])).toBeGreaterThanOrEqual(0.5);
  });

  it("no tappable control over the preview is left with bare text", () => {
    /*
     * Pressables only. `sideAction` is also used on its own for an empty spacer
     * that balances the row so the record button stays centred - that one draws
     * nothing and needs no backing, and an earlier version of this test flagged
     * it.
     */
    const s = screen();
    const pressables = [...s.matchAll(/<Pressable[\s\S]*?>/g)].map((m) => m[0]);
    const bare = pressables.filter((p) => /style=\{styles\.sideAction\}/.test(p));
    expect(bare).toEqual([]);
  });
});
