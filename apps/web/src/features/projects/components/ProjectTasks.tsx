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
  ShieldAlert,
  Users,
  Eye,
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  calendarDueLabel,
  formatCalendarDate,
  isCalendarDateOverdue,
  todayCalendarDate,
} from "@sitepix/shared";
import { notifyTaskChanged } from "@/lib/tasks.functions";
import { TaskCollaboration } from "./TaskCollaboration";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { completionRights, isManagerRole, overrideConfirm } from "@/lib/assignment";
import { getMyTeam } from "@/lib/teams.functions";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { TaskPhotoChecklist } from "./TaskPhotoChecklist";
import {
  TASK_PHOTO_ITEMS_TABLE,
  TASK_PHOTO_ITEM_COLUMNS,
  indexTaskPhotoItems,
  isMissingTaskPhotoItems,
  taskPhotoItemErrorMessage,
  taskPhotoIds,
  taskPhotoItemPatch,
  taskPhotoItemRows,
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

/**
 * The sentence shown before work is handed to somebody who cannot sign in.
 *
 * The client found this in the live data: "The existing 'Check Refrigerant
 * Pressure' task is assigned to Gumaro vazquez, whose email is unconfirmed.
 * The task UI doesn't warn you when assigning to a pending/unconfirmed
 * teammate, so a task can sit invisible to someone who literally can't log in
 * to see it."
 *
 * Deliberately a confirmation and not a block. An unconfirmed teammate is a
 * real person on the crew who will very likely be confirmed by Tuesday, and
 * refusing the assignment would be the app deciding how a foreman runs their
 * week. What it must not do is stay quiet, because a silent assignment to a
 * locked account is indistinguishable from a working one right up until the
 * job is missed.
 *
 * The email still goes out - it reaches their inbox whether or not the account
 * is confirmed, which is exactly where the confirmation link is sitting.
 */
function unconfirmedAssigneeConfirm(who: string) {
  return {
    title: `${who} cannot sign in yet`,
    description:
      `${who} has not confirmed their email address, so they cannot open the app to see this ` +
      `task. They will still get the email about it. Resend their confirmation from the Team ` +
      `page if they never received one.`,
    confirmText: "Assign anyway",
  };
}

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
  /**
   * Whether they have confirmed their address, and so whether they can sign in
   * at all.
   *
   * `getMyTeam` has resolved this per member since the Teams page grew its
   * "cannot sign in until they confirm their email" line, and this panel simply
   * threw it away. The client's report is what that costs: an existing task is
   * assigned to somebody whose account is stuck, "so a task can sit invisible
   * to someone who literally can't log in to see it."
   *
   * null means the lookup itself failed. Unknown is not the same as
   * unconfirmed, and a working account must never be accused of being stuck.
   */
  emailConfirmed: boolean | null;
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
  /**
   * A task to open as soon as the list has loaded, from `?task=<uuid>` in the
   * URL. Every notification a task raises carries it, so a bell that reads
   * "waiting on part" lands on the thread it was written in.
   */
  openTaskId?: string | null;
  /** Told once the task has been opened, so the id is not re-consumed. */
  onOpenedTask?: () => void;
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

/**
 * How a due date reads on a row.
 *
 * This used to be `new Date(t.due_date)`, and the client caught what that costs:
 *
 *   "I entered 08/20/2026 and the task list shows the due-date pill as
 *    'Aug 19.' Looks like a timezone rounding bug converting the date to UTC."
 *
 * Exactly that. `due_date` is a Postgres `date` and arrives as "2026-08-20",
 * which ECMAScript parses as UTC midnight; west of Greenwich every render moved
 * it back a day, and a task due today read as overdue from the moment it was
 * saved. The parsing now lives in `@sitepix/shared/calendar-date`, which rebuilds
 * a calendar date at LOCAL midnight, so the same string means the same day on
 * every screen that shows it.
 */
const dueLabel = (dueDate: string) => calendarDueLabel(dueDate);

export const ProjectTasks = forwardRef<ProjectTasksHandle, ProjectTasksProps>(function ProjectTasks(
  { projectId, projectPhotos, onCountsChanged, openTaskId, onOpenedTask },
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
  /** Tasks ticked for a bulk action. List view only - see `bulkPatch`. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
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
        emailConfirmed: typeof m.emailConfirmed === "boolean" ? m.emailConfirmed : null,
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

  /*
   * The task a notification pointed at, opened once the rows are in.
   *
   * Waits for `tasks` rather than firing on the id alone: the dialog is fed a
   * row, and there is nothing to feed it while the list is still loading. A
   * task that has since been deleted simply says so instead of leaving the
   * reader on a tab wondering which of forty rows the message was about.
   */
  useEffect(() => {
    if (!openTaskId || loading) return;
    const found = tasks.find((t) => t.id === openTaskId);
    if (found) {
      setCreating(false);
      setEditing(found);
    } else {
      toast.error("That task is no longer here.");
    }
    onOpenedTask?.(); /* eslint-disable-next-line */
  }, [openTaskId, loading, tasks]);

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

  /*
   * A selection only means anything against the rows it was made on. Changing
   * the filter or flipping to the board hides some of them, and a bulk action
   * that reaches tasks the user can no longer see is the worst kind of
   * surprise.
   */
  useEffect(() => {
    setSelected(new Set());
  }, [filter, view]);

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
      // Ticking one photo off is closing part of somebody else's job, so it
      // owes the same sentence the whole-task button gives. Without it the
      // breakdown was the quiet way round the warning.
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
        // The trigger raises the sentence worth showing, same as the task one -
        // and anything that is Postgres describing a constraint instead gets a
        // sentence a crew member can act on.
        toast.error(taskPhotoItemErrorMessage(error));
      }
      setPhotoItems(before);
      setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: beforeStatus } : x)));
      void load();
      return;
    }

    if (rolled === "done" && beforeStatus !== "done") {
      // The rollup closed the task in the database, which fires the completion
      // and watcher triggers. Send what they wrote.
      notifyTaskChanged(t.id);
      toast.success(
        t.assigned_by && t.assigned_by !== user?.id
          ? `Every photo done - ${memberName(memberById.get(t.assigned_by))} has been notified`
          : "Every photo on this task is done",
      );
    }
  };

  /** Every outstanding photo at once, for "mark the whole task done". */
  const writeAllPhotoItems = async (t: Task, status: "open" | "done") => {
    const rows = taskPhotoItemRows(
      t.id,
      t.photo_ids,
      status,
      (photoId) => itemsFor(t.id)?.get(photoId)?.note ?? null,
    );
    if (rows.length === 0) return true;

    const { error } = await supabase
      .from(TASK_PHOTO_ITEMS_TABLE as any)
      .upsert(rows, { onConflict: "task_id,photo_id" });
    if (error) {
      if (isMissingTaskPhotoItems(error)) {
        setPhotoItemsReady(false);
        return false;
      }
      toast.error(taskPhotoItemErrorMessage(error));
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
        if (
          !(await confirm(
            overrideConfirm({
              what: t.title,
              who: taskAssigneeName(t),
              confirmText: "Mark done",
            }),
          ))
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
          notifyTaskChanged(t.id);
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
    /*
     * The write landed, so the triggers have decided who is owed a message:
     * `tasks_notify_completed` for the assignor, `tasks_notify_watchers` for
     * anyone copied in. This turns those rows into email. Fire and forget - a
     * mail provider having a bad minute must not turn a saved status into a red
     * toast, and the bell has already rung either way.
     */
    notifyTaskChanged(t.id);
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

  /* --------------------------------------------------------------- bulk */

  /*
   * Assigning many tasks at once.
   *
   * The client: "With only 3 team members this doesn't bite yet, but as the
   * crew grows, one-by-one dropdown assignment won't scale to 'assign all HVAC
   * installs to the HVAC team'."
   *
   * The scaling problem is the number of ROUND TRIPS through a modal, not the
   * number of assignees, so the fix is a multi-select over the list rather than
   * a second assignee column. A task still belongs to one person; twelve of
   * them can now be handed over in one gesture, and the people who need to
   * watch rather than hold the work are watchers.
   *
   * Selection is deliberately list-view only. The board is a drag surface where
   * a row already has three tap targets on it, and a checkbox column there
   * would compete with the status buttons for the same corner.
   */
  const clearSelection = () => setSelected(new Set());

  const toggleSelected = (taskId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  const selectedTasks = useMemo(() => tasks.filter((t) => selected.has(t.id)), [tasks, selected]);

  /**
   * Apply one patch to every selected task, in one statement.
   *
   * `.in('id', ids)` rather than a loop: a bulk action that is twelve separate
   * requests can half-succeed, and there is no sensible thing to tell somebody
   * whose seventh task failed. `load()` afterwards rather than a local patch,
   * because the database may have moved more than the columns we sent (the
   * completion trigger stamps `completed_at`, the photo rollup can move
   * `status`).
   */
  const bulkPatch = async (patch: Record<string, unknown>, done: string) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    const { error } = await supabase
      .from("tasks" as any)
      .update(patch)
      .in("id", ids);
    setBulkBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Every task that moved may owe somebody a message, and the triggers have
    // already written them. One dispatch per task, none of them awaited.
    ids.forEach(notifyTaskChanged);
    clearSelection();
    await load();
    toast.success(done);
  };

  const bulkAssign = async (userId: string | null) => {
    const member = userId ? memberById.get(userId) : null;
    if (member?.emailConfirmed === false) {
      const ok = await confirm(unconfirmedAssigneeConfirm(memberName(member)));
      if (!ok) return;
    }
    await bulkPatch(
      {
        assignee_user_id: userId,
        assignee_email: member?.email ?? null,
        // Same pairing `assignmentPatch` states for checklists and workflows:
        // an assignor is only true of the assignment it was written with, so
        // clearing the assignee clears it.
        assigned_by: userId ? (user?.id ?? null) : null,
      },
      userId
        ? `${selected.size} ${selected.size === 1 ? "task" : "tasks"} assigned to ${memberName(member)}`
        : `${selected.size} ${selected.size === 1 ? "task" : "tasks"} unassigned`,
    );
  };

  /**
   * Close everything selected that this viewer is allowed to close.
   *
   * Refusals are counted rather than thrown: a manager sweeping up a job's
   * punch list should not have the whole action fail because one item belongs
   * to a tech they cannot override. The database is the real rule either way
   * (`enforce_task_completer`), so anything this skips would have been refused
   * there.
   */
  const bulkComplete = async () => {
    const allowed = selectedTasks.filter((t) => t.status !== "done" && taskRights(t).canComplete);
    const refused = selectedTasks.filter((t) => t.status !== "done" && !taskRights(t).canComplete);
    const overrides = allowed.filter((t) => taskRights(t).isOverride);

    if (allowed.length === 0) {
      toast.error(
        refused.length > 0
          ? "None of these are yours to close. Ask a manager."
          : "Those are already done.",
      );
      return;
    }
    if (overrides.length > 0) {
      const ok = await confirm({
        title: `Complete ${overrides.length} ${overrides.length === 1 ? "task" : "tasks"} for someone else?`,
        description:
          `${overrides.length} of these ${overrides.length === 1 ? "is" : "are"} assigned to ` +
          `other people. You can close ${overrides.length === 1 ? "it" : "them"}, but the record ` +
          `will show you closed ${overrides.length === 1 ? "it" : "them"}.`,
        confirmText: "Complete anyway",
      });
      if (!ok) return;
    }

    setBulkBusy(true);
    const ids = allowed.map((t) => t.id);
    const { error } = await supabase
      .from("tasks" as any)
      .update({ status: "done", completed_at: new Date().toISOString() })
      .in("id", ids);
    setBulkBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    ids.forEach(notifyTaskChanged);
    clearSelection();
    await load();
    toast.success(
      refused.length > 0
        ? `${ids.length} completed, ${refused.length} left for their assignee`
        : `${ids.length} ${ids.length === 1 ? "task" : "tasks"} completed`,
    );
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !(await confirm({
        title: `Delete ${ids.length} ${ids.length === 1 ? "task" : "tasks"}?`,
        description: "This cannot be undone.",
        variant: "destructive",
        confirmText: "Delete",
      }))
    )
      return;
    setBulkBusy(true);
    const { error } = await supabase
      .from("tasks" as any)
      .delete()
      .in("id", ids);
    setBulkBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    clearSelection();
    await load();
    toast.success(`${ids.length} ${ids.length === 1 ? "task" : "tasks"} deleted`);
  };

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

    const isSelected = selected.has(t.id);
    /* Unknown is not the same as unconfirmed - see `TeamMemberLite`. */
    const assigneeBlocked = m?.emailConfirmed === false;

    return (
      <li key={t.id}>
        <div
          onClick={() => setEditing(t)}
          className={`group flex cursor-pointer items-center justify-between gap-4 rounded-2xl border-[0.8px] p-4 transition ${
            isSelected
              ? "border-primary/50 bg-primary/[0.06]"
              : done
                ? "border-[#34D399]/30 bg-[#34D399]/[0.06]"
                : "border-border bg-card/70 hover:bg-card"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            {/* Hidden until it is useful: a checkbox column on every row all the
                time turns a punch list into a spreadsheet. It appears on hover,
                and stays put once anything is selected. */}
            <span
              onClick={(e) => e.stopPropagation()}
              className={`shrink-0 transition ${
                isSelected || selected.size > 0
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => toggleSelected(t.id)}
                aria-label={`Select ${t.title}`}
              />
            </span>
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
                      {/* The task the client found: assigned, and invisible to
                          its assignee because their account is not confirmed.
                          Said on the row, not only behind the dialog, because
                          the whole problem is that nothing about the list looked
                          wrong. */}
                      {assigneeBlocked && (
                        <span
                          title={`${assigneeName} has not confirmed their email and cannot sign in yet`}
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-700 dark:text-amber-300"
                        >
                          <ShieldAlert className="h-2.5 w-2.5" />
                          Cannot sign in
                        </span>
                      )}
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
    // Local-midnight comparison, same fix as `dueLabel` above: the board card
    // had its own copy of the UTC-parsing bug and would flag a task due today
    // as overdue.
    const overdue = !!(t.due_date && t.status !== "done" && isCalendarDateOverdue(t.due_date));
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
              {formatCalendarDate(t.due_date)}
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

      {/*
        The bulk bar. Appears only once something is ticked, so the panel looks
        exactly as it did to anyone who never uses it.

        "Assign all HVAC installs to the HVAC team" is two gestures here: filter
        or tick the rows, pick the person. The role-shaped half of that question
        lives on the watcher picker inside a task, because a role is a group and
        an assignee is one person - handing twelve tasks to "the HVAC team"
        without naming anybody is how work ends up belonging to nobody.
      */}
      {view === "list" && selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border-[0.8px] border-primary/40 bg-primary/[0.06] p-2.5">
          <span className="ml-1 font-manrope text-xs font-extrabold tabular-nums text-foreground">
            {selected.size} selected
          </span>

          <Select
            value=""
            disabled={bulkBusy}
            onValueChange={(v) => void bulkAssign(v === "__none__" ? null : v)}
          >
            <SelectTrigger className="h-8 w-[168px] border-border bg-card text-xs">
              <span className="inline-flex items-center gap-1.5 truncate">
                <UserIcon className="h-3.5 w-3.5" />
                Assign to
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  <span className="inline-flex items-center gap-1.5">
                    {memberName(m)}
                    {m.emailConfirmed === false && (
                      <ShieldAlert className="h-3 w-3 text-amber-500" />
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value=""
            disabled={bulkBusy}
            onValueChange={(v) =>
              void bulkPatch(
                { priority: v },
                `${selected.size} set to ${PRIORITY_META[v as Priority].label}`,
              )
            }
          >
            <SelectTrigger className="h-8 w-[150px] border-border bg-card text-xs">
              <span className="inline-flex items-center gap-1.5 truncate">
                <Flag className="h-3.5 w-3.5" />
                Priority
              </span>
            </SelectTrigger>
            <SelectContent>
              {(["low", "normal", "high", "urgent"] as Priority[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_META[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* A bare date input rather than a picker in a popover. The value it
              produces is already "YYYY-MM-DD", which is exactly what the `date`
              column stores, so nothing between here and Postgres has to guess
              at a timezone. No `min`: backdating a due date is a legitimate
              thing to do to a punch list that has slipped. */}
          <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs">
            <CalendarDays className="h-3.5 w-3.5" />
            <input
              type="date"
              disabled={bulkBusy}
              defaultValue=""
              onChange={(e) =>
                e.target.value &&
                void bulkPatch(
                  { due_date: e.target.value },
                  `${selected.size} due ${formatCalendarDate(e.target.value)}`,
                )
              }
              className="bg-transparent text-xs outline-none"
              aria-label="Set a due date on the selected tasks"
            />
          </label>

          <Button
            size="sm"
            variant="outline"
            disabled={bulkBusy}
            onClick={() => void bulkComplete()}
            className="h-8 rounded-lg bg-card px-3 text-xs font-bold"
          >
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Mark done
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={bulkBusy}
            onClick={() => void bulkDelete()}
            className="h-8 rounded-lg px-3 text-xs font-bold text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete
          </Button>

          <div className="ml-auto flex items-center gap-1">
            {selected.size < visible.length && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-lg px-3 text-xs font-bold"
                onClick={() => setSelected(new Set(visible.map((t) => t.id)))}
              >
                Select all {visible.length}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-lg px-3 text-xs font-bold"
              onClick={clearSelection}
            >
              {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Clear"}
            </Button>
          </div>
        </div>
      )}

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
          /* The viewer rather than a verdict about them: the dialog can change
             the assignee, so who may close the task is a question about the
             values on screen and has to be asked again as they are edited. */
          isManager={viewer.isManager}
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

/**
 * One label, spelled the same way on every field in this dialog.
 *
 * The dialog arrived from the Lovable build with default shadcn labels
 * (`text-xs font-medium`) sitting inside a panel that had since been rebuilt in
 * the product's own type: Manrope, extrabold, uppercase, letter-spaced, with
 * a display face on headings. The client's note was "we should unify the
 * creation flow to our new design/theme", and this is the smallest piece of
 * that: a field label that matches the section headers three inches above it.
 */
function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
        {children}
      </label>
      {hint && <span className="text-[10.5px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** The rounded-2xl hairline card the rest of the panel is built out of. */
function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border-[0.8px] border-border bg-muted/25 p-3.5 ${className}`}>
      {children}
    </div>
  );
}

function TaskDialog({
  open,
  onClose,
  task,
  projectId,
  userId,
  projectPhotos,
  members,
  seedPhotoIds,
  isManager,
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
  isManager: boolean;
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
  /*
   * Deduplicated on the way in, which heals the row as well as the screen. A
   * legacy `photo_ids` naming one photo twice gave this dialog two chips with the
   * same React key and a count that disagreed with the breakdown below it - and
   * because the array is sent back on every save, cleaning it here means opening
   * the task once is enough to fix the stored value for good.
   */
  const [photoIds, setPhotoIds] = useState<string[]>(taskPhotoIds(task?.photo_ids ?? seedPhotoIds));
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  /*
   * Who this task will belong to once saved - not who it belonged to when the
   * dialog opened.
   *
   * The assignor half has to be predicted the same way `save` writes it, or
   * assigning a task to someone and closing it in the same edit would be judged
   * against the old row and pass unremarked. Reassigning makes the editor the
   * assignor, which is exactly the case the confirmation exists for.
   *
   * Leaving the assignee alone keeps whatever assignor is recorded, including
   * none. `save` backfills a missing one to the editor so old rows stop
   * notifying nobody, but that backfill must not be read back as a right: a
   * crew member opening a pre-`assigned_by` task would otherwise make
   * themselves its assignor and unlock a completion the row buttons refuse.
   */
  const pendingAssignedBy = assigneeUserId
    ? task?.assignee_user_id === assigneeUserId
      ? (task.assigned_by ?? null)
      : userId
    : null;
  const selectedMember = members.find((m) => m.user_id === assigneeUserId);
  const pendingAssigneeName = assigneeUserId
    ? memberName(selectedMember)
    : assigneeEmail.trim() || null;
  const rights = completionRights(
    { assignedTo: assigneeUserId || null, assignedBy: pendingAssignedBy },
    { userId: userId || null, isManager },
    pendingAssigneeName,
  );
  const canComplete = rights.canComplete;
  /*
   * Only a save that actually closes the task owes the ceremony. Re-saving a
   * task that was already done (fixing its title, say) is not a completion and
   * must not ask again.
   */
  const completesNow = status === "done" && task?.status !== "done";

  /*
   * Assigning to somebody who cannot open the app.
   *
   * Shown live under the field rather than only as a confirmation on save, so
   * the choice is informed while it is being made. `emailConfirmed` is null when
   * the lookup itself failed, and unknown must never be rendered as a warning.
   */
  const assigneeBlocked = selectedMember?.emailConfirmed === false;
  /* True only when the save is what creates the problem, so re-saving a task
     that was already assigned to them does not re-litigate it. */
  const newlyAssigningBlocked = assigneeBlocked && task?.assignee_user_id !== assigneeUserId;

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

  /** Due-date shortcuts, in the reader's own calendar rather than in UTC. */
  const dueShortcuts: Array<{ label: string; value: string }> = (() => {
    const today = new Date();
    const plus = (days: number) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
      return todayCalendarDate(d);
    };
    return [
      { label: "Today", value: plus(0) },
      { label: "Tomorrow", value: plus(1) },
      { label: "Next week", value: plus(7) },
    ];
  })();

  const save = async () => {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (!userId) {
      toast.error("Not signed in");
      return;
    }
    /*
     * The reported hole: this dialog wrote `status` straight out, so opening a
     * task and picking "Done" here closed somebody else's work with none of the
     * warning the progress button gives. Same rule, same sentence, asked before
     * anything is written.
     */
    if (completesNow) {
      if (!rights.canComplete) {
        toast.error(rights.reason ?? "You can't mark this task done.");
        return;
      }
      if (rights.isOverride) {
        const ok = await confirm(
          overrideConfirm({
            what: title.trim(),
            who: pendingAssigneeName ?? "the assignee",
            confirmText: "Save and complete",
          }),
        );
        if (!ok) return;
      }
    }
    /*
     * And the one the client found: handing work to a teammate who cannot sign
     * in. Asked last, so it is the final thing between the decision and the
     * write, and only when this save is what creates the situation.
     */
    if (newlyAssigningBlocked) {
      const ok = await confirm(unconfirmedAssigneeConfirm(memberName(selectedMember)));
      if (!ok) return;
    }
    setSaving(true);
    const payload = {
      project_id: projectId,
      created_by: task?.created_by ?? userId,
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
    /*
     * `select('id')` on both arms, because the id is what the notification
     * dispatch is keyed on. An insert that did not hand back its id was the
     * reason a brand new task assigned to somebody could not be followed up
     * with an email without a second round trip to find the row again.
     */
    const q = task
      ? supabase
          .from("tasks" as any)
          .update(payload)
          .eq("id", task.id)
          .select("id")
          .single()
      : supabase
          .from("tasks" as any)
          .insert(payload)
          .select("id")
          .single();
    const { data: saved, error } = await q;
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

    /*
     * Send whatever that write owed.
     *
     * This is the client's first and loudest finding - "No notification fires
     * on assignment ... crew members have no way to know new work landed on
     * them unless they're manually refreshing the app". The in-app row is
     * written by `tasks_notify_assignee` the moment the statement above
     * commits; this turns it into an email that reaches somebody who is not
     * looking at a dashboard.
     */
    const savedId = ((saved ?? null) as { id?: string } | null)?.id ?? task?.id;
    if (savedId) notifyTaskChanged(savedId);

    const assigneeChanged = (task?.assignee_user_id ?? null) !== (assigneeUserId || null);
    if (assigneeUserId && assigneeChanged && assigneeUserId !== userId) {
      toast.success(`${memberName(selectedMember)} has been notified`);
    } else {
      toast.success(task ? "Task updated" : "Task created");
    }
    onSaved();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {/* The confirmations raised from in here would otherwise dismiss this
          dialog when answered; DialogContent guards that for every dialog.
          See lib/modal-layers.ts. */}
      <DialogContent className="max-w-3xl gap-0 overflow-hidden rounded-3xl border-[0.8px] border-border p-0">
        {/* Letterhead, in the panel's own type rather than shadcn's default
            dialog title. The eyebrow/display pairing is the same one the Tasks
            tab uses for "Keep the next move visible / What needs attention". */}
        <DialogHeader className="space-y-0 border-b border-border bg-muted/30 px-6 py-5 text-left sm:px-7">
          <p className="font-manrope text-[10px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
            {task ? "Edit task" : "New task"}
          </p>
          <DialogTitle className="font-display mt-1.5 text-[26px] font-bold leading-[30px] tracking-[-0.8px] text-foreground">
            {task ? (task.title ?? "Task") : "What needs doing?"}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[68vh] space-y-4 overflow-y-auto px-6 py-5 sm:px-7">
          <div>
            <FieldLabel>Title</FieldLabel>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fix gutter at SW corner"
              className="h-11 rounded-xl text-sm font-medium"
              autoFocus
            />
          </div>

          <div>
            <FieldLabel hint="What the job is. Notes about it go in Activity below.">
              Description
            </FieldLabel>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details…"
              rows={3}
              className="rounded-xl text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel>Status</FieldLabel>
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger className="h-11 rounded-xl">
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
                <p className="mt-1.5 text-[10.5px] leading-4 text-muted-foreground">
                  {rights.reason ?? "Only the assignee or a manager can mark this done."}
                </p>
              ) : rights.isOverride && completesNow ? (
                /* Allowed, but it is someone else's name being overridden -
                   said here as well as in the confirmation, so the choice is
                   informed before it is made. */
                <p className="mt-1.5 text-[10.5px] leading-4 text-amber-600 dark:text-amber-500">
                  {rights.reason}
                </p>
              ) : doneIsDerived ? (
                <p className="mt-1.5 text-[10.5px] leading-4 text-muted-foreground">
                  Finishes on its own once all {progress.total} photos below are done.
                </p>
              ) : null}
            </div>

            <div>
              <FieldLabel>Priority</FieldLabel>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
                <SelectTrigger className="h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["low", "normal", "high", "urgent"] as Priority[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      <span className="inline-flex items-center gap-1.5">
                        <Flag className="h-3 w-3" />
                        {PRIORITY_META[p].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel hint={dueDate ? formatCalendarDate(dueDate) : undefined}>
                Due date
              </FieldLabel>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-11 rounded-xl text-sm"
              />
              {/* The shortcuts are computed off the browser's own calendar day,
                  so "Today" is the reader's today. Typing 08/20 and getting
                  Aug 19 back is the bug this release fixes; a shortcut built on
                  `new Date().toISOString()` would have quietly reintroduced it. */}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {dueShortcuts.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setDueDate(dueDate === s.value ? "" : s.value)}
                    className={`rounded-full border-[0.8px] px-2.5 py-1 font-manrope text-[10.5px] font-bold transition ${
                      dueDate === s.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
                {dueDate && (
                  <button
                    type="button"
                    onClick={() => setDueDate("")}
                    className="rounded-full border-[0.8px] border-transparent px-2 py-1 font-manrope text-[10.5px] font-bold text-muted-foreground transition hover:text-destructive"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div>
              <FieldLabel hint="One person holds it. Copy others in below.">Assignee</FieldLabel>
              {members.length > 0 ? (
                <Select
                  value={assigneeUserId || "__none__"}
                  onValueChange={(v) => setAssigneeUserId(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger className="h-11 rounded-xl">
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
                          {memberName(m)}
                          {/* Marked in the list, not only after the fact: the
                              point is to be seen before the pick, not to
                              explain the pick afterwards. */}
                          {m.emailConfirmed === false && (
                            <ShieldAlert className="h-3 w-3 text-amber-500" />
                          )}
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
                  className="h-11 rounded-xl text-sm"
                />
              )}
              {assigneeBlocked && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[10.5px] leading-4 text-amber-600 dark:text-amber-500">
                  <ShieldAlert className="mt-px h-3 w-3 shrink-0" />
                  <span>
                    {memberName(selectedMember)} has not confirmed their email and cannot sign in
                    yet. They will still get the email about this task.
                  </span>
                </p>
              )}
            </div>
          </div>

          <div>
            <FieldLabel hint={photoIds.length > 0 ? `${photoIds.length} attached` : undefined}>
              Photos
            </FieldLabel>
            {projectPhotos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                Upload photos to this project first.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-10 flex-1 justify-start rounded-xl text-xs font-bold"
                    >
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
                            className={`relative aspect-square overflow-hidden rounded-lg border-2 ${on ? "border-primary" : "border-transparent"} transition`}
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
                {photoIds.length > 0 && (
                  <Button
                    variant="ghost"
                    className="h-10 rounded-xl px-3 text-xs font-bold text-muted-foreground"
                    onClick={() => setPhotoIds([])}
                  >
                    Clear
                  </Button>
                )}
              </div>
            )}
            {photoIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {photoIds.map((pid) => {
                  const p = projectPhotos.find((x) => x.id === pid);
                  return (
                    <div
                      key={pid}
                      className="relative h-12 w-12 overflow-hidden rounded-lg border border-border"
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
            <Panel>
              <div className="mb-2 flex items-center gap-1.5 font-manrope text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" />
                Photo by photo
              </div>
              <TaskPhotoChecklist
                photoIds={savedPhotoIds}
                photos={projectPhotos}
                items={items}
                canComplete={canComplete}
                cannotCompleteReason={canComplete ? null : rights.reason}
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
            </Panel>
          )}

          {/*
            The CC line and the thread.
            Only on a saved task: both hang off a task id, and a task being
            created does not have one yet. Rather than hide that, the empty
            state says so, because "where are the comments" is a worse question
            than "save it first".
          */}
          {task ? (
            <TaskCollaboration
              taskId={task.id}
              members={members}
              currentUserId={userId}
              assigneeUserId={assigneeUserId || null}
            />
          ) : (
            <Panel className="flex items-start gap-2.5">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="font-manrope text-xs leading-5 text-muted-foreground">
                Create the task first, then you can copy other people in and leave notes on it.
                Whoever you assign it to is emailed as soon as you save.
              </p>
            </Panel>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-border bg-muted/20 px-6 py-4 sm:px-7">
          {/* Says what pressing Save will do to somebody else's day. An
              assignment that notifies a person should not be a silent side
              effect of a button labelled "Save". */}
          {assigneeUserId &&
            assigneeUserId !== userId &&
            (task?.assignee_user_id ?? null) !== assigneeUserId && (
              <p className="mr-auto flex items-center gap-1.5 font-manrope text-[11px] font-bold text-muted-foreground">
                <Eye className="h-3.5 w-3.5" />
                {memberName(selectedMember)} will be notified
              </p>
            )}
          <Button variant="ghost" className="rounded-xl font-bold" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="rounded-xl px-5 font-bold">
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {task ? "Save" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
