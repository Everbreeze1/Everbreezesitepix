import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, MapPin, RefreshCw, Trash2, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { useConfirm } from "@/hooks/use-confirm";
import {
  listTrashedProjects,
  restoreProject,
  purgeProject,
  TRASH_RETENTION_DAYS,
} from "@/lib/trash.functions";

interface TrashedProject {
  id: string;
  name: string;
  description: string | null;
  location: string;
  status: string;
  deleted_at: string;
  days_left: number;
  photo_count: number;
}

export function ProjectTrashPage() {
  const confirm = useConfirm();
  /*
   * The sidebar's Trash badge is a cached query (60s). Emptying the trash from
   * this page left the badge insisting there were still items in it - the one
   * number whose whole job is to be trustworthy. Invalidate it whenever this
   * page changes what is in there.
   */
  const queryClient = useQueryClient();
  const refreshTrashBadge = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["trash-counts"] }),
    [queryClient],
  );
  const [items, setItems] = useState<TrashedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const listFn = listTrashedProjects;
  const restoreFn = restoreProject;
  const purgeFn = purgeProject;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listFn({});
      setItems(res.projects);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load trash");
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const doRestore = async (p: TrashedProject) => {
    setBusyId(p.id);
    try {
      await restoreFn({ data: { projectId: p.id } });
      toast.success(`Restored "${p.name}"`);
      setItems((cur) => cur.filter((i) => i.id !== p.id));
      refreshTrashBadge();
    } catch (e: any) {
      toast.error(e?.message ?? "Restore failed");
    } finally {
      setBusyId(null);
    }
  };

  const doPurge = async (p: TrashedProject) => {
    if (
      !(await confirm({
        description: `Permanently delete "${p.name}" and all its ${p.photo_count} photo${p.photo_count === 1 ? "" : "s"}, reports, tasks, and checklists?\n\nThis cannot be undone.`,
        variant: "destructive",
      }))
    )
      return;
    setBusyId(p.id);
    try {
      await purgeFn({ data: { projectId: p.id } });
      toast.success(`Deleted "${p.name}" permanently`);
      setItems((cur) => cur.filter((i) => i.id !== p.id));
      refreshTrashBadge();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-3 pb-16 pt-4 sm:px-4">
      <PageHeader
        backTo="/projects"
        backLabel="Projects"
        title="Project Trash"
        description={
          loading ? "Loading…" : `${items.length} project${items.length === 1 ? "" : "s"} in trash`
        }
      />

      <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Trashed projects are kept for {TRASH_RETENTION_DAYS} days
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
            You can restore any project - including all its photos, reports, tasks, and checklists -
            before it's permanently deleted. After {TRASH_RETENTION_DAYS} days trashed projects are
            automatically removed and cannot be recovered.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card className="mt-6 flex flex-col items-center gap-2 border-dashed p-12 text-center text-sm text-muted-foreground">
          <Trash2 className="h-10 w-10 opacity-40" />
          <p className="font-medium">Project trash is empty</p>
          <p className="text-xs">
            Deleted projects appear here for {TRASH_RETENTION_DAYS} days before being permanently
            removed.
          </p>
          <Link to="/projects" className="mt-2 text-xs text-primary underline">
            Back to projects
          </Link>
        </Card>
      ) : (
        <div className="mt-5 grid gap-3">
          {items.map((p) => (
            <Card
              key={p.id}
              className="flex flex-col gap-3 border-border/60 p-4 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-semibold">{p.name}</h3>
                  <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    {p.days_left}d left
                  </span>
                </div>
                {p.description ? (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{p.description}</p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {p.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {p.location}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Images className="h-3 w-3" />
                    {p.photo_count} photo{p.photo_count === 1 ? "" : "s"}
                  </span>
                  <span>
                    Trashed{" "}
                    {new Date(p.deleted_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === p.id}
                  onClick={() => void doRestore(p)}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Restore
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busyId === p.id}
                  onClick={() => void doPurge(p)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Delete forever
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
