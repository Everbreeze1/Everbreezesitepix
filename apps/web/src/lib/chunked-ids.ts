/**
 * Batch helper for Supabase `.in("id", ids)` calls made from the browser.
 *
 * A PostgREST filter goes in the query string as `?id=in.(uuid,uuid,...)`, about
 * 37 bytes per id. Past roughly 670 ids the Supabase gateway rejects the request
 * URI outright and the user gets a raw PostgREST 400. "Select all" in the photo
 * grid has no upper bound, so on a real project — thousands of photos — every
 * bulk action (hide, trash, move, tag) simply fails.
 *
 * 200 keeps a full batch near 7.4 KB of query string, which is well inside every
 * limit in the path. The API side has the same helper for the same reason, with
 * a longer explanation of the underlying limits: apps/api/src/lib/chunked-in.ts.
 */
const CHUNK_SIZE = 200;

export function chunkIds(ids: readonly string[], size = CHUNK_SIZE): string[][] {
  if (ids.length <= size) return ids.length ? [ids as string[]] : [];
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size) as string[]);
  return out;
}

/**
 * Run a Supabase mutation over `ids` in batches, stopping at the first failure.
 *
 * Sequential, not parallel: these run from a phone on site over a patchy
 * connection, and firing twenty concurrent writes is how you get a partial
 * update plus a hung UI.
 *
 * Not atomic across batches — a failure partway leaves earlier batches applied.
 * That is still far better than the previous all-or-nothing failure above ~670
 * ids, but it means the caller should re-fetch rather than assume its optimistic
 * state is correct.
 *
 * @throws the underlying PostgREST error, so existing `withBusy` error handling
 *   and toasts keep working unchanged.
 */
export async function mutateByIds(
  ids: readonly string[],
  run: (idChunk: string[]) => PromiseLike<{ error: unknown }>,
): Promise<void> {
  for (const idChunk of chunkIds(ids)) {
    const { error } = await run(idChunk);
    if (error) throw error;
  }
}
