/**
 * Fetch an image and return it as a `data:` URL for Gemini.
 *
 * WHY THIS EXISTS
 *
 * Every vision call in domains/ai/service.ts passed a signed Supabase Storage
 * URL straight through as `{ type: "image_url", image_url: { url } }`. Against
 * Gemini's OpenAI-compatibility endpoint that fails, every time, for every
 * customer and every plan:
 *
 *   POST /v1/rpc {"op":"analyzePhoto"}
 *     -> 500 "AI gateway error 400: ... INVALID_ARGUMENT"
 *
 * The endpoint does not fetch remote images. It accepts inline base64 only.
 *
 * That this is specifically the *image* payload - not the key, model, endpoint
 * or region - was confirmed by the text-only path working from the same
 * deployment with the same `chatEndpoint()`: `chatWithAssistant` returns 200
 * while `analyzePhoto` and `extractPhotoText` return INVALID_ARGUMENT.
 */

/**
 * Ceiling on the fetched image, before base64.
 *
 * Base64 inflates by 4/3, so this lands around 9.3 MB on the wire - inside
 * Gemini's inline-data limit with headroom for the prompt and the tool schema.
 * Phone photos are typically 2-5 MB, so this only bites on unusually large
 * originals, where failing with a clear message beats a 400 from the gateway.
 */
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

/** Gemini rejects anything that is not actually an image, so check before sending. */
const ALLOWED = /^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/i;

export async function inlineImageAsDataUrl(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Could not download the photo for analysis: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`Could not download the photo for analysis (HTTP ${res.status})`);
  }

  // Trust the declared length when present - cheaper than buffering a 50 MB file
  // only to reject it.
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared && declared > MAX_IMAGE_BYTES) {
    throw new Error(
      `That photo is too large to analyse (${Math.round(declared / 1024 / 1024)} MB).`,
    );
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `That photo is too large to analyse (${Math.round(buf.byteLength / 1024 / 1024)} MB).`,
    );
  }

  // Storage sometimes serves `application/octet-stream` for phone uploads; fall
  // back to JPEG rather than refusing, since that is what the camera paths write.
  const declaredType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const mime = ALLOWED.test(declaredType) ? declaredType : "image/jpeg";

  return `data:${mime};base64,${buf.toString("base64")}`;
}
