import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, RefreshCw, Trash2, Loader2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/hooks/use-confirm";
import {
  listTrashedPhotos,
  restorePhotos,
  purgePhotos,
  TRASH_RETENTION_DAYS,
} from "@/lib/trash.functions";

interface TrashedPhoto {
  id: string;
  storage_path: string;
  url: string;
  caption: string | null;
  tags: string[];
  deleted_at: string;
  days_left: number;
}

interface Props {
  projectId: string;
  onChanged?: () => void;
}

export function ProjectTrash({ projectId, onChanged }: Props) {
  const [items, setItems] = useState<TrashedPhoto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  // Keeps the sidebar's Trash badge honest - see ProjectTrashPage.
  const queryClient = useQueryClient();
  const refreshTrashBadge = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["trash-counts"] }),
    [queryClient],
  );

  const listFn = listTrashedPhotos;
  const restoreFn = restorePhotos;
  const purgeFn = purgePhotos;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listFn({ data: { projectId } });
      setItems(res.photos);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load trash");
    } finally {
      setLoading(false);
    }
  }, [projectId, listFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectAll = () => setSelected(new Set(items.map((i) => i.id)));
  const clearSel = () => setSelected(new Set());

  const doRestore = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      await restoreFn({ data: { photoIds: ids } });
      toast.success(`Restored ${ids.length} photo${ids.length === 1 ? "" : "s"}`);
      setItems((cur) => cur.filter((i) => !ids.includes(i.id)));
      clearSel();
      refreshTrashBadge();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  const doPurge = async (ids: string[]) => {
    if (!ids.length) return;
    if (
      !(await confirm({
        description: `Permanently delete ${ids.length} photo${ids.length === 1 ? "" : "s"}? This cannot be undone.`,
        variant: "destructive",
      }))
    )
      return;
    setBusy(true);
    try {
      await purgeFn({ data: { photoIds: ids } });
      toast.success(`Deleted ${ids.length} photo${ids.length === 1 ? "" : "s"} permanently`);
      setItems((cur) => cur.filter((i) => !ids.includes(i.id)));
      clearSel();
      refreshTrashBadge();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="space-y-1">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Trashed photos are kept for {TRASH_RETENTION_DAYS} days
          </p>
          <p className="text-xs text-amber-800/90 dark:text-amber-200/80">
            You can restore any photo back to the project before it's permanently deleted. After{" "}
            {TRASH_RETENTION_DAYS} days they are automatically removed and cannot be recovered.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${items.length} photo${items.length === 1 ? "" : "s"} in trash`}
          {selected.size > 0 && ` · ${selected.size} selected`}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {items.length > 0 &&
            (selected.size === items.length ? (
              <Button size="sm" variant="ghost" onClick={clearSel}>
                Clear
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={selectAll}>
                Select all
              </Button>
            ))}
          <Button
            size="sm"
            variant="outline"
            disabled={selected.size === 0 || busy}
            onClick={() => void doRestore(Array.from(selected))}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Restore
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={selected.size === 0 || busy}
            onClick={() => void doPurge(Array.from(selected))}
          >
            <Trash2 className="mr-1.5 h-4 w-4" />
            Delete forever
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed p-10 text-center text-sm text-muted-foreground">
          <Trash2 className="h-8 w-8 opacity-40" />
          <p>Trash is empty.</p>
          <p className="text-xs">
            Deleted photos will appear here for {TRASH_RETENTION_DAYS} days before being permanently
            removed.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((p) => {
            const isSel = selected.has(p.id);
            return (
              <div
                key={p.id}
                onClick={() => toggle(p.id)}
                className={`group relative cursor-pointer overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md ${
                  isSel ? "border-primary ring-2 ring-primary/40" : "border-border"
                }`}
              >
                <div className="relative aspect-square bg-muted">
                  {p.url ? (
                    <img
                      src={p.url}
                      alt={p.caption ?? "Trashed photo"}
                      className="h-full w-full object-cover opacity-80 group-hover:opacity-100 transition"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <ImageOff className="h-6 w-6" />
                    </div>
                  )}
                  <div className="absolute left-2 top-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {p.days_left}d left
                  </div>
                  {isSel && (
                    <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-bold">
                      ✓
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 p-2 text-[11px]">
                  <span className="truncate text-muted-foreground">
                    Trashed{" "}
                    {new Date(p.deleted_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <div className="flex border-t border-border">
                  <button
                    type="button"
                    className="flex-1 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void doRestore([p.id]);
                    }}
                  >
                    Restore
                  </button>
                  <div className="w-px bg-border" />
                  <button
                    type="button"
                    className="flex-1 py-1.5 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void doPurge([p.id]);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
