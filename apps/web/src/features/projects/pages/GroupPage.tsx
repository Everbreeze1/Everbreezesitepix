import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderPlus,
  Loader2,
  Camera,
  FileText,
  ListChecks,
  CheckSquare,
  MapPin,
  ImageOff,
  Image as ImageIcon,
  Clock,
  CircleDot,
  Circle,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getProjectGroup,
  updateProjectGroup,
  deleteProjectGroup,
} from "@/lib/project-groups.functions";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useTeamMembers } from "@/hooks/use-team-members";
import { completionRights } from "@/lib/assignment";
import {
  TASK_PHOTO_ITEMS_TABLE,
  TASK_PHOTO_ITEM_COLUMNS,
  indexTaskPhotoItems,
  isMissingTaskPhotoItems,
  taskPhotoItemErrorMessage,
  taskPhotoItemRows,
  taskPhotoProgress,
  type TaskPhotoItem,
  type TaskPhotoItemIndex,
} from "@/lib/task-photo-items";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { EditGroupProjectsDialog } from "@/features/projects/components/EditGroupProjectsDialog";
import type { ProjectPickerRow } from "@/features/projects/components/CreateGroupDialog";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function locationOf(p: any): string | null {
  if (p.location && p.location.trim()) return p.location;
  const parts = [p.street, p.city, p.state].filter((x: any) => x && String(x).trim());
  return parts.length ? parts.join(", ") : null;
}

