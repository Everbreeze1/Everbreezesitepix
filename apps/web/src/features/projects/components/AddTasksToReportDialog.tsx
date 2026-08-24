import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/everlumen/client";
import { toast } from "sonner";
import {
  TASK_PHOTO_ITEMS_TABLE,
  TASK_PHOTO_ITEM_COLUMNS,
  indexTaskPhotoItems,
  isMissingTaskPhotoItems,
  taskPhotoProgress,
  type TaskPhotoItem,
} from "@/lib/task-photo-items";
import {
  buildTaskReportSections,
  type TaskForReport,
  type TaskPhotoStateForReport,
  type TaskReportSection,
} from "@everlumen/shared";

/**
 * Put the field record of a task into the report the customer reads.
 *
 * The per-photo notes existed only inside the app: whoever received the report
 * still got photos with no account of what was done to them. Each task picked
 * here becomes one section, with its note printed as the caption under the
 * photo it was written about.
 */

interface Props {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onAdd: (sections: TaskReportSection[]) => Promise<void> | void;
}

interface TaskRow extends TaskForReport {
  created_at: string;
}

export function AddTasksToReportDialog({ open, projectId, onClose, onAdd }: Props) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [items, setItems] = useState<Map<string, Map<string, TaskPhotoItem>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [includeOutstanding, setIncludeOutstanding] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("tasks" as any)
        .select("id, title, description, status, photo_ids, due_date, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        setTasks([]);
        setLoading(false);
        return;
      }
      // Only tasks that carry photos: this is the per-photo record, and a
      // section with a heading and no evidence under it is a line the reader
      // has to take on faith.
      const rows = ((data ?? []) as any[] as TaskRow[]).filter(
        (t) => (t.photo_ids?.length ?? 0) > 0,
      );
      setTasks(rows);
      setPicked(new Set(rows.filter((t) => t.status === "done").map((t) => t.id)));

      if (rows.length > 0) {
        const { data: itemRows, error: itemErr } = await supabase
          .from(TASK_PHOTO_ITEMS_TABLE as any)
          .select(TASK_PHOTO_ITEM_COLUMNS)
          .in(
            "task_id",
            rows.map((t) => t.id),
          );
        if (cancelled) return;
        if (itemErr) {
          if (!isMissingTaskPhotoItems(itemErr)) toast.error(itemErr.message);
          setItems(new Map());
        } else {
          setItems(indexTaskPhotoItems((itemRows ?? []) as any[] as TaskPhotoItem[]));
        }
      } else {
        setItems(new Map());
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const statesByTask = useMemo(() => {
    const m = new Map<string, TaskPhotoStateForReport[]>();
    items.forEach((byPhoto, taskId) => {
      m.set(
        taskId,
        [...byPhoto.values()].map((i) => ({
          photo_id: i.photo_id,
          status: i.status,
          note: i.note,
        })),
      );
    });
    return m;
  }, [items]);

  const add = async () => {
    const chosen = tasks.filter((t) => picked.has(t.id));
    if (chosen.length === 0) return;
    setAdding(true);
    const sections = buildTaskReportSections(chosen, statesByTask, {
      doneOnly: !includeOutstanding,
    });
    try {
      await onAdd(sections);
    } finally {
      setAdding(false);
    }
  };

  const chosenCount = picked.size;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add work from tasks</DialogTitle>
          <DialogDescription>
            One section per task. Each photo is captioned with what was done to it.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-10 text-center">
            <CheckSquare className="h-5 w-5 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No tasks on this project carry photos yet.
              <br />
              Attach photos to a task and it can be reported here.
            </p>
          </div>
        ) : (
          <>
            <ul className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
              {tasks.map((t) => {
                const progress = taskPhotoProgress(t.photo_ids, items.get(t.id) ?? null);
                const on = picked.has(t.id);
                return (
                  <li key={t.id}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border-[0.8px] p-3 transition ${
                        on ? "border-primary/50 bg-primary/[0.05]" : "border-border bg-card/60"
                      }`}
                    >
                      <Checkbox checked={on} onCheckedChange={() => toggle(t.id)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{progress.label}</p>
                      </div>
                      <span className="shrink-0 font-manrope text-[11px] font-bold tabular-nums text-muted-foreground">
                        {progress.shortLabel}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs text-muted-foreground">
              <Checkbox
                checked={includeOutstanding}
                onCheckedChange={(v) => setIncludeOutstanding(v === true)}
              />
              {/* On by default. A progress report that prints only the finished
                  half is a sales brochure, and "what needs to get done" is the
                  other half of what was asked for. */}
              Include photos still outstanding
            </label>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void add()} disabled={adding || chosenCount === 0}>
            {adding && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {chosenCount === 0
              ? "Add sections"
              : `Add ${chosenCount} section${chosenCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
