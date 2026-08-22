import { useInfiniteQuery } from "@tanstack/react-query";

/**
 * The cursor-paginated list shape every admin service returns.
 *
 * All five of them already answered with `nextCursor` and a `limit + 1`
 * look-ahead. Not one page consumed it: every admin screen called the service
 * once, rendered the first fifty rows and dropped the cursor on the floor. The
 * users table could not reach account fifty-one, and the audit log - the one
 * screen whose entire purpose is answering "what happened before" - lost every
 * action older than the last fifty with no indication that it had.
 *
 * This hook is the missing half. It exists rather than each page calling
 * `useInfiniteQuery` directly so that the cursor plumbing is written once and a
 * new admin list cannot repeat the omission: `rows` is already flattened, and
 * `hasMore` comes from the server's cursor rather than from a row count that
 * would lie on an exactly-full final page.
 */
export interface AdminListPage {
  nextCursor: string | null;
}

export interface AdminList<TRow> {
  rows: TRow[];
  /** First load only. Fetching a later page keeps the existing rows on screen. */
  isPending: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  error: Error | null;
}

export function useAdminList<TPage extends AdminListPage, TRow>({
  queryKey,
  fetchPage,
  rowsOf,
  enabled = true,
}: {
  queryKey: readonly unknown[];
  fetchPage: (cursor: string | undefined) => Promise<TPage>;
  rowsOf: (page: TPage) => TRow[];
  enabled?: boolean;
}): AdminList<TRow> {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    // `?? undefined` rather than passing the null through: react-query treats
    // null as "there is another page" and only undefined as the end.
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });

  return {
    rows: query.data?.pages.flatMap(rowsOf) ?? [],
    isPending: query.isPending,
    isFetchingMore: query.isFetchingNextPage,
    hasMore: !!query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    error: (query.error as Error | null) ?? null,
  };
}
