import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Plus,
  Circle,
  CircleDashed,
  CheckCircle2,
  Trash2,
  UserPlus,
  ChevronDown,
  CheckSquare,
  StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/everlumen/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useConfirm } from "@/hooks/use-confirm";
import { useTeamMembers } from "@/hooks/use-team-members";
import { useAssignableTeammates } from "@/hooks/use-assignable-teammates";
import { completionRights, overrideConfirm } from "@/lib/assignment";
import { notifyTaskChanged } from "@/lib/tasks.functions";
import {
  TASK_PHOTO_ITEMS_TABLE,
  TASK_PHOTO_ITEM_COLUMNS,
  isMissingTaskPhotoItems,
  photoPositionInTask,
  taskPhotoItemErrorMessage,
  taskPhotoItemPatch,
  taskStatusFromPhotos,
  type TaskPhotoItem,
} from "@/lib/task-photo-items";
import { useReportPanelCount } from "@/features/photos/components/PhotoDetailsPanel";
import type { CommentContributor } from "@/features/photos/components/PhotoCommentsPanel";

type Status = "open" | "in_progress" | "done";

interface Task {
  id: string;
  title: string;
  status: Status;
  assignee_user_id: string | null;
  assigned_by: string | null;
  assignee_email: string | null;
  photo_ids: string[];
  due_date: string | null;
  created_at: string;
}

interface Props {
  photoId: string;
  projectId: string;
  currentUserId: string;
  contributors: CommentContributor[];
}

const STATUS_ORDER: Status[] = ["open", "in_progress", "done"];
const STATUS_ICON = { open: Circle, in_progress: CircleDashed, done: CheckCircle2 } as const;
const STATUS_CLS = {
  open: "text-sidebar-foreground/60",
  in_progress: "text-amber-300",
  done: "text-emerald-400",
} as const;
const STATUS_LABEL = { open: "Open", in_progress: "In progress", done: "Done" } as const;