export function GroupPage() {
  const { groupId } = useParams({ from: "/_app/groups/$groupId" });
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isManager } = useTeamMembers();
  const fetchGroup = getProjectGroup;
  const updateGroup = updateProjectGroup;
  const removeGroup = deleteProjectGroup;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [allProjects, setAllProjects] = useState<ProjectPickerRow[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [descriptionValue, setDescriptionValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  /**
   * Per-photo state for the photo-bearing tasks across every project in this
   * group, keyed task -> photo. A rollup that shows "In Progress" and nothing
   * else cannot say whether that means one photo of twelve or eleven.
   */
  const [photoItems, setPhotoItems] = useState<TaskPhotoItemIndex>(new Map());

  const load = async () => {
    setLoading(true);
    try {
      const res = (await fetchGroup({ data: { groupId } })) as any;
      setData(res);
      setRenameValue(res.group.name);
      setDescriptionValue(res.group.description ?? "");
      await loadPhotoItems(res);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load group");
      navigate({ to: "/projects" });
    } finally {
      setLoading(false);
    }
  };

  /** One query for the whole group, and only for tasks that carry photos. */
  const loadPhotoItems = async (res: any) => {
    const taskIds: string[] = (res?.projects ?? []).flatMap((p: any) =>
      (p.tasks ?? []).filter((t: any) => (t.photo_ids?.length ?? 0) > 0).map((t: any) => t.id),
    );
    if (taskIds.length === 0) {
      setPhotoItems(new Map());
      return;
    }
    const { data: rows, error } = await (supabase as any)
      .from(TASK_PHOTO_ITEMS_TABLE)
      .select(TASK_PHOTO_ITEM_COLUMNS)
      .in("task_id", taskIds);
    if (error) {
      // Silent before the migration is applied: the rollup then reads exactly
      // as it did, which is the right fallback and not a crew member's problem.
      if (!isMissingTaskPhotoItems(error)) toast.error(error.message);
      setPhotoItems(new Map());
      return;
    }
    setPhotoItems(indexTaskPhotoItems((rows ?? []) as TaskPhotoItem[]));
  };

  const loadAllProjects = async () => {
    const { data: rows } = await (supabase as any)
      .from("projects")
      .select("id, name, location, street, city, state")
      .order("updated_at", { ascending: false });
    setAllProjects(
      ((rows as any[]) ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        location: locationOf(p),
      })),
    );
  };

  useEffect(() => {
    void load();
    void loadAllProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const memberIds = useMemo(() => (data?.projects ?? []).map((p: any) => p.id), [data]);

  const submitRename = async () => {
    const n = renameValue.trim();
    if (!n) return;
    setSaving(true);
    try {
      await updateGroup({
        data: { id: groupId, name: n, description: descriptionValue.trim() || null },
      });
      toast.success("Group updated");
      setRenameOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update");
    } finally {
      setSaving(false);
    }
  };

  const submitDelete = async () => {
    try {
      await removeGroup({ data: { id: groupId } });
      toast.success("Group deleted");
      navigate({ to: "/projects" });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete");
    }
  };

  // Optimistic mutation helpers ----------------------------------------------
  const [expandedChecklists, setExpandedChecklists] = useState<Record<string, boolean>>({});
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");

  const patchProject = (projectId: string, patcher: (p: any) => any) => {
    setData((cur: any) => {
      if (!cur) return cur;
      return {
        ...cur,
        projects: cur.projects.map((p: any) => (p.id === projectId ? patcher(p) : p)),
      };
    });
  };

  const toggleChecklistItem = async (
    projectId: string,
    checklistId: string,
    itemId: string,
    currentlyDone: boolean,
  ) => {
    const nextCompletedAt = currentlyDone ? null : new Date().toISOString();
    patchProject(projectId, (p) => {
      const checklists = (p.checklists ?? []).map((c: any) => {
        if (c.id !== checklistId) return c;
        const items = c.items.map((i: any) =>
          i.id === itemId ? { ...i, completed_at: nextCompletedAt } : i,
        );
        const done = items.filter((i: any) => i.completed_at).length;
        return { ...c, items, done };
      });
      const clDone = checklists.reduce((s: number, c: any) => s + c.done, 0);
      const clTotal = checklists.reduce((s: number, c: any) => s + c.total, 0);
      return { ...p, checklists, checklist_items_done: clDone, checklist_items_total: clTotal };
    });
    const { error } = await (supabase as any)
      .from("project_checklist_items")
      .update({ completed_at: nextCompletedAt })
      .eq("id", itemId);
    if (error) {
      toast.error("Could not update item");
      void load();
    }
  };

  const updateTaskStatus = async (
    projectId: string,
    taskId: string,
    nextStatus: string,
    task?: {
      assignee_user_id: string | null;
      assigned_by: string | null;
      photo_ids?: string[] | null;
    },
  ) => {
    // The same rule the project panel and the photo panel apply - a rollup is
    // still a place work gets closed from, and this one used to be the way
    // round every check the others made.
    if (nextStatus === "done" && task) {
      const rights = completionRights(
        { assignedTo: task.assignee_user_id, assignedBy: task.assigned_by },
        { userId: user?.id ?? null, isManager },
      );
      if (!rights.canComplete) {
        toast.error(rights.reason ?? "You can't mark this task done.");
        return;
      }
    }

    /*
     * A task raised against photos is finished when its photos are, exactly as
     * on the project tab. Writing `status` alone from here would stamp
     * "Completed" over a job with twelve untouched pictures, and the first tick
     * on any one of them would roll it back to in progress on its own - the
     * rollup counting one done out of twelve. So the photos are written and the
     * database derives the status from them.
     */
    const photoIds = task?.photo_ids ?? [];
    if (photoIds.length > 0 && (nextStatus === "done" || nextStatus === "open")) {
      const rows = taskPhotoItemRows(taskId, photoIds, nextStatus === "done" ? "done" : "open");
      const { error: itemError } = await (supabase as any)
        .from(TASK_PHOTO_ITEMS_TABLE)
        .upsert(rows, { onConflict: "task_id,photo_id" });
      if (itemError && !isMissingTaskPhotoItems(itemError)) {
        toast.error(taskPhotoItemErrorMessage(itemError));
        void load();
        return;
      }
      // A missing table means the migration has not been applied yet, so this
      // falls through to the status write it has always done.
    }

    patchProject(projectId, (p) => ({
      ...p,
      tasks: (p.tasks ?? []).map((t: any) => (t.id === taskId ? { ...t, status: nextStatus } : t)),
    }));
    const patch: Record<string, any> = { status: nextStatus };
    if (nextStatus === "done") patch.completed_at = new Date().toISOString();
    else patch.completed_at = null;
    const { error } = await (supabase as any).from("tasks").update(patch).eq("id", taskId);
    if (error) {
      // The completion trigger raises its own sentence; a blanket "Could not
      // update task" would hide the only useful thing it said.
      toast.error(error.message || "Could not update task");
      void load();
    }
  };

  const saveTaskTitle = async (projectId: string, taskId: string) => {
    const title = editingTaskTitle.trim();
    setEditingTaskId(null);
    if (!title) return;
    patchProject(projectId, (p) => ({
      ...p,
      tasks: (p.tasks ?? []).map((t: any) => (t.id === taskId ? { ...t, title } : t)),
    }));
    const { error } = await (supabase as any).from("tasks").update({ title }).eq("id", taskId);
    if (error) {
      toast.error("Could not rename task");
      void load();
    }
  };

  if (loading || !data) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading group…
        </div>
      </div>
    );
  }

  const { group, projects, recent_photos, totals } = data;

  return (
    <div className="container mx-auto max-w-6xl px-4 pb-24 pt-6 md:pt-10">
      {/* Header */}
      <div className="mb-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-3 -ml-2 h-8 gap-1 text-muted-foreground"
        >
          <Link to="/projects">
            <ArrowLeft className="h-3.5 w-3.5" /> Projects
          </Link>
        </Button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">{group.name}</h1>
            {group.description && (
              <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.projects} {totals.projects === 1 ? "project" : "projects"} · updated{" "}
              {timeAgo(group.updated_at)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditProjectsOpen(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit Projects
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  aria-label="Group actions"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setRenameOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" /> Rename Group
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setEditProjectsOpen(true)}>
                  <ListChecks className="mr-2 h-4 w-4" /> Edit Projects
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/projects/new">
                    <FolderPlus className="mr-2 h-4 w-4" /> Add New Project
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete Group
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Overview stats */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">
            <Camera className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Photos
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
            {totals.photos}
          </div>
        </Card>
        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">
            <FileText className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Reports
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
            {totals.reports}
          </div>
        </Card>
        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">
            <ListChecks className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Checklists
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
            {totals.checklists}
          </div>
        </Card>
        <Card className="p-3 sm:p-4">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:text-xs">
            <CheckSquare className="h-3 w-3 sm:h-3.5 sm:w-3.5" /> Tasks
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">{totals.tasks}</div>
        </Card>
      </div>

      {/* Recent photos across group */}
      {recent_photos.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold sm:text-base">
            <Clock className="h-3.5 w-3.5" /> Combined recent photos
          </h2>
          <div className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-3">
              {recent_photos.map((p: any) => (
                <Link
                  key={p.id}
                  to="/projects/$projectId"
                  params={{ projectId: p.project_id }}
                  className="group block w-36 shrink-0 sm:w-40"
                >
                  <Card className="overflow-hidden border-border/60 p-0 transition-all group-hover:-translate-y-0.5 group-hover:shadow-md">
                    <div className="relative aspect-square bg-muted">
                      {p.url ? (
                        <img
                          src={p.url}
                          alt={p.caption ?? ""}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ImageOff className="h-6 w-6 opacity-50" />
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                        <p className="line-clamp-1 text-[11px] font-semibold text-white">
                          {p.project_name}
                        </p>
                        <p className="text-[10px] text-white/80">{timeAgo(p.created_at)}</p>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Projects list */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Projects in group</h2>
          {projects.length > 0 && (
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                <Link to="/projects" search={{ tab: "checklists" } as any}>
                  <ListChecks className="mr-1.5 h-3.5 w-3.5" /> View all checklists
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                <Link to="/projects" search={{ tab: "tasks" } as any}>
                  <CheckSquare className="mr-1.5 h-3.5 w-3.5" /> View all tasks
                </Link>
              </Button>
            </div>
          )}
        </div>
        {projects.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title="No projects in this group yet"
            description="Add projects with Edit Projects to build a shared view."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {projects.map((p: any) => {
              const loc = locationOf(p);
              const checklists: Array<{
                id: string;
                name: string;
                total: number;
                done: number;
                items: Array<{ id: string; label: string; completed_at: string | null }>;
              }> = p.checklists ?? [];
              const tasks: Array<{
                id: string;
                title: string;
                status: string;
                priority: string;
                due_date: string | null;
                assignee_email: string | null;
                assignee_user_id: string | null;
                assigned_by: string | null;
              }> = p.tasks ?? [];
              const openTasks = tasks.filter((t) => t.status !== "done");
              const clDone = p.checklist_items_done ?? 0;
              const clTotal = p.checklist_items_total ?? 0;
              return (
                <Card
                  key={p.id}
                  className="group relative overflow-hidden border-border/60 p-0 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
                >
                  <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 p-4 sm:gap-6 sm:p-5">
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: p.id }}
                      className="relative block h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-muted sm:h-24 sm:w-24"
                    >
                      {p.cover_url ? (
                        <img
                          src={p.cover_url}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ImageOff className="h-5 w-5 opacity-60" />
                        </div>
                      )}
                    </Link>
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: p.id }}
                        className="truncate text-lg font-semibold leading-tight tracking-tight hover:text-primary"
                      >
                        {p.name}
                      </Link>
                      {loc && (
                        <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{loc}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-0.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Camera className="h-3.5 w-3.5" />
                          <span className="font-semibold text-foreground">
                            {p.photo_count}
                          </span>{" "}
                          {p.photo_count === 1 ? "Photo" : "Photos"}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <FileText className="h-3.5 w-3.5" />
                          <span className="font-semibold text-foreground">
                            {p.report_count}
                          </span>{" "}
                          {p.report_count === 1 ? "Report" : "Reports"}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <ListChecks className="h-3.5 w-3.5" />
                          <span className="font-semibold text-foreground">
                            {clDone}/{clTotal}
                          </span>{" "}
                          items
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <CheckSquare className="h-3.5 w-3.5" />
                          <span className="font-semibold text-foreground">
                            {openTasks.length}
                          </span>{" "}
                          open
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {timeAgo(p.updated_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Checklists + Tasks - always visible */}
                  <div className="grid gap-4 border-t border-border/60 bg-muted/20 p-4 sm:grid-cols-2 sm:p-5">
                    {/* Checklists */}
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <ListChecks className="h-3.5 w-3.5" />
                        Checklists
                        <Badge
                          variant="secondary"
                          className="ml-0.5 h-4 rounded-full px-1.5 text-[10px]"
                        >
                          {checklists.length}
                        </Badge>
                        {clTotal > 0 && (
                          <span className="ml-auto text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                            {clDone}/{clTotal} items
                          </span>
                        )}
                      </div>
                      {checklists.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No checklists on this project.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {checklists.map((c: any) => {
                            const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
                            const complete = c.total > 0 && c.done === c.total;
                            const statusLabel =
                              c.total === 0
                                ? "No items"
                                : complete
                                  ? "Complete"
                                  : c.done === 0
                                    ? "Not started"
                                    : `${c.done}/${c.total} complete`;
                            const expanded = !!expandedChecklists[c.id];
                            const items: Array<{
                              id: string;
                              label: string;
                              completed_at: string | null;
                            }> = c.items ?? [];
                            return (
                              <li
                                key={c.id}
                                className="rounded-md border border-border/50 bg-background"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedChecklists((s) => ({ ...s, [c.id]: !s[c.id] }))
                                  }
                                  className="flex w-full items-center gap-3 p-2.5 text-left text-sm transition hover:bg-muted/40"
                                  disabled={items.length === 0}
                                >
                                  {items.length > 0 ? (
                                    expanded ? (
                                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                    )
                                  ) : complete ? (
                                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                  ) : (
                                    <CircleDot className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate font-medium">{c.name}</div>
                                    <div
                                      className={`truncate text-[11px] ${complete ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                                    >
                                      {statusLabel}
                                    </div>
                                  </div>
                                  <div className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                                    <div
                                      className={`h-full ${complete ? "bg-emerald-500" : "bg-primary"}`}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </button>
                                {expanded && items.length > 0 && (
                                  <ul className="space-y-1 border-t border-border/50 bg-muted/20 p-2">
                                    {items.map((it) => {
                                      const done = !!it.completed_at;
                                      return (
                                        <li
                                          key={it.id}
                                          className="flex items-start gap-2 rounded p-1.5 hover:bg-background"
                                        >
                                          <Checkbox
                                            checked={done}
                                            onCheckedChange={() =>
                                              void toggleChecklistItem(p.id, c.id, it.id, done)
                                            }
                                            className="mt-0.5"
                                          />
                                          <span
                                            className={`flex-1 text-sm ${done ? "text-muted-foreground line-through" : ""}`}
                                          >
                                            {it.label}
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    {/* Tasks */}
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <CheckSquare className="h-3.5 w-3.5" />
                        Tasks
                        <Badge
                          variant="secondary"
                          className="ml-0.5 h-4 rounded-full px-1.5 text-[10px]"
                        >
                          {tasks.length}
                        </Badge>
                        {openTasks.length > 0 && (
                          <span className="ml-auto text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
                            {openTasks.length} open
                          </span>
                        )}
                      </div>
                      {tasks.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No tasks on this project.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {tasks.slice(0, 8).map((t: any) => {
                            const assigned = Boolean(t.assignee_user_id || t.assignee_email);
                            const done = t.status === "done";
                            const inProgress = t.status === "in_progress";
                            const iconCls = done
                              ? "text-emerald-500"
                              : inProgress
                                ? "text-blue-500"
                                : assigned
                                  ? "text-primary"
                                  : "text-muted-foreground";
                            const StatusIcon = done
                              ? CheckCircle2
                              : inProgress
                                ? CircleDot
                                : Circle;
                            const overdue =
                              !done && t.due_date && new Date(t.due_date).getTime() < Date.now();
                            // status value shown in the Select: derive "assigned"/"open" purely from assignee for the OPEN state
                            const currentValue = done
                              ? "done"
                              : inProgress
                                ? "in_progress"
                                : assigned
                                  ? "assigned"
                                  : "open";
                            const isEditing = editingTaskId === t.id;
                            const progress = taskPhotoProgress(
                              t.photo_ids,
                              photoItems.get(t.id) ?? null,
                            );
                            return (
                              <li
                                key={t.id}
                                className="flex items-start gap-2 rounded-md border border-border/50 bg-background p-2.5 text-sm"
                              >
                                <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${iconCls}`} />
                                <div className="min-w-0 flex-1">
                                  {isEditing ? (
                                    <Input
                                      autoFocus
                                      value={editingTaskTitle}
                                      onChange={(e) => setEditingTaskTitle(e.target.value)}
                                      onBlur={() => void saveTaskTitle(p.id, t.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          void saveTaskTitle(p.id, t.id);
                                        }
                                        if (e.key === "Escape") setEditingTaskId(null);
                                      }}
                                      className="h-7 text-sm"
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingTaskId(t.id);
                                        setEditingTaskTitle(t.title);
                                      }}
                                      title="Click to rename"
                                      className={`block w-full truncate text-left font-medium hover:text-primary ${done ? "text-muted-foreground line-through" : ""}`}
                                    >
                                      {t.title}
                                    </button>
                                  )}
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                    <Select
                                      value={currentValue}
                                      onValueChange={(v) => {
                                        // "assigned" and "open" both map to db status "open"; only status changes here
                                        const nextStatus =
                                          v === "done"
                                            ? "done"
                                            : v === "in_progress"
                                              ? "in_progress"
                                              : "open";
                                        void updateTaskStatus(p.id, t.id, nextStatus, t);
                                      }}
                                    >
                                      <SelectTrigger className="h-7 w-[140px] text-[11px]">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="open">Not Assigned</SelectItem>
                                        <SelectItem value="assigned" disabled={!assigned}>
                                          Assigned{assigned ? "" : " (add assignee)"}
                                        </SelectItem>
                                        <SelectItem value="in_progress">In Progress</SelectItem>
                                        <SelectItem value="done">Completed</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    {/* "In Progress" alone cannot say whether
                                        that is one photo of twelve or eleven. */}
                                    {progress.total > 0 && (
                                      <span
                                        className="inline-flex items-center gap-1.5 tabular-nums"
                                        title={progress.label}
                                      >
                                        <ImageIcon className="h-3 w-3" />
                                        {progress.shortLabel}
                                        <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
                                          <span
                                            className="block h-full rounded-full bg-emerald-500"
                                            style={{ width: `${progress.percent}%` }}
                                          />
                                        </span>
                                      </span>
                                    )}
                                    {t.assignee_email && (
                                      <span className="truncate">{t.assignee_email}</span>
                                    )}
                                    {t.due_date && (
                                      <span
                                        className={`inline-flex items-center gap-1 tabular-nums ${overdue ? "font-semibold text-destructive" : ""}`}
                                      >
                                        {overdue && <AlertCircle className="h-3 w-3" />}
                                        {new Date(t.due_date).toLocaleDateString(undefined, {
                                          month: "short",
                                          day: "numeric",
                                        })}
                                      </span>
                                    )}
                                    <Link
                                      to="/projects/$projectId"
                                      params={{ projectId: p.id }}
                                      className="ml-auto text-[11px] text-primary hover:underline"
                                    >
                                      Open
                                    </Link>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                          {tasks.length > 8 && (
                            <li>
                              <Link
                                to="/projects/$projectId"
                                params={{ projectId: p.id }}
                                className="block rounded-md border border-dashed border-border/60 p-2 text-center text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              >
                                View all {tasks.length} tasks
                              </Link>
                            </li>
                          )}
                        </ul>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Group</DialogTitle>
            <DialogDescription>Update the group name and description.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rename-name">Name</Label>
              <Input
                id="rename-name"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rename-desc">Description</Label>
              <Input
                id="rename-desc"
                value={descriptionValue}
                onChange={(e) => setDescriptionValue(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitRename} disabled={saving || !renameValue.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this group?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the group and its membership records. The underlying projects are not
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={submitDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit projects dialog */}
      <EditGroupProjectsDialog
        open={editProjectsOpen}
        onOpenChange={setEditProjectsOpen}
        groupId={groupId}
        projects={allProjects}
        initialSelectedIds={memberIds}
        onSaved={load}
      />
    </div>
  );
}
