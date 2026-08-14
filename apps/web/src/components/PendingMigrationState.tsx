import { Database, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The database is behind the code - a column this screen selects does not exist
 * yet because its migration has not been applied.
 *
 * A distinct state rather than a nicer `ErrorState` string, because the two are
 * nothing alike from the reader's side. "You may be offline, try again" invites a
 * retry that can never succeed and sends the reader to check their signal; this
 * names the file to run and takes about a minute to act on.
 *
 * Paired with `isPendingMigrationError` in lib/supabase-errors.ts, which is what
 * tells the two apart (Postgres 42703 rather than a fetch failure).
 */
export function PendingMigrationState({
  /** The migration filename, e.g. `20260816000000_checklist_workflow_documents.sql`. */
  migration,
  /** What stops working until it is applied, in the reader's terms. */
  feature,
  onRetry,
  className,
}: {
  migration: string;
  feature: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col items-center p-8 text-center", className)}>
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-400">
        <Database className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-foreground">
        This database is one migration behind
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {feature} needs columns that have not been added yet. Apply the pending migration, then
        reload - nothing has been lost, and no existing data changes.
      </p>
      <code className="mt-3 block max-w-full overflow-x-auto rounded-lg border border-border bg-muted/50 px-3 py-2 text-left text-xs">
        supabase/migrations/{migration}
      </code>
      <p className="mt-2 text-xs text-muted-foreground">
        Run <span className="font-semibold">supabase db push</span>, or paste that file into the
        Supabase SQL editor.
      </p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm" className="mt-5">
          <RefreshCw className="mr-2 h-4 w-4" />I have applied it - retry
        </Button>
      )}
    </Card>
  );
}
