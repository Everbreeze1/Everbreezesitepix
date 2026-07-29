import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Settings2, ChevronRight, GripVertical } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AddProjectToTagDialog } from "@/features/projects/components/AddProjectToTagDialog";
import type { ProjectBoard } from "@/lib/project-boards.functions";

interface ProjectRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  street: string | null;
  location: string | null;
  updated_at: string;
  created_at: string;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
}

function projectAddress(p: ProjectRow): string | null {
  if (p.location?.trim()) return p.location;
  const parts = [p.street, p.city, p.state].filter((x): x is string => !!x && x.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

/** Readable text colour for a coloured chip — tag colours span light yellows to dark navies. */
function chipTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Relative luminance (sRGB approximation) — light chips need dark text.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#111827" : "#ffffff";
}

export function TagBoardDetailView({
  board,
  allTags,
  allProjects,
  projectTagMap,
  onManage,
  onTagAssigned,
  onTagMoved,
}: {
  board: ProjectBoard;
  allTags: TagRow[];
  allProjects: ProjectRow[];
  projectTagMap: Record<string, TagRow[]>;
  onManage: () => void;
  onTagAssigned: (projectId: string, tag: TagRow) => void;
  onTagMoved: (projectId: string, fromTagId: string, toTag: TagRow) => void;
}) {
  const { user } = useAuth();
  const [addingToTag, setAddingToTag] = useState<TagRow | null>(null);
  const [draggingProject, setDraggingProject] = useState<ProjectRow | null>(null);

  // A small drag threshold keeps card clicks (navigate to project) working normally.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const columns = useMemo(
    () =>
      board.tag_ids
        .map((tid) => allTags.find((t) => t.id === tid))
        .filter((t): t is TagRow => !!t)
        .map((tag) => ({
          tag,
          projects: allProjects.filter((p) => (projectTagMap[p.id] ?? []).some((t) => t.id === tag.id)),
        })),
    [board.tag_ids, allTags, allProjects, projectTagMap],
  );

  const alreadyTaggedIds = addingToTag
    ? new Set(
        allProjects
          .filter((p) => (projectTagMap[p.id] ?? []).some((t) => t.id === addingToTag.id))
          .map((p) => p.id),
      )
    : new Set<string>();

  function handleDragStart(e: DragStartEvent) {
    const p = allProjects.find((x) => x.id === e.active.data.current?.projectId);
    setDraggingProject(p ?? null);
  }

  async function handleDragEnd(e: DragEndEvent) {
    setDraggingProject(null);
    const projectId = e.active.data.current?.projectId as string | undefined;
    const fromTagId = e.active.data.current?.fromTagId as string | undefined;
    const toTagId = e.over?.id ? String(e.over.id) : undefined;
    if (!projectId || !fromTagId || !toTagId || fromTagId === toTagId) return;

    const toTag = allTags.find((t) => t.id === toTagId);
    if (!toTag) return;

    // Optimistic — the board re-renders from projectTagMap immediately.
    onTagMoved(projectId, fromTagId, toTag);

    try {
      const { error: insErr } = await (supabase as any)
        .from("project_tags")
        .upsert(
          { project_id: projectId, tag_id: toTagId, created_by: user?.id },
          { onConflict: "project_id,tag_id", ignoreDuplicates: true },
        );
      if (insErr) throw insErr;
      const { error: delErr } = await (supabase as any)
        .from("project_tags")
        .delete()
        .eq("project_id", projectId)
        .eq("tag_id", fromTagId);
      if (delErr) throw delErr;
    } catch (err: any) {
      toast.error(err?.message ?? "Could not move project");
      // Put it back where it came from.
      const fromTag = allTags.find((t) => t.id === fromTagId);
      if (fromTag) onTagMoved(projectId, toTagId, fromTag);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-xl font-extrabold tracking-tight text-foreground">{board.name}</h2>
          <span className="text-xs font-semibold text-muted-foreground">
            {columns.length} column{columns.length === 1 ? "" : "s"}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={onManage}>
          <Settings2 className="mr-1.5 h-4 w-4" /> Manage Board
        </Button>
      </div>

      {columns.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          This board has no columns yet — use "Manage Board" to add some tags.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggingProject(null)}
        >
          <div className="mt-5 flex gap-4 overflow-x-auto pb-4">
            {columns.map(({ tag, projects }) => (
              <BoardColumn
                key={tag.id}
                tag={tag}
                projects={projects}
                onAdd={() => setAddingToTag(tag)}
                isDragging={!!draggingProject}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={null}>
            {draggingProject ? (
              <div className="w-[264px] rotate-2 rounded-lg border border-primary/50 bg-card p-3 shadow-lg">
                <p className="truncate text-sm font-bold text-foreground">{draggingProject.name}</p>
                {projectAddress(draggingProject) && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {projectAddress(draggingProject)}
                  </p>
                )}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {addingToTag && (
        <AddProjectToTagDialog
          open={!!addingToTag}
          tag={addingToTag}
          projects={allProjects.filter((p) => !alreadyTaggedIds.has(p.id))}
          onClose={() => setAddingToTag(null)}
          onAdded={(projectId) => {
            onTagAssigned(projectId, addingToTag);
            setAddingToTag(null);
          }}
        />
      )}
    </div>
  );
}

function BoardColumn({
  tag,
  projects,
  onAdd,
  isDragging,
}: {
  tag: TagRow;
  projects: ProjectRow[];
  onAdd: () => void;
  isDragging: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: tag.id });

  return (
    <div className="flex w-[280px] shrink-0 flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex max-w-[180px] items-center truncate rounded-full px-2.5 py-1 text-xs font-bold shadow-sm"
            style={{ background: tag.color, color: chipTextColor(tag.color) }}
          >
            {tag.name}
          </span>
          <span className="shrink-0 text-xs font-bold text-muted-foreground">{projects.length}</span>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Add project to ${tag.name}`}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "mt-3 min-h-[160px] flex-1 space-y-2 rounded-xl border-2 border-dashed p-2 transition-colors",
          isOver ? "border-primary/60 bg-primary/5" : "border-transparent bg-muted/40",
          isDragging && !isOver && "border-border/60",
        )}
      >
        {projects.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {isDragging ? "Drop here to move" : "Projects with this tag will appear here."}
          </p>
        ) : (
          projects.map((p) => <BoardCard key={p.id} project={p} tagId={tag.id} />)
        )}
      </div>
    </div>
  );
}

function BoardCard({ project, tagId }: { project: ProjectRow; tagId: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${tagId}:${project.id}`,
    data: { projectId: project.id, fromTagId: tagId },
  });
  const addr = projectAddress(project);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group relative rounded-lg border border-border bg-card transition-opacity hover:border-primary/40",
        isDragging && "opacity-40",
      )}
    >
      {/* Drag handle is separate from the link so clicking the card still opens the project. */}
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Move ${project.name}`}
        className="absolute right-1 top-1 cursor-grab rounded p-1 text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        search={{} as any}
        className="block p-3"
      >
        <p className="text-[10px] text-muted-foreground">
          {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}
        </p>
        <p className="mt-1 flex items-center justify-between gap-1 truncate pr-5 text-sm font-bold text-foreground">
          {project.name}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </p>
        {addr && <p className="mt-0.5 truncate text-xs text-muted-foreground">{addr}</p>}
      </Link>
    </div>
  );
}
