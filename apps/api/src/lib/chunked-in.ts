/**
 * Chunked `.in(...)` helpers for PostgREST.
 *
 * WHY THIS EXISTS
 *
 * PostgREST echoes the request's filter back in the `Content-Location`
 * *response* header. A `?id=in.(uuid,uuid,...)` filter is ~37 bytes per id, so
 * the echoed header crosses Node's default 16 KB `maxHeaderSize` at roughly 400
 * ids and the fetch fails with `Headers Overflow Error`. Measured against this
 * project: 398 ids OK, 400 ids fail. Higher still (~672) and the Supabase
 * gateway rejects the request URI outright.
 *
 * That limit produced four separate customer-visible bugs — a public report PDF
 * that rendered with **zero photos** and still returned HTTP 200, trash bulk
 * restore/delete 500ing on "Select all", the cron trash purge silently never
 * deleting anything above ~397 rows, and browser bulk actions failing with a raw
 * PostgREST 400. All four were one root cause plus, in the read paths, a
 * destructured `const { data }` that dropped the error on the floor so the
 * failure looked like an empty result set.
 *
 * Raising `--max-http-header-size` would move the wall, not remove it, and would
 * not help the URI limit at all. Chunking removes both.
 *
 * These helpers also make errors non-optional: they throw. A partial photo list
 * in a construction report is worse than an error, because nobody can tell it is
 * wrong by looking at it.
 */

/**
 * Ids per request. ~37 bytes each puts a full chunk near 7.4 KB of echoed
 * header — comfortably under the 16 KB limit with room for the rest of the
 * response headers, and well under the URI cap.
 */
export const IN_CHUNK_SIZE = 200;

export function chunk<T>(items: readonly T[], size = IN_CHUNK_SIZE): T[][] {
  if (items.length <= size) return items.length ? [items as T[]] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}

type Postgrestish<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Run a SELECT ... IN (...) in safe batches and concatenate the rows.
 *
 * `run` receives one chunk of ids and must return the PostgREST builder for it.
 * Chunks are issued sequentially rather than in parallel: these call sites are
 * report/PDF generation and cron sweeps, where a predictable load on the
 * database matters more than latency, and a stampede of 25 parallel queries is
 * how you turn a big report into an outage for everyone else.
 *
 * @throws if any chunk fails — callers must not silently render partial data.
 */
export async function selectIn<T>(
  ids: readonly string[],
  run: (idChunk: string[]) => Postgrestish<T>,
  label = "query",
): Promise<T[]> {
  const out: T[] = [];
  for (const idChunk of chunk(ids)) {
    const { data, error } = await run(idChunk);
    if (error) throw new Error(`${label}: ${error.message}`);
    if (data?.length) out.push(...data);
  }
  return out;
}

/**
 * Run a write (UPDATE/DELETE) filtered by `IN (...)` in safe batches.
 *
 * Not atomic across chunks — PostgREST gives one statement per request — so a
 * failure partway leaves earlier chunks applied. That is still strictly better
 * than the previous behaviour, where the whole operation failed for everyone
 * above the limit and nothing was applied at all. Callers doing something
 * destructive should surface the error rather than reporting success.
 *
 * @throws on the first failing chunk.
 */
export async function mutateIn(
  ids: readonly string[],
  run: (idChunk: string[]) => PromiseLike<{ error: { message: string } | null }>,
  label = "mutation",
): Promise<void> {
  for (const idChunk of chunk(ids)) {
    const { error } = await run(idChunk);
    if (error) throw new Error(`${label}: ${error.message}`);
  }
}
