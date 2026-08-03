import { getSupabaseAdmin } from "./supabase";

/**
 * Signed URLs for photo storage paths, optionally capped to a render width.
 *
 * Two things make this non-obvious enough to be worth centralising:
 *
 *   1. The batch `createSignedUrls` does NOT accept `transform` — only the
 *      singular `createSignedUrl` does. So asking for a width costs one request
 *      per path. That is fine for a bounded set (a showcase, a month of days)
 *      and would be bad for an unbounded one (the whole gallery).
 *   2. Image transformation requires a paid Supabase plan. When it is absent
 *      every request fails, so we detect that and fall back to the batched
 *      original URLs rather than rendering a page of broken images.
 *
 * @param width Max rendered width. Omit to serve originals via the batch call.
 */
export async function signPhotoUrls(
  paths: string[],
  width?: number,
  bucket = "site-photos",
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {};
  const admin = getSupabaseAdmin();
  const out: Record<string, string> = {};

  if (width) {
    const results = await Promise.all(
      unique.map(async (path) => {
        const { data, error } = await admin.storage
          .from(bucket)
          .createSignedUrl(path, 60 * 60, {
            transform: { width, resize: "contain", quality: 80 },
          });
        return { path, url: data?.signedUrl ?? null, failed: !!error };
      }),
    );
    if (!results.every((r) => r.failed)) {
      for (const r of results) if (r.url) out[r.path] = r.url;
      return out;
    }
    console.warn("[photo-urls] image transformation unavailable, serving originals");
  }

  const { data: signed, error } = await admin.storage.from(bucket).createSignedUrls(unique, 60 * 60);
  if (error) {
    console.error("[photo-urls] failed to sign photo URLs", {
      error: error.message,
      count: unique.length,
    });
  }
  signed?.forEach((s, i) => {
    if (s.signedUrl) out[unique[i]] = s.signedUrl;
    else if (s.error) {
      console.error("[photo-urls] failed to sign one photo URL", {
        storagePath: unique[i],
        error: s.error,
      });
    }
  });
  return out;
}
