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
import { getMyTeam } from "@/lib/teams.functions";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";

type Status = "open" | "in_progress" | "done";
type Priority = "low" | "normal" | "high" | "urgent";

interface Task {
  id: string;
  project_id: string;
  created_by: string;
  assignee_email: string | null;
  assignee_user_id: string | null;
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
}

interface TeamMemberLite {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export interface ProjectTasksHandle {
  createWithPhoto: (photoId: string) => void;
}

interface ProjectTasksProps {
  projectId: string;
  /** Photos already loaded for the project page (id + signed/public URL). */
  projectPhotos: ProjectPhoto[];
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
  { projectId, projectPhotos },
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
      priority: "medium",
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
    } else {
      setTasks(data as any[] as Task[]);
    }
    setLoading(false);
  };

  const loadTeam = async () => {
    try {
      const res = await fetchTeam();
      const list: TeamMemberLite[] = (res?.members ?? []).map((m: any) => ({
        user_id: m.user_id,
        full_name: m.profile?.full_name ?? null,
        email: m.profile?.email ?? null,
        avatar_url: m.profile?.avatar_url ?? null,
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

  const cycleStatus = async (t: Task) => {
    const next: Status =
      t.status === "open" ? "in_progress" : t.status === "in_progress" ? "done" : "open";
    const completed_at = next === "done" ? new Date().toISOString() : null;
    setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: next, completed_at } : x)));
    const { error } = await supabase
      .from("tasks" as any)
      .update({ status: next, completed_at })
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      void load();
    }
  };

  const setStatus = async (t: Task, next: Status) => {
    if (t.status === next) return;
    const completed_at = next === "done" ? new Date().toISOString() : null;
    setTasks((arr) => arr.map((x) => (x.id === t.id ? { ...x, status: next, completed_at } : x)));
    const { error } = await supabase
      .from("tasks" as any)
      .update({ status: next, completed_at })
      .eq("id", t.id);
    if (error) {
      toast.error(error.message);
      void load();
    }
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

  const renderTaskRow = (t: Task) => {
    const done = t.status === "done";
    const due = t.due_date ? dueLabel(t.due_date) : null;
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
              aria-label={`Status: ${STATUS_META[t.status].label} — click to advance`}
              title={`Status: ${STATUS_META[t.status].label} — click to advance`}
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
              due && (
                <span
                  className={`rounded-full px-3 py-1.5 font-manrope text-[10px] font-extrabold ${
                    due.overdue ? "bg-red-500 text-white" : "bg-primary text-primary-foreground"
                  }`}
                >
                  {due.overdue ? `Overdue · ${due.label}` : due.label}
                </span>
              )
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
      </li>
    );
  };

  const renderBoardCard = (t: Task) => {
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
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <ImageIcon className="h-3 w-3" />
              {t.photo_ids.length}
            </span>
          )}
        </div>
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
        still one click away for priority/assignee/due-date — this just removes
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
                <div
                  key={s}
                  className="rounded-2xl border-[0.8px] border-border bg-muted/30 p-3"
                >
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
        toast.error("Tasks table needs updating — run the latest SQL migration.");
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
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
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