function initials(name: string | null, email: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/**
 * What to call somebody on a pill barely wider than a word.
 *
 * Never the raw address: a task assigned to a teammate whose profile has no
 * name rendered as "marklagura223@gmail.…", which reads as data rather than as
 * a person. The full address is still there under the name inside the picker,
 * where there is room for it.
 */
function personLabel(
  c: CommentContributor | null | undefined,
  currentUserId?: string,
): string | null {
  if (!c) return null;
  if (currentUserId && c.userId === currentUserId) return "You";
  if (c.fullName) return c.fullName;
  if (c.email) return c.email.split("@")[0];
  return "Teammate";
}

export function PhotoTasksPanel({ photoId, projectId, currentUserId, contributors }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const { isManager } = useTeamMembers();
  /**
   * Per-photo state for the tasks on this picture, keyed task -> photo.
   *
   * The whole task's photos, not only this one, because the line under a title
   * has to be able to say "photo 3 of 12, 5 done". Knowing this photo alone was
   * the old model, and it is exactly why ticking here closed the other eleven.
   */
  const [itemIndex, setItemIndex] = useState<Map<string, Map<string, TaskPhotoItem>>>(new Map());
  /** False once the per-photo table answers "does not exist". */
  const [itemsReady, setItemsReady] = useState(true);
  /** Task ids being written, so the circle can show it is in flight. */
  const [pending, setPending] = useState<Set<string>>(new Set());
  /** Task id whose "what was done" note is being edited on this photo. */
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const confirm = useConfirm();

  /*
   * The whole crew, not only the people who have already touched this project.
   * `contributors` is an activity count and was never a roster, which is why the
   * dropdown here listed one or two names while the project's Tasks tab listed
   * everyone. See use-assignable-teammates.ts.
   */
  const { teammates, isLoading: teammatesLoading } = useAssignableTeammates(contributors);

  useReportPanelCount("tasks", tasks.length);

  const contribById = useMemo(() => {
    const m = new Map<string, CommentContributor>();
    teammates.forEach((c) => m.set(c.userId, c));
    return m;
  }, [teammates]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tasks" as any)
      .select(
        "id, title, status, assignee_user_id, assigned_by, assignee_email, photo_ids, due_date, created_at",
      )
      .eq("project_id", projectId)
      .contains("photo_ids", [photoId])
      .order("status", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) {
      if (!String(error.message).includes("does not exist")) toast.error(error.message);
      setTasks([]);
      setItemIndex(new Map());
    } else {
      const rows = data as any[] as Task[];
      setTasks(rows);
      await loadItems(rows);
    }
    setLoading(false);
  };

  const loadItems = async (rows: Task[]) => {
    if (rows.length === 0) {
      setItemIndex(new Map());
      return;
    }
    const { data, error } = await supabase
      .from(TASK_PHOTO_ITEMS_TABLE as any)
      .select(TASK_PHOTO_ITEM_COLUMNS)
      .in(
        "task_id",
        rows.map((t) => t.id),
      );
    if (error) {
      // Before the migration is applied the panel behaves as it did: one status
      // per task. Worth no message to a crew member, who cannot act on it.
      if (isMissingTaskPhotoItems(error)) setItemsReady(false);
      else toast.error(error.message);
      setItemIndex(new Map());
      return;
    }
    setItemsReady(true);
    const index = new Map<string, Map<string, TaskPhotoItem>>();
    ((data ?? []) as any[] as TaskPhotoItem[]).forEach((item) => {
      let byPhoto = index.get(item.task_id);
      if (!byPhoto) {
        byPhoto = new Map();
        index.set(item.task_id, byPhoto);
      }
      byPhoto.set(item.photo_id, item);
    });
    setItemIndex(index);
  };

  useEffect(() => {
    void load(); /* eslint-disable-next-line */
  }, [photoId, projectId]);

  const add = async () => {
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    const payload: any = {
      project_id: projectId,
      created_by: currentUserId,
      title: t,
      status: "open",
      photo_ids: [photoId],
      priority: "normal",
    };
    if (assignee) {
      payload.assignee_user_id = assignee;
      payload.assignee_email = contribById.get(assignee)?.email ?? null;
      // Recorded with the assignment, never separately: it is what the
      // completion notification is delivered to.
      payload.assigned_by = currentUserId;
    }
    const { data, error } = await supabase
      .from("tasks" as any)
      .insert(payload)
      .select(
        "id, title, status, assignee_user_id, assigned_by, assignee_email, photo_ids, due_date, created_at",
      )
      .single();
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    /*
     * The assignment notification, delivered.
     *
     * `tasks_notify_assignee` writes the in-app row the moment the insert
     * commits; this turns it into email, which is what the client asked for -
     * a crew member on a roof is not refreshing a dashboard. Fire and forget:
     * the task is already saved.
     */
    notifyTaskChanged((data as any).id);
    setTasks((arr) => [data as any as Task, ...arr]);
    // Confirmation that the assignment landed on a person, not just that a row
    // was written: the picker resets to "Assign" on the next line either way.
    const who = assignee ? personLabel(contribById.get(assignee), currentUserId) : null;
    toast.success(
      !who
        ? "Task added"
        : who === "You"
          ? "Task added, assigned to you"
          : `Task assigned to ${who}`,
    );
    setTitle("");
    setAssignee("");
  };

  const taskAssigneeName = (t: Task) =>
    t.assignee_user_id
      ? (contribById.get(t.assignee_user_id)?.fullName ??
        contribById.get(t.assignee_user_id)?.email ??
        "the assignee")
      : (t.assignee_email ?? "the assignee");

  const taskRights = (t: Task) =>
    completionRights(
      { assignedTo: t.assignee_user_id, assignedBy: t.assigned_by },
      { userId: currentUserId, isManager },
      t.assignee_user_id
        ? (contribById.get(t.assignee_user_id)?.fullName ??
            contribById.get(t.assignee_user_id)?.email ??
            null)
        : null,
    );

  /** This photo's own state on a task, which is what the circle shows now. */
  const photoStatus = (t: Task): "open" | "done" => {
    if (!itemsReady) return t.status === "done" ? "done" : "open";
    return itemIndex.get(t.id)?.get(photoId)?.status ?? "open";
  };

  const photoNote = (t: Task): string => itemIndex.get(t.id)?.get(photoId)?.note ?? "";

  /**
   * Tick this photo off the task, rather than ticking the task off.
   *
   * The old circle wrote `tasks.status`, and a task can cover a dozen photos:
   * closing the work here closed it on every other picture in the set and
   * struck it through in each of their panels. It writes the (task, photo) row
   * now, and the database rolls the task up once the last photo lands.
   */
  const setPhotoDone = async (t: Task, next: "open" | "done", note?: string | null) => {
    if (!itemsReady) {
      void cycleTaskStatus(t);
      return;
    }
    const existing = itemIndex.get(t.id)?.get(photoId) ?? null;
    if (next === "done" && existing?.status !== "done") {
      // Same rule as the project panel and the checklist page. Checked here so
      // the tap does nothing visible rather than flashing a completed state the
      // database then rejects.
      const rights = taskRights(t);
      if (!rights.canComplete) {
        toast.error(rights.reason ?? "You can't mark this task done.");
        return;
      }
      if (rights.isOverride) {
        const ok = await confirm(
          overrideConfirm({
            what: t.title,
            who: taskAssigneeName(t),
            detail: "This photo will be recorded as done by you.",
            confirmText: "Mark photo done",
          }),
        );
        if (!ok) return;
      }
    }

    const beforeIndex = itemIndex;
    const beforeStatus = t.status;
    const optimistic: TaskPhotoItem = {
      task_id: t.id,
      photo_id: photoId,
      status: next,
      note: (note !== undefined ? note : existing?.note)?.trim() || null,
      completed_by: next === "done" ? (existing?.completed_by ?? currentUserId) : null,
      completed_at: next === "done" ? (existing?.completed_at ?? new Date().toISOString()) : null,
    };
    const nextIndex = new Map(itemIndex);
    const byPhoto = new Map(nextIndex.get(t.id) ?? []);
    byPhoto.set(photoId, optimistic);
    nextIndex.set(t.id, byPhoto);
    setItemIndex(nextIndex);

    const rolled = taskStatusFromPhotos(t.photo_ids, byPhoto, t.status);
    if (rolled !== t.status) {
      setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: rolled } : x)));
    }

    setPending((prev) => new Set(prev).add(t.id));
    const { error } = await supabase
      .from(TASK_PHOTO_ITEMS_TABLE as any)
      .upsert(taskPhotoItemPatch(t.id, photoId, next, optimistic.note), {
        onConflict: "task_id,photo_id",
      });
    setPending((prev) => {
      const s = new Set(prev);
      s.delete(t.id);
      return s;
    });

    if (error) {
      if (isMissingTaskPhotoItems(error)) setItemsReady(false);
      else toast.error(taskPhotoItemErrorMessage(error));
      setItemIndex(beforeIndex);
      setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: beforeStatus } : x)));
      void load();
      return;
    }

    if (rolled === "done" && beforeStatus !== "done") {
      // The rollup closed the task in the database, so the completion and
      // watcher triggers have fired. Deliver what they wrote.
      notifyTaskChanged(t.id);
      toast.success("Last photo done, task complete");
    }
  };

  /**
   * The pre-breakdown behaviour, kept for the window between this code
   * deploying and the migration being applied by hand in the SQL editor.
   */
  const cycleTaskStatus = async (t: Task) => {
    const next: Status = STATUS_ORDER[(STATUS_ORDER.indexOf(t.status) + 1) % 3];

    if (next === "done") {
      const rights = taskRights(t);
      if (!rights.canComplete) {
        toast.error(rights.reason ?? "You can't mark this task done.");
        return;
      }
      if (rights.isOverride) {
        const ok = await confirm(
          overrideConfirm({
            what: t.title,
            who: taskAssigneeName(t),
            confirmText: "Mark done",
          }),
        );
        if (!ok) return;
      }
    }

    const completed_at = next === "done" ? new Date().toISOString() : null;
    setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    const { error } = await supabase
      .from("tasks" as any)
      .update({ status: next, completed_at })
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      void load();
      return;
    }
    // Completion tells the assignor and every watcher. Same dispatch as the
    // project panel - one helper, so a second surface cannot quietly skip it.
    notifyTaskChanged(t.id);
  };

  const remove = async (t: Task) => {
    setTasks((arr) => arr.filter((x) => x.id !== t.id));
    const { error } = await supabase
      .from("tasks" as any)
      .delete()
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      void load();
    }
  };

  const reassign = async (t: Task, userId: string | null) => {
    const c = userId ? contribById.get(userId) : null;
    const patch: any = {
      assignee_user_id: userId,
      assignee_email: c?.email ?? null,
      assigned_by: userId ? currentUserId : null,
    };
    setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    const { error } = await supabase
      .from("tasks" as any)
      .update(patch)
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      void load();
      return;
    }
    notifyTaskChanged(t.id);
    const who = personLabel(c, currentUserId);
    toast.success(
      !who ? "Task unassigned" : who === "You" ? "Assigned to you" : `Assigned to ${who}`,
    );
  };

  // No heading here - PhotoDetailsPanel's tab strip already says "Tasks" and
  // carries the count, so titling it again produced the stacked pair seen in
  // the lightbox.
  return (
    <div className="flex h-full min-h-0 w-full flex-col text-sidebar-foreground">
      {/* Add form. Pinned at the top of the tab so it does not travel with the
          list once a photo carries more tasks than fit. */}
      <div className="shrink-0 space-y-2 rounded-2xl border border-sidebar-border bg-sidebar-accent p-2.5">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Add a task for this photo…"
          className="h-9 border-sidebar-border bg-sidebar/60 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus-visible:ring-sidebar-ring"
        />
        <div className="flex items-center gap-2">
          <AssigneePicker
            value={assignee}
            onChange={setAssignee}
            contributors={teammates}
            loading={teammatesLoading}
            currentUserId={currentUserId}
            compact
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void add()}
            disabled={!title.trim() || saving}
            className="ml-auto h-9 gap-1"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-sidebar-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-sidebar-border px-4 py-10 text-center">
            <CheckSquare className="h-5 w-5 text-sidebar-foreground/30" />
            <p className="text-xs text-sidebar-foreground/55">
              No tasks on this photo yet.
              <br />
              Add one above and assign it to a teammate.
            </p>
          </div>
        ) : (
          tasks.map((t) => {
            const doneHere = photoStatus(t) === "done";
            /*
             * The icon answers "is this photo handled", not "is the task
             * closed". A task still open elsewhere reads as done here once this
             * picture is dealt with, which is the whole point.
             */
            const Icon = doneHere ? CheckCircle2 : itemsReady ? Circle : STATUS_ICON[t.status];
            const cls = doneHere
              ? STATUS_CLS.done
              : itemsReady
                ? STATUS_CLS.open
                : STATUS_CLS[t.status];
            const c = t.assignee_user_id ? contribById.get(t.assignee_user_id) : null;
            const position = itemsReady
              ? photoPositionInTask(t.photo_ids, photoId, itemIndex.get(t.id))
              : null;
            const note = photoNote(t);
            const busy = pending.has(t.id);
            return (
              <div
                key={t.id}
                className="group rounded-xl border border-sidebar-border bg-sidebar-accent px-2.5 py-2 transition-colors hover:border-sidebar-foreground/25"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={
                      itemsReady
                        ? doneHere
                          ? "Reopen this photo on this task"
                          : "Mark this photo done on this task"
                        : `Mark as ${STATUS_LABEL[STATUS_ORDER[(STATUS_ORDER.indexOf(t.status) + 1) % 3]]} (currently ${STATUS_LABEL[t.status]})`
                    }
                    title={
                      itemsReady
                        ? doneHere
                          ? "Done on this photo. Tap to reopen."
                          : "Mark this photo done"
                        : `${STATUS_LABEL[t.status]} - tap to advance`
                    }
                    onClick={() =>
                      void (itemsReady
                        ? setPhotoDone(t, doneHere ? "open" : "done")
                        : cycleTaskStatus(t))
                    }
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${cls} hover:bg-sidebar-foreground/10 disabled:opacity-60`}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </button>
                  <div
                    className={`flex-1 truncate text-sm ${doneHere ? "text-sidebar-foreground/50 line-through" : "text-sidebar-foreground/95"}`}
                    title={t.title}
                  >
                    {t.title}
                  </div>
                  <AssigneePicker
                    value={t.assignee_user_id ?? ""}
                    onChange={(v) => void reassign(t, v || null)}
                    contributors={teammates}
                    loading={teammatesLoading}
                    currentUserId={currentUserId}
                    currentLabel={
                      personLabel(c, currentUserId) ??
                      (t.assignee_email ? t.assignee_email.split("@")[0] : "")
                    }
                  />
                  <button
                    type="button"
                    aria-label="Delete task"
                    onClick={() => void remove(t)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/40 opacity-0 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* A task bigger than this picture says so, so nobody assumes
                    the job is finished because their photo is. */}
                {position && (
                  <p className="mt-1 pl-9 text-[11px] text-sidebar-foreground/50">{position}</p>
                )}

                {/* What was done, on this photo. The detail the client said the
                    single completion button could never carry. */}
                {itemsReady &&
                  (noteFor === t.id ? (
                    <Input
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      onBlur={() => {
                        setNoteFor(null);
                        if (noteDraft.trim() !== note.trim()) {
                          void setPhotoDone(t, photoStatus(t), noteDraft);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                        if (e.key === "Escape") {
                          setNoteDraft(note);
                          setNoteFor(null);
                        }
                      }}
                      placeholder="What was done to this photo?"
                      className="ml-9 mt-1.5 h-7 w-[calc(100%-2.25rem)] border-sidebar-border bg-sidebar/60 text-xs text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus-visible:ring-sidebar-ring"
                      autoFocus
                    />
                  ) : note ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNoteDraft(note);
                        setNoteFor(t.id);
                      }}
                      className="mt-1 flex w-full items-start gap-1.5 pl-9 pr-1 text-left text-[11px] leading-4 text-sidebar-foreground/65 hover:text-sidebar-foreground"
                    >
                      <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1">{note}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setNoteDraft("");
                        setNoteFor(t.id);
                      }}
                      className="mt-1 pl-9 text-[11px] text-sidebar-foreground/40 opacity-0 transition hover:text-sidebar-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      {doneHere ? "Add what was done" : "Add a note"}
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AssigneePicker({
  value,
  onChange,
  contributors,
  compact = false,
  currentLabel,
  loading = false,
  currentUserId,
}: {
  value: string;
  onChange: (v: string) => void;
  contributors: CommentContributor[];
  compact?: boolean;
  currentLabel?: string;
  loading?: boolean;
  currentUserId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return contributors;
    return contributors.filter(
      (c) =>
        (c.fullName ?? "").toLowerCase().includes(s) || (c.email ?? "").toLowerCase().includes(s),
    );
  }, [contributors, q]);
  const selected = contributors.find((c) => c.userId === value) ?? null;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`flex shrink-0 items-center gap-1.5 rounded-lg border border-sidebar-border bg-sidebar/60 px-2.5 text-xs font-semibold text-sidebar-foreground/80 transition-colors hover:bg-sidebar-foreground/10 ${compact ? "h-9" : "h-7"}`}
          aria-label="Assignee"
        >
          {selected ? (
            <Avatar className="h-5 w-5">
              {selected.avatarUrl && <AvatarImage src={selected.avatarUrl} alt="" />}
              <AvatarFallback className="bg-sidebar-foreground/20 text-[10px] text-sidebar-foreground">
                {initials(selected.fullName, selected.email)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <UserPlus className="h-3.5 w-3.5" />
          )}
          {compact ? (
            <span className="max-w-[120px] truncate">
              {personLabel(selected, currentUserId) ?? "Assign"}
            </span>
          ) : null}
          {!compact && currentLabel ? (
            <span className="max-w-[92px] truncate">{currentLabel}</span>
          ) : null}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      {/*
       * `dark` on the content, not a hand-rolled palette: the viewer's chrome is
       * the fixed navy of the app sidebar in either theme, so a popover left on
       * the ambient tokens opened as a white card in the middle of it whenever
       * the app itself was light. Re-scoping the theme variables here keeps this
       * the app's own popover - same elevation, same hover, same borders as
       * every other menu - only resolved dark.
       */}
      {/* The add-form picker sits at the left edge of a 400px panel, so an
          end-aligned menu hangs off it and over the photo; the per-task picker
          is right-aligned in its row and wants the opposite. */}
      <PopoverContent
        align={compact ? "start" : "end"}
        className="dark z-[120] w-64 p-2 text-popover-foreground"
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search teammates…"
          className="mb-2 h-8 text-xs"
          autoFocus
        />
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-accent"
            >
              <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
              Unassign
            </button>
          )}
          {loading && contributors.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading teammates…
            </div>
          ) : filtered.length === 0 ? (
            /*
             * Two different nothings: nobody matches what was typed, versus
             * there is nobody to match. The second used to read "No teammates
             * found" as well, which is what an empty roster looked like when
             * the list was built from project contributors.
             */
            <div className="px-2 py-2 text-center text-[11px] text-muted-foreground">
              {contributors.length === 0 ? (
                <>
                  No teammates yet.
                  <br />
                  Invite your crew from the Teams page.
                </>
              ) : (
                "No teammates match"
              )}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.userId}
                type="button"
                onClick={() => {
                  onChange(c.userId);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent ${c.userId === value ? "bg-accent" : ""}`}
              >
                <Avatar className="h-6 w-6">
                  {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                  <AvatarFallback className="text-[10px]">
                    {initials(c.fullName, c.email)}
                  </AvatarFallback>
                </Avatar>
                {/* The name line is a name, never the address: a profile with
                    no full name used to put the whole address on this line and
                    truncate it, which took the "(you)" with it. The address
                    keeps its own line underneath. */}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{personLabel(c, currentUserId)}</div>
                  {c.email ? (
                    <div className="truncate text-[10px] text-muted-foreground">{c.email}</div>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
