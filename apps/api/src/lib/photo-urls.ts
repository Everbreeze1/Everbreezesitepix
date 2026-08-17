import { getSupabaseAdmin } from "./supabase";

/**
 * Signed URLs for photo storage paths, preferring each photo's stored
 * thumbnail.
 *
 * This used to take a `width` and ask Supabase to transform each original on
 * the fly. Two problems with that, and the second is what killed it:
 *
 *   1. The batch `createSignedUrls` does NOT accept `transform` - only the
 *      singular call does - so a width cost one HTTP request per photo.
 *   2. Transformation is metered by *distinct origin image per billing cycle*
 *      (100 on Pro), so the bill grew with how many different photos anyone
 *      looked at. The organization hit 170% of that quota on ~12 MB of stored
 *      photos, and with a spend cap enabled that throttles the project.
 *
 * Thumbnails are now written next to the original at upload time, so the small
 * variant is just another object: one batch call signs the whole set, and
 * nothing is metered. Photos predating that have no `thumb_path` and fall back
 * to their original - never to a transform.
 *
 * Returns a map keyed by the ORIGINAL path regardless of which variant was
 * signed, so callers look up what they already hold.
 */
export async function signPhotoUrls(
  paths: string[],
  opts: { thumbByPath?: Record<string, string | null>; bucket?: string } = {},
): Promise<Record<string, string>> {
  const { thumbByPath, bucket = "site-photos" } = opts;
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};

  // Sign the thumbnail where there is one, the original otherwise, remembering
  // which original each signed path belongs to.
  const originalFor = new Map<string, string>();
  for (const path of unique) originalFor.set(thumbByPath?.[path] || path, path);
  const toSign = Array.from(originalFor.keys());

  const admin = getSupabaseAdmin();
  const { data: signed, error } = await admin.storage
    .from(bucket)
    .createSignedUrls(toSign, 60 * 60);
  if (error) {
    console.error("[photo-urls] failed to sign photo URLs", {
      error: error.message,
      count: toSign.length,
    });
  }

  const out: Record<string, string> = {};
  const unsignedOriginals: string[] = [];
  signed?.forEach((s, i) => {
    const signedPath = toSign[i]!;
    const original = originalFor.get(signedPath)!;
    if (s.signedUrl) {
      out[original] = s.signedUrl;
      return;
    }
    console.error("[photo-urls] failed to sign one photo URL", {
      storagePath: signedPath,
      error: s.error,
    });
    // A thumbnail recorded in the DB but missing from storage would otherwise
    // blank the tile. The original is still there, so retry with that.
    if (signedPath !== original) unsignedOriginals.push(original);
  });

  if (unsignedOriginals.length) {
    const { data: retried } = await admin.storage
      .from(bucket)
      .createSignedUrls(unsignedOriginals, 60 * 60);
    retried?.forEach((s, i) => {
      if (s.signedUrl) out[unsignedOriginals[i]!] = s.signedUrl;
    });
  }

  return out;
}
