/**
 * Fetch a stored recording and return it as base64 for Gemini.
 *
 * WHY THIS EXISTS
 *
 * `transcribeWalkthrough` originally took `audioBase64` from the client. The
 * web recorder can supply that because it holds the MediaRecorder blob in the
 * page already. The mobile app cannot: it records straight to a file, uploads
 * it to `site-videos`, and never has the bytes in JavaScript. Sending them a
 * second time from the phone would mean uploading the whole recording twice,
 * once to storage and once through `/v1/rpc` as JSON, with base64 inflating it
 * by a third on the second trip.
 *
 * So the server reads the object it already has instead. The client passes a
 * storage path; this turns it into the same base64 the op always wanted.
 *
 * THE LIMIT IS REAL AND IS NOT SOLVED HERE
 *
 * Gemini's OpenAI-compatibility endpoint takes inline data only, with a request
 * ceiling in the low tens of megabytes, which is the same wall `inline-image.ts`
 * documents. Reading server-side removes the double upload; it does not make a
 * long recording fit. A walkthrough past roughly a minute of video will exceed
 * the cap and is refused here with a sentence that says so, rather than
 * reaching the gateway and coming back as INVALID_ARGUMENT.
 *
 * Lifting that ceiling properly means sending audio rather than video, and
 * extracting an audio track server-side needs ffmpeg in the API image. That is
 * an infrastructure change, not a code one.
 */

/**
 * Ceiling on the fetched recording, before base64.
 *
 * Base64 inflates by 4/3, so this lands near 16 MB on the wire, leaving room
 * for the prompt inside the endpoint's inline-data limit. Chosen higher than
 * `MAX_IMAGE_BYTES` because a recording is the entire point of the call rather
 * than one attachment among several.
 */
export const MAX_RECORDING_BYTES = 12 * 1024 * 1024;

function megabytes(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

/** Message shown when a recording is past the cap. Exported so tests can pin it. */
export function recordingTooLargeMessage(bytes: number): string {
  return (
    `That recording is too long to transcribe automatically ` +
    `(${megabytes(bytes)} MB, limit ${megabytes(MAX_RECORDING_BYTES)} MB). ` +
    `Record a shorter walkthrough, or transcribe it from the web app.`
  );
}

/**
 * Download a recording from a signed URL and return it base64 encoded.
 *
 * Throws with a readable sentence on every failure path. The caller surfaces
 * these to someone standing on a job site, so "HTTP 416" is not an acceptable
 * outcome.
 */
export async function inlineRecordingAsBase64(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Could not download the recording to transcribe: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`Could not download the recording to transcribe (HTTP ${res.status})`);
  }

  /*
   * Trust the declared length when it is there. Buffering 60 MB into the API
   * process only to reject it is the expensive way to find out, and this runs
   * on a shared Node process rather than a per-request sandbox.
   */
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared && declared > MAX_RECORDING_BYTES) {
    throw new Error(recordingTooLargeMessage(declared));
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_RECORDING_BYTES) {
    throw new Error(recordingTooLargeMessage(buf.byteLength));
  }
  // The same floor the op already applied to a client-supplied payload: below
  // this there is no audio in it, only container headers.
  if (buf.byteLength < 2048) {
    throw new Error("That recording had no audio in it.");
  }

  return buf.toString("base64");
}
