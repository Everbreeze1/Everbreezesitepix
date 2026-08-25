import type { ReactNode } from "react";
import { Loader2, AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AdminColumn<TRow> {
  /** Stable identity for the column. Not rendered. */
  key: string;
  header: ReactNode;
  cell: (row: TRow) => ReactNode;
  /** Extra classes for this column's cells, e.g. a numeric alignment. */
  className?: string;
  headerClassName?: string;
}

/**
 * The one table the admin area renders.
 *
 * Five pages had each hand-rolled the same `<table>` with the same header
 * styling, the same centred spinner and the same "No x match." paragraph, and
 * all five had independently forgotten the same thing: a way to reach page two.
 * Duplicated markup is cheap to live with; a duplicated *omission* is not, and
 * that is the argument for extracting this rather than leaving it alone.
 *
 * So loading, empty, error and load-more are properties of the table itself.
 * A new admin list gets all four by existing, and cannot ship without them.
 */
export function AdminTable<TRow>({
  columns,
  rows,
  getRowKey,
  isPending,
  isFetchingMore,
  hasMore,
  onLoadMore,
  error,
  emptyMessage = "Nothing to show.",
  caption,
  className,
}: {
  columns: Array<AdminColumn<TRow>>;
  rows: TRow[];
  getRowKey: (row: TRow) => string;
  isPending?: boolean;
  isFetchingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  error?: Error | null;
  emptyMessage?: string;
  /** Rendered under the table. Use it to say what the count above actually counts. */
  caption?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-6", className)}>
      {error ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <AlertTriangle className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-bold text-foreground">Could not load this list</p>
          <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
        </div>
      ) : isPending ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  {columns.map((c) => (
                    <th key={c.key} className={cn("pb-2 pr-4", c.headerClassName)}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={getRowKey(row)} className="border-t border-border">
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn("py-2 pr-4 text-muted-foreground", c.className)}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? "row" : "rows"}
              {hasMore ? " loaded, more available" : " (all loaded)"}
              {caption ? <span className="ml-1">{caption}</span> : null}
            </p>
            {hasMore && onLoadMore && (
              <Button size="sm" variant="outline" onClick={onLoadMore} disabled={isFetchingMore}>
                {isFetchingMore && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Load more
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The same four states for a list that is rendered as cards rather than rows -
 * the audit log and the notification feed, which are too tall and too irregular
 * to be a table but need identical loading, empty and load-more behaviour.
 */
export function AdminList({
  children,
  count,
  isPending,
  isFetchingMore,
  hasMore,
  onLoadMore,
  error,
  emptyMessage = "Nothing to show.",
}: {
  children: ReactNode;
  count: number;
  isPending?: boolean;
  isFetchingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  error?: Error | null;
  emptyMessage?: string;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <AlertTriangle className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-bold text-foreground">Could not load this list</p>
        <p className="max-w-md text-xs text-muted-foreground">{error.message}</p>
      </div>
    );
  }
  if (isPending) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (count === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <>
      {children}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {count} shown{hasMore ? ", more available" : ""}
        </p>
        {hasMore && onLoadMore && (
          <Button size="sm" variant="outline" onClick={onLoadMore} disabled={isFetchingMore}>
            {isFetchingMore && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Load more
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * Why a control on this page is disabled.
 *
 * Rendered next to controls the signed-in admin's role cannot use. The point is
 * that the reason appears where the confusion is: before roles were surfaced, a
 * `support` admin discovered which buttons were theirs by pressing one and
 * reading a 403 in a toast that had already vanished by the time they wondered
 * what happened.
 */
export function CapabilityNotice({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
      <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span>{reason}</span>
    </p>
  );
}
