import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import {
  CheckSquare,
  Plus,
  Trash2,
  Loader2,
  CalendarDays,
  Flag,
  Image as ImageIcon,
  X,
  CircleDashed,
  Circle,
  CheckCircle2,
  LayoutList,
  LayoutGrid,
  User as UserIcon,
  ChevronDown,
  ListChecks,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { completionRights, isManagerRole } from "@/lib/assignment";
import { getMyTeam } from "@/lib/teams.functions";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { TaskPhotoChecklist } from "./TaskPhotoChecklist";
import {
  TASK_PHOTO_ITEMS_TABLE,
  TASK_PHOTO_ITEM_COLUMNS,
  indexTaskPhotoItems,
  isMissingTaskPhotoItems,
  taskPhotoItemPatch,
  taskPhotoProgress,
  taskStatusFromPhotos,
  taskWorkSummary,
  type TaskPhotoItem,
  type TaskPhotoItemIndex,
} from "@/lib/task-photo-items";

type Status = "open" | "in_progress" | "done";
type Priority = "low" | "normal" | "high" | "urgent";

/** One spelling of a teammate's display name, used by every label on this panel. */
const memberName = (m?: { full_name: string | null; email: string | null } | null) =>
  m?.full_name || m?.email || "Member";

interface Task {
  id: string;
  project_id: string;
  created_by: string;
  assignee_email: string | null;
  assignee_user_id: string | null;
  /** Who handed it over. Notified when it is closed; may reopen it. */
  assigned_by: string | null;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  due_date: string | null;
  completed_at: string | null;
  photo_ids: string[];
  position: number;
  created_at: string;
  updated_at: string;
}

interface ProjectPhoto {
  id: string;
  url: string;
  /** Names the photo in the per-photo breakdown, so a row is not a uuid. */
  caption?: string | null;
  taken_at?: string | null;
}

interface TeamMemberLite {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string | null;
}

export interface ProjectTasksHandle {
  createWithPhoto: (photoId: string) => void;
}

interface ProjectTasksProps {
  projectId: string;
  /** Photos already loaded for the project page (id + signed/public URL). */
  projectPhotos: ProjectPhoto[];
  /**
   * Reports the open/total split back after every load, so the tab strip's
   * badge is not a number fetched once when the page opened. It read "Tasks 0"
   * over a list with a task in it for the whole time anyone stayed on the page.
   */
  onCountsChanged?: (counts: { open: number; total: number }) => void;
}

const STATUS_META: Record<Status, { label: string; icon: any; cls: string }> = {
  open: { label: "Open", icon: Circle, cls: "text-muted-foreground" },
  in_progress: { label: "In progress", icon: CircleDashed, cls: "text-amber-500" },
  done: { label: "Done", icon: CheckCircle2, cls: "text-emerald-500" },
};

const PRIORITY_META: Record<Priority, { label: string; cls: string }> = {
  low: { label: "Low", cls: "bg-muted text-muted-foreground" },
  normal: { label: "Normal", cls: "bg-secondary text-secondary-foreground" },
  high: { label: "High", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  urgent: { label: "Urgent", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
};

function initials(name: string | null, email: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function dueLabel(dueDate: string): { label: string; overdue: boolean } {
  const due = new Date(dueDate);
  const today = new Date(new Date().toDateString());
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return { label: "Today", overdue: false };
  if (diffDays === 1) return { label: "Tomorrow", overdue: false };
  if (diffDays < 0)
    return {
      label: due.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      overdue: true,
    };
  return {
    label: due.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    overdue: false,
  };
}

export const ProjectTasks = forwardRef<ProjectTasksHandle, ProjectTasksProps>(function ProjectTasks(
  { projectId, projectPhotos, onCountsChanged },
  ref,
) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const fetchTeam = getMyTeam;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [seedPhotoIds, setSeedPhotoIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [view, setView] = useState<"list" | "board">("list");
  const [members, setMembers] = useState<TeamMemberLite[]>([]);
  /** Inline quick-add: most punch-list items are just a sentence. */
  const [quickTitle, setQuickTitle] = useState("");
  const [quickAdding, setQuickAdding] = useState(false);
  /**
   * Per-photo state for every task on this project, keyed task -> photo.
   *
   * Loaded alongside the tasks rather than per row: a project's worth of these
   * is a handful of rows, and fetching them per expanded task would make
   * opening a breakdown feel like a page load.
   */
  const [photoItems, setPhotoItems] = useState<TaskPhotoItemIndex>(new Map());
  /** Tasks whose per-photo breakdown is open in the list. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** `${taskId}:${photoId}` currently being written, for the spinner on a row. */
  const [pendingPhotos, setPendingPhotos] = useState<Set<string>>(new Set());
  /**
   * False once the per-photo table has answered "does not exist". Migrations in
   * this project are pasted into the SQL editor by hand, so the code can land
   * before the table does, and every photo-aware path falls back to the single
   * status column it used before rather than failing.
   */
  const [photoItemsReady, setPhotoItemsReady] = useState(true);

  async function quickAdd() {
    const t = quickTitle.trim();
    if (!t || !user?.id) return;
    setQuickAdding(true);
    const { error } = await supabase.from("tasks" as any).insert({
      project_id: projectId,
      created_by: user.id,
      title: t,
      description: null,
      assignee_user_id: null,
      assignee_email: null,
      due_date: null,
      // 'medium' is not one of the four the CHECK constraint in
      // 20260618220000 allows, so every quick-add was refused by the database
      // and surfaced as a raw constraint message.
      priority: "normal",
      status: "open",
      completed_at: null,
      photo_ids: [],
    });
    setQuickAdding(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setQuickTitle("");
    void load();
  }

  useImperativeHandle(ref, () => ({
    createWithPhoto: (photoId: string) => {
      setEditing(null);
      setSeedPhotoIds([photoId]);
      setCreating(true);
    },
  }));

  const photoUrlById = useMemo(() => {
    const m = new Map<string, string>();
    projectPhotos.forEach((p) => m.set(p.id, p.url));
    return m;
  }, [projectPhotos]);

  const memberById = useMemo(() => {
    const m = new Map<string, TeamMemberLite>();
    members.forEach((mm) => m.set(mm.user_id, mm));
    return m;
  }, [members]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tasks" as any)
      .select("*")
      .eq("project_id", projectId)
      .order("status", { ascending: true })
      .order("position", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) {
      if (!String(error.message).includes("does not exist")) {
        toast.error(error.message);
      }
      setTasks([]);
      setPhotoItems(new Map());
    } else {
      const rows = data as any[] as Task[];
      setTasks(rows);
      await loadPhotoItems(rows);
    }
    setLoading(false);
  };

  /**
   * The per-photo rows for the tasks that carry photos.
   *
   * Only those: a task with no photos has no breakdown to load, and on a
   * punch list that is most of them.
   */
  const loadPhotoItems = async (rows: Task[]) => {
    const ids = rows.filter((t) => (t.photo_ids?.length ?? 0) > 0).map((t) => t.id);
    if (ids.length === 0) {
      setPhotoItems(new Map());
      return;
    }
    const { data, error } = await supabase
      .from(TASK_PHOTO_ITEMS_TABLE as any)
      .select(TASK_PHOTO_ITEM_COLUMNS)
      .in("task_id", ids);
    if (error) {
      // Silent when the migration has not been applied yet. Every task then
      // reads as it did before, which is the correct fallback and not a
      // failure a crew member can act on.
      if (isMissingTaskPhotoItems(error)) setPhotoItemsReady(false);
      else toast.error(error.message);
      setPhotoItems(new Map());
      return;
    }
    setPhotoItemsReady(true);
    setPhotoItems(indexTaskPhotoItems((data ?? []) as any[] as TaskPhotoItem[]));
  };

  const loadTeam = async () => {
    try {
      const res = await fetchTeam();
      const list: TeamMemberLite[] = (res?.members ?? []).map((m: any) => ({
        user_id: m.user_id,
        full_name: m.profile?.full_name ?? null,
        email: m.profile?.email ?? null,
        avatar_url: m.profile?.avatar_url ?? null,
        role: m.role ?? null,
      }));
      setMembers(list);
    } catch {
      setMembers([]);
    }
  };

  useEffect(() => {
    void load();
    void loadTeam(); /* eslint-disable-next-line */
  }, [projectId, user?.id]);

  /*
   * Reported off `tasks` rather than from inside `load`, so ticking a task off
   * moves the badge too. Completing one used to leave "Tasks 4" over three open
   * tasks until the page was reloaded.
   */
  useEffect(() => {
    if (loading) return;
    onCountsChanged?.({
      open: tasks.filter((t) => t.status !== "done").length,
      total: tasks.length,
    }); /* eslint-disable-next-line */
  }, [tasks, loading]);

  const counts = useMemo(() => {
    const c = { open: 0, in_progress: 0, done: 0, total: tasks.length };
    tasks.forEach((t) => {
      (c as any)[t.status] = ((c as any)[t.status] ?? 0) + 1;
    });
    return c;
  }, [tasks]);

  const visible = useMemo(() => {
    if (filter === "all" || view === "board") return tasks;
    return tasks.filter((t) => t.status === filter);
  }, [tasks, filter, view]);

  /**
   * Who may close a task here.
   *
   * Read out of the roster this panel already loads rather than through
   * `useTeamMembers`, which would be a second fetch of the same rows - but the
   * rule itself comes from lib/assignment.ts, so a task, a checklist and a
   * workflow answer the question identically.
   */
  const viewer = {
    userId: user?.id ?? null,
    isManager: isManagerRole(user ? (memberById.get(user.id)?.role ?? null) : null),
  };
  const taskAssigneeName = (t: Task) =>
    t.assignee_user_id
      ? memberName(memberById.get(t.assignee_user_id))
      : (t.assignee_email ?? "the assignee");

  const taskRights = (t: Task) =>
    completionRights(
      { assignedTo: t.assignee_user_id, assignedBy: t.assigned_by },
      viewer,
      taskAssigneeName(t),
    );

  /** The per-photo rows for one task, or null when it carries no photos. */
  const itemsFor = (taskId: string) => photoItems.get(taskId) ?? null;

  /** Does this task's completion live in its photos rather than in its status? */
  const isPhotoDriven = (t: Task) => photoItemsReady && (t.photo_ids?.length ?? 0) > 0;

  const markPending = (key: string, on: boolean) =>
    setPendingPhotos((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  /**
   * Write one photo's state and move the task with it.
   *
   * The database rolls the task's status up from its photos, so the local task
   * row is advanced by the same rule (`taskStatusFromPhotos`) rather than left
   * to be corrected by the next reload. Both halves are optimistic and both are
   * rolled back together if the write is refused.
   */
  const writePhotoItem = async (
    t: Task,
    photoId: string,
    patch: { status?: "open" | "done"; note?: string | null },
  ) => {
    const key = `${t.id}:${photoId}`;
    const existing = itemsFor(t.id)?.get(photoId) ?? null;
    const status = patch.status ?? existing?.status ?? "open";
    const note = patch.note !== undefined ? patch.note : (existing?.note ?? null);

    if (status === "done" && existing?.status !== "done") {
      const rights = taskRights(t);
      if (!rights.canComplete) {
        toast.error(rights.reason ?? "You can't mark this task done.");
        return;
      }
    }

    const before = photoItems;
    const beforeStatus = t.status;
    const optimistic: TaskPhotoItem = {
      task_id: t.id,
      photo_id: photoId,
      status,
      note: note?.trim() ? note.trim() : null,
      completed_by: status === "done" ? (existing?.completed_by ?? user?.id ?? null) : null,
      completed_at: status === "done" ? (existing?.completed_at ?? new Date().toISOString()) : null,
    };

    const nextIndex = new Map(photoItems);
    const byPhoto = new Map(nextIndex.get(t.id) ?? []);
    byPhoto.set(photoId, optimistic);
    nextIndex.set(t.id, byPhoto);
    setPhotoItems(nextIndex);

    const rolled = taskStatusFromPhotos(t.photo_ids, byPhoto, t.status);
    if (rolled !== t.status) {
      setTasks((arr) =>
        arr.map((x) =>
          x.id === t.id
            ? {
                ...x,
                status: rolled,
                completed_at: rolled === "done" ? new Date().toISOString() : null,
              }
            : x,
        ),
      );
    }

    markPending(key, true);
    const { error } = await supabase
      .from(TASK_PHOTO_ITEMS_TABLE as any)
      .upsert(taskPhotoItemPatch(t.id, photoId, status, note), {
        onConflict: "task_id,photo_id",
      });
    markPending(key, false);

    if (error) {
      if (isMissingTaskPhotoItems(error)) {
        setPhotoItemsReady(false);
        toast.error("Per-photo tasks need the latest SQL migration.");
      } else {
        // The trigger raises the sentence worth showing, same as the task one.
        toast.error(error.message);
      }
      setPhotoItems(before);
      setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: beforeStatus } : x)));
      void load();
      return;
    }

    if (rolled === "done" && beforeStatus !== "done") {
      toast.success(
        t.assigned_by && t.assigned_by !== user?.id
          ? `Every photo done - ${memberName(memberById.get(t.assigned_by))} has been notified`
          : "Every photo on this task is done",
      );
    }
  };

  /** Every outstanding photo at once, for "mark the whole task done". */
  const writeAllPhotoItems = async (t: Task, status: "open" | "done") => {
    const rows = (t.photo_ids ?? []).map((photoId) => {
      const existing = itemsFor(t.id)?.get(photoId) ?? null;
      return taskPhotoItemPatch(t.id, photoId, status, existing?.note ?? null);
    });
    if (rows.length === 0) return true;

    const { error } = await supabase
      .from(TASK_PHOTO_ITEMS_TABLE as any)
      .upsert(rows, { onConflict: "task_id,photo_id" });
    if (error) {
      if (isMissingTaskPhotoItems(error)) {
        setPhotoItemsReady(false);
        return false;
      }
      toast.error(error.message);
      void load();
      return false;
    }
    return true;
  };

  /**
   * The one writer of `status`, so the completion rule cannot be reached around
   * by the button that happens not to go through it. `cycleStatus` used to be a
   * second copy of this and was the reason the board's tap-to-advance ignored
   * everything the row buttons checked.
   *
   * A task that carries photos is finished when its photos are. Closing one
   * from here therefore closes its photos and lets the database roll the status
   * up, instead of stamping 'done' over a job with eight pictures still
   * outstanding - which is precisely what the single button used to do.
   */
  const setStatus = async (t: Task, next: Status) => {
    if (t.status === next) return;

    if (next === "done") {
      const rights = taskRights(t);
      if (!rights.canComplete) {
        toast.error(rights.reason ?? "You can't mark this task done.");
        return;
      }
      if (rights.isOverride) {
        const who = taskAssigneeName(t);
        if (
          !(await confirm({
            title: `Mark this done for ${who}?`,
            description: `“${t.title}” is assigned to ${who}. You can close it, but it will be recorded as done without ${who} marking it.`,
            confirmText: "Mark done",
          }))
        )
          return;
      }
    }

    if (isPhotoDriven(t)) {
      const progress = taskPhotoProgress(t.photo_ids, itemsFor(t.id));
      if (next === "done" && progress.remaining > 0) {
        if (
          !(await confirm({
            title: `Mark all ${progress.total} photos done?`,
            description: `“${t.title}” still has ${progress.remaining} of ${progress.total} photos outstanding. Closing the task marks every one of them done.`,
            confirmText: "Mark all done",
          }))
        )
          return;
      }
      if (next === "done") {
        if (await writeAllPhotoItems(t, "done")) {
          const stampedAt = new Date().toISOString();
          setPhotoItems((prev) => {
            const nextIndex = new Map(prev);
            const byPhoto = new Map(nextIndex.get(t.id) ?? []);
            (t.photo_ids ?? []).forEach((pid) => {
              const existing = byPhoto.get(pid);
              byPhoto.set(pid, {
                task_id: t.id,
                photo_id: pid,
                status: "done",
                // A note already written about this photo is a record of work
                // and survives the task being closed around it.
                note: existing?.note ?? null,
                completed_by: existing?.completed_by ?? user?.id ?? null,
                completed_at: existing?.completed_at ?? stampedAt,
              });
            });
            nextIndex.set(t.id, byPhoto);
            return nextIndex;
          });
          setTasks((arr) =>
            arr.map((x) => (x.id === t.id ? { ...x, status: "done", completed_at: stampedAt } : x)),
          );
          if (t.assigned_by && t.assigned_by !== user?.id) {
            toast.success(
              `Task completed - ${memberName(memberById.get(t.assigned_by))} has been notified`,
            );
          }
          return;
        }
        // The table is not there yet. Fall through and write the status column,
        // which is what this button did before the breakdown existed.
      } else if (t.status === "done") {
        // Reopening a task reopens its photos, or the rollup would close it
        // again on the next tick.
        await writeAllPhotoItems(t, "open");
        setPhotoItems((prev) => {
          const nextIndex = new Map(prev);
          const byPhoto = new Map(
            [...(nextIndex.get(t.id) ?? [])].map(([pid, item]) => [
              pid,
              { ...item, status: "open" as const, completed_at: null, completed_by: null },
            ]),
          );
          nextIndex.set(t.id, byPhoto);
          return nextIndex;
        });
      }
    }

    const completed_at = next === "done" ? new Date().toISOString() : null;
    const before = t.status;
    setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: next, completed_at } : x)));
    const { error } = await supabase
      .from("tasks" as any)
      .update({ status: next, completed_at })
      .eq("id", t.id);
    if (error) {
      // The trigger in 20260819000000 raises the sentence we want shown, so the
      // refusal explains itself without a lookup table here.
      toast.error(error.message);
      setTasks((arr) =>
        arr.map((x) =>
          x.id === t.id ? { ...x, status: before, completed_at: t.completed_at } : x,
        ),
      );
      void load();
      return;
    }
    if (next === "done" && t.assigned_by && t.assigned_by !== user?.id) {
      toast.success(
        `Task completed - ${memberName(memberById.get(t.assigned_by))} has been notified`,
      );
    }
  };

  const cycleStatus = (t: Task) =>
    setStatus(
      t,
      t.status === "open" ? "in_progress" : t.status === "in_progress" ? "done" : "open",
    );

  const removeTask = async (t: Task) => {
    if (!(await confirm({ description: "Delete this task?", variant: "destructive" }))) return;
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

  const renderAssignee = (t: Task) => {
    const m = t.assignee_user_id ? memberById.get(t.assignee_user_id) : null;
    if (m) {
      const name = m.full_name || m.email || "Member";
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Avatar className="h-4 w-4">
            {m.avatar_url && <AvatarImage src={m.avatar_url} alt={name} />}
            <AvatarFallback className="text-[8px]">{initials(m.full_name, m.email)}</AvatarFallback>
          </Avatar>
          {name}
        </span>
      );
    }
    if (t.assignee_email) {
      return (
        <span className="text-[11px] text-muted-foreground">@{t.assignee_email.split("@")[0]}</span>
      );
    }
    return null;
  };

  const toggleExpanded = (taskId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  const renderTaskRow = (t: Task) => {
    const done = t.status === "done";
    const due = t.due_date ? dueLabel(t.due_date) : null;
    const photoDriven = isPhotoDriven(t);
    const items = itemsFor(t.id);
    const progress = taskPhotoProgress(t.photo_ids, items);
    const summary = taskWorkSummary(t.photo_ids, items);
    const isOpen = expanded.has(t.id);
    const rights = taskRights(t);
    const m = t.assignee_user_id ? memberById.get(t.assignee_user_id) : null;
    const assigneeName = m
      ? m.full_name || m.email || "Member"
      : t.assignee_email
        ? t.assignee_email.split("@")[0]
        : null;
    const assigneeInitials = m
      ? initials(m.full_name, m.email)
      : t.assignee_email
        ? initials(null, t.assignee_email)
        : null;

    return (
      <li key={t.id}>
        <div
          onClick={() => setEditing(t)}
          className={`group flex cursor-pointer items-center justify-between gap-4 rounded-2xl border-[0.8px] p-4 transition ${
            done
              ? "border-[#34D399]/30 bg-[#34D399]/[0.06]"
              : "border-border bg-card/70 hover:bg-card"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void cycleStatus(t);
              }}
              aria-label={`Status: ${STATUS_META[t.status].label} - click to advance`}
              title={`Status: ${STATUS_META[t.status].label} - click to advance`}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[0.8px] transition ${
                done
                  ? "border-[#34D399] bg-[#34D399] text-sidebar"
                  : t.status === "in_progress"
                    ? "border-[#F59E0B] bg-[#F59E0B]/15"
                    : "border-border bg-card"
              }`}
            >
              {done && <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />}
            </button>
            <div className="min-w-0">
              <p
                className={`font-manrope truncate text-sm font-extrabold text-foreground ${done ? "line-through opacity-60" : ""}`}
              >
                {t.title}
              </p>
              {/*
                The line the client said was missing. A task raised against a
                set of photos says how much of the set is handled, right where
                the single "Completed" pill used to be the whole story.
              */}
              {photoDriven && progress.total > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpanded(t.id);
                  }}
                  aria-expanded={isOpen}
                  className="mt-1.5 flex items-center gap-2 font-manrope text-xs font-bold text-muted-foreground transition hover:text-foreground"
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{progress.label}</span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-[#10B981] transition-all"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
              )}
              {/*
                And the other half of it: what was actually done, not just that
                something was. First note only on the row - the rest are one
                click away in the breakdown.
              */}
              {photoDriven && summary.done.length > 0 && !isOpen && (
                <p className="mt-1 truncate text-[11px] leading-4 text-muted-foreground">
                  {summary.done[0]}
                  {summary.done.length > 1 && ` (+${summary.done.length - 1} more)`}
                </p>
              )}
              {(assigneeName || t.priority !== "normal") && (
                <div className="mt-1 flex items-center gap-3">
                  {assigneeName && (
                    <span className="inline-flex items-center gap-1.5 font-manrope text-xs font-bold text-muted-foreground">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sidebar text-[7px] font-bold text-sidebar-foreground">
                        {assigneeInitials}
                      </span>
                      Assigned to {assigneeName}
                    </span>
                  )}
                  {t.priority !== "normal" && (
                    <Badge
                      variant="secondary"
                      className={`px-1.5 py-0 text-[10px] ${PRIORITY_META[t.priority].cls}`}
                    >
                      <Flag className="mr-1 h-2.5 w-2.5" />
                      {PRIORITY_META[t.priority].label}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {done ? (
              <span className="rounded-full bg-[#10B981] px-3 py-1.5 font-manrope text-[10px] font-extrabold text-white">
                Completed
              </span>
            ) : (
              <>
                {/* Partial progress deserves its own pill. "3/12" beside a due
                    date is the difference between a task nobody has touched and
                    one that is nearly finished, which the old row could not
                    tell apart. */}
                {photoDriven && progress.done > 0 && (
                  <span className="rounded-full border-[0.8px] border-[#10B981]/40 bg-[#10B981]/10 px-2.5 py-1.5 font-manrope text-[10px] font-extrabold tabular-nums text-[#10B981]">
                    {progress.shortLabel}
                  </span>
                )}
                {due && (
                  <span
                    className={`rounded-full px-3 py-1.5 font-manrope text-[10px] font-extrabold ${
                      due.overdue ? "bg-red-500 text-white" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {due.overdue ? `Overdue · ${due.label}` : due.label}
                  </span>
                )}
              </>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                void removeTask(t);
              }}
              aria-label="Delete task"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Opened in place rather than behind the dialog: a crew member working
            down a punch list ticks photos off, they do not edit a record. */}
        {photoDriven && isOpen && (
          <div
            className="mt-1.5 rounded-2xl border-[0.8px] border-border bg-muted/25 p-3"
            onClick={(e) => e.stopPropagation()}
          >
            <TaskPhotoChecklist
              photoIds={t.photo_ids}
              photos={projectPhotos}
              items={items}
              canComplete={rights.canComplete}
              cannotCompleteReason={rights.canComplete ? null : rights.reason}
              pending={
                new Set(
                  [...pendingPhotos]
                    .filter((k) => k.startsWith(`${t.id}:`))
                    .map((k) => k.slice(t.id.length + 1)),
                )
              }
              onToggle={(photoId, next) => writePhotoItem(t, photoId, { status: next })}
              onNote={(photoId, note) => writePhotoItem(t, photoId, { note })}
            />
          </div>
        )}
      </li>
    );
  };

  const renderBoardCard = (t: Task) => {
    const cardProgress = taskPhotoProgress(t.photo_ids, itemsFor(t.id));
    const overdue = !!(
      t.due_date &&
      t.status !== "done" &&
      new Date(t.due_date) < new Date(new Date().toDateString())
    );
    return (
      <Card
        key={t.id}
        // Matches the list-view row (rounded-2xl, hairline border, translucent
        // fill) so the same task doesn't change shape when you flip views.
        className="cursor-pointer rounded-2xl border-[0.8px] border-border bg-card/70 p-3.5 transition hover:border-primary/40 hover:bg-card"
        onClick={() => setEditing(t)}
      >
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-sm font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}
          >
            {t.title}
          </p>
          <Badge
            variant="secondary"
            className={`shrink-0 px-1.5 py-0 text-[10px] ${PRIORITY_META[t.priority].cls}`}
          >
            {PRIORITY_META[t.priority].label}
          </Badge>
        </div>
        {t.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {t.due_date && (
            <span
              className={`inline-flex items-center gap-1 text-[10px] ${overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}
            >
              <CalendarDays className="h-3 w-3" />
              {new Date(t.due_date).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
          {renderAssignee(t)}
          {t.photo_ids.length > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
              title={cardProgress.label}
            >
              <ImageIcon className="h-3 w-3" />
              {/* A bare photo count said how big the job was and nothing about
                  how much of it was left. */}
              <span className="tabular-nums">{cardProgress.shortLabel}</span>
            </span>
          )}
        </div>
        {cardProgress.isMulti && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[#10B981] transition-all"
              style={{ width: `${cardProgress.percent}%` }}
            />
          </div>
        )}
        <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
          {(["open", "in_progress", "done"] as Status[])
            .filter((s) => s !== t.status)
            .map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => void setStatus(t, s)}
              >
                → {STATUS_META[s].label}
              </Button>
            ))}
        </div>
      </Card>
    );
  };

  return (
    <div className="mt-9">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.52px] text-muted-foreground">
            Keep the next move visible
          </p>
          <h2 className="font-display mt-3 text-[48px] font-bold leading-[48px] tracking-[-1.68px] text-foreground">
            What needs attention
          </h2>
          <p className="mt-3 max-w-md font-manrope text-sm leading-6 text-muted-foreground">
            {counts.total === 0
              ? "Track punch-list items, follow-ups, and to-dos for this project."
              : "Turn field observations into accountable next steps."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card/70 p-0.5">
            <button
              onClick={() => setView("list")}
              className={`flex h-7 items-center gap-1 rounded-md px-2 font-manrope text-xs font-bold transition ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              aria-label="List view"
            >
              <LayoutList className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView("board")}
              className={`flex h-7 items-center gap-1 rounded-md px-2 font-manrope text-xs font-bold transition ${view === "board" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              aria-label="Board view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>
          {view === "list" && (
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="h-8 w-[130px] border-border bg-card/70 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            onClick={() => {
              setSeedPhotoIds([]);
              setCreating(true);
            }}
            className="h-8 rounded-lg bg-primary px-4 font-manrope text-xs font-bold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add task
          </Button>
        </div>
      </div>

      {/*
        Type-and-Enter beats a modal for a punch-list item. The full dialog is
        still one click away for priority/assignee/due-date - this just removes
        the modal from the 90% case, matching the inline add that already
        exists in the photo lightbox's task panel.
      */}
      <div className="mt-5 flex items-center gap-2">
        <Input
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void quickAdd();
            }
          }}
          placeholder="Add a task and press Enter…"
          className="h-10 rounded-xl text-sm font-medium"
          aria-label="Add a task"
        />
        <Button
          variant="outline"
          className="h-10 shrink-0 rounded-xl px-3 text-xs font-bold"
          disabled={quickAdding || !quickTitle.trim()}
          onClick={() => void quickAdd()}
        >
          {quickAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
        </Button>
      </div>

      <div className="mt-5">
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="No tasks yet"
            description="Track punch-list items, follow-ups, and to-dos for this project."
            action={
              <Button
                onClick={() => {
                  setSeedPhotoIds([]);
                  setCreating(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Add the first task
              </Button>
            }
          />
        ) : view === "list" ? (
          visible.length === 0 ? (
            <EmptyState
              icon={CheckSquare}
              title="Nothing here"
              description="No tasks match this filter."
              action={
                <Button variant="outline" onClick={() => setFilter("all")}>
                  Show all tasks
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">{visible.map(renderTaskRow)}</ul>
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {(["open", "in_progress", "done"] as Status[]).map((s) => {
              const col = tasks.filter((t) => t.status === s);
              const SM = STATUS_META[s];
              return (
                <div key={s} className="rounded-2xl border-[0.8px] border-border bg-muted/30 p-3">
                  <div className="mb-2.5 flex items-center justify-between px-0.5">
                    <div
                      className={`flex items-center gap-1.5 font-manrope text-[11px] font-extrabold uppercase tracking-[0.08em] ${SM.cls}`}
                    >
                      <SM.icon className="h-3.5 w-3.5" />
                      {SM.label}
                    </div>
                    <span className="rounded-full bg-background/60 px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                      {col.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {col.length === 0 ? (
                      <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">
                        No tasks
                      </p>
                    ) : (
                      col.map(renderBoardCard)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <TaskDialog
          open
          onClose={() => {
            setCreating(false);
            setEditing(null);
            setSeedPhotoIds([]);
          }}
          task={editing}
          projectId={projectId}
          userId={user?.id ?? ""}
          projectPhotos={projectPhotos}
          members={members}
          seedPhotoIds={seedPhotoIds}
          /* A new task is nobody's yet, so it can be filed as done outright;
             an existing one obeys the same rule as the row buttons. */
          canComplete={editing ? taskRights(editing).canComplete : true}
          completionReason={editing ? taskRights(editing).reason : null}
          /* Only an existing task has a breakdown: a task being created has no
             row for its photos to hang off yet, and the photos it is about to
             carry are all outstanding by definition. */
          items={editing ? itemsFor(editing.id) : null}
          photoItemsReady={photoItemsReady}
          pendingPhotos={pendingPhotos}
          onPhotoItem={(photoId, patch) => {
            if (editing) void writePhotoItem(editing, photoId, patch);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            setSeedPhotoIds([]);
            void load();
          }}
        />
      )}
    </div>
  );
});

function TaskDialog({
  open,
  onClose,
  task,
  projectId,
  userId,
  projectPhotos,
  members,
  seedPhotoIds,
  canComplete,
  completionReason,
  items,
  photoItemsReady,
  pendingPhotos,
  onPhotoItem,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  projectId: string;
  userId: string;
  projectPhotos: ProjectPhoto[];
  members: TeamMemberLite[];
  seedPhotoIds: string[];
  canComplete: boolean;
  completionReason: string | null;
  items: Map<string, TaskPhotoItem> | null;
  photoItemsReady: boolean;
  pendingPhotos: Set<string>;
  onPhotoItem: (photoId: string, patch: { status?: "open" | "done"; note?: string | null }) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [assigneeUserId, setAssigneeUserId] = useState<string>(task?.assignee_user_id ?? "");
  const [assigneeEmail, setAssigneeEmail] = useState(task?.assignee_email ?? "");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "normal");
  const [status, setStatus] = useState<Status>(task?.status ?? "open");
  const [photoIds, setPhotoIds] = useState<string[]>(task?.photo_ids ?? seedPhotoIds);
  const [saving, setSaving] = useState(false);

  /*
   * The breakdown covers the photos the task already carries, not the working
   * selection in this dialog. A photo picked a second ago has no saved row for
   * its state to live on, and ticking it would record work against a photo the
   * task does not yet cover. It joins the list on save.
   */
  const savedPhotoIds =
    task && photoItemsReady ? photoIds.filter((id) => task.photo_ids.includes(id)) : [];
  const photoDriven = savedPhotoIds.length > 0;
  const progress = taskPhotoProgress(savedPhotoIds, items);
  /*
   * With a breakdown in the dialog, "Done" is an outcome rather than an input:
   * the database derives it from the photos, so offering it as a choice would
   * be offering a value the next write overturns.
   */
  const doneIsDerived = photoDriven && progress.remaining > 0;

  const togglePhoto = (id: string) => {
    setPhotoIds((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  };

  const save = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!userId) {
      toast.error("Not signed in");
      return;
    }
    setSaving(true);
    const selectedMember = members.find((m) => m.user_id === assigneeUserId);
    const payload = {
      project_id: projectId,
      created_by: userId,
      title: title.trim(),
      description: description.trim() || null,
      assignee_user_id: assigneeUserId || null,
      assignee_email: assigneeUserId
        ? (selectedMember?.email ?? null)
        : assigneeEmail.trim() || null,
      /*
       * Who handed it over - the half of the relationship the schema never
       * recorded, and the reason completion can now report back to a person
       * instead of guessing at `created_by`. Reassigning to someone new makes
       * the current user the assignor; leaving the same person in place keeps
       * the original one, so editing a due date does not quietly steal the
       * notification from whoever actually delegated the work.
       */
      assigned_by: assigneeUserId
        ? task?.assignee_user_id === assigneeUserId
          ? (task.assigned_by ?? userId)
          : userId
        : null,
      due_date: dueDate || null,
      priority,
      status,
      completed_at: status === "done" ? (task?.completed_at ?? new Date().toISOString()) : null,
      photo_ids: photoIds,
    };
    const q = task
      ? supabase
          .from("tasks" as any)
          .update(payload)
          .eq("id", task.id)
      : supabase.from("tasks" as any).insert(payload);
    const { error } = await q;
    setSaving(false);
    if (error) {
      if (
        String(error.message).includes("does not exist") ||
        String(error.message).includes("assignee_user_id")
      ) {
        toast.error("Tasks table needs updating - run the latest SQL migration.");
      } else {
        toast.error(error.message);
      }
      return;
    }
    toast.success(task ? "Task updated" : "Task created");
    onSaved();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-3xl p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fix gutter at SW corner"
              autoFocus
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  {/* Closing someone else's task is refused by the database, so
                      it is not offered here either - the alternative is a save
                      that fails after the dialog has collected every other
                      edit. */}
                  <SelectItem
                    value="done"
                    disabled={(!canComplete && status !== "done") || doneIsDerived}
                  >
                    Done
                  </SelectItem>
                </SelectContent>
              </Select>
              {!canComplete ? (
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  Only the assignee or a manager can mark this done.
                </p>
              ) : doneIsDerived ? (
                <p className="mt-1 text-[10.5px] text-muted-foreground">
                  Finishes on its own once all {progress.total} photos below are done.
                </p>
              ) : null}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Priority</label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Due date</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Assignee</label>
              {members.length > 0 ? (
                <Select
                  value={assigneeUserId || "__none__"}
                  onValueChange={(v) => setAssigneeUserId(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      <span className="inline-flex items-center gap-1.5">
                        <UserIcon className="h-3.5 w-3.5" /> Unassigned
                      </span>
                    </SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        <span className="inline-flex items-center gap-1.5">
                          <Avatar className="h-4 w-4">
                            {m.avatar_url && <AvatarImage src={m.avatar_url} alt="" />}
                            <AvatarFallback className="text-[8px]">
                              {initials(m.full_name, m.email)}
                            </AvatarFallback>
                          </Avatar>
                          {m.full_name || m.email || "Member"}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type="email"
                  value={assigneeEmail}
                  onChange={(e) => setAssigneeEmail(e.target.value)}
                  placeholder="who@example.com"
                />
              )}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium">
                Attach photos {photoIds.length > 0 && `(${photoIds.length})`}
              </label>
              {photoIds.length > 0 && (
                <button
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => setPhotoIds([])}
                >
                  Clear
                </button>
              )}
            </div>
            {projectPhotos.length === 0 ? (
              <p className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                Upload photos to this project first.
              </p>
            ) : (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start">
                    <ImageIcon className="mr-2 h-3.5 w-3.5" />
                    {photoIds.length === 0 ? "Pick photos" : `${photoIds.length} selected`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-2" align="start">
                  <div className="grid max-h-72 grid-cols-3 gap-1.5 overflow-y-auto">
                    {projectPhotos.map((p) => {
                      const on = photoIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => togglePhoto(p.id)}
                          className={`relative aspect-square overflow-hidden rounded border-2 ${on ? "border-primary" : "border-transparent"} transition`}
                        >
                          {p.url ? (
                            <img src={p.url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full bg-muted" />
                          )}
                          {on && (
                            <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-primary text-primary-foreground">
                              <CheckCircle2 className="h-3 w-3" />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {photoIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {photoIds.map((pid) => {
                  const p = projectPhotos.find((x) => x.id === pid);
                  return (
                    <div
                      key={pid}
                      className="relative h-12 w-12 overflow-hidden rounded border border-border"
                    >
                      {p?.url && <img src={p.url} alt="" className="h-full w-full object-cover" />}
                      <button
                        onClick={() => togglePhoto(pid)}
                        className="absolute right-0 top-0 grid h-4 w-4 place-items-center rounded-bl bg-black/70 text-white"
                        aria-label="Remove"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/*
            What was done, and what is still outstanding, photo by photo.
            The dialog already collected a date, an assignee and a priority; the
            thing it could never say was which of the twelve photos the task
            covers had actually been dealt with.
          */}
          {photoDriven && (
            <div className="rounded-2xl border-[0.8px] border-border bg-muted/25 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
                Photo by photo
              </div>
              <TaskPhotoChecklist
                photoIds={savedPhotoIds}
                photos={projectPhotos}
                items={items}
                canComplete={canComplete}
                cannotCompleteReason={canComplete ? null : completionReason}
                pending={
                  new Set(
                    task
                      ? [...pendingPhotos]
                          .filter((k) => k.startsWith(`${task.id}:`))
                          .map((k) => k.slice(task.id.length + 1))
                      : [],
                  )
                }
                onToggle={(photoId, next) => onPhotoItem(photoId, { status: next })}
                onNote={(photoId, note) => onPhotoItem(photoId, { note })}
              />
              <p className="mt-2 text-[10.5px] text-muted-foreground">
                Ticks and notes here save straight away, separately from this dialog's Save.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {task ? "Save" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
