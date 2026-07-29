import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { Plus, Settings2 } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  defaultDropAnimationSideEffects,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
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
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#111827" : "#ffffff";
}

const CARD_SEP = "::";
const cardId = (tagId: string, projectId: string) => `${tagId}${CARD_SEP}${projectId}`;

/** Cards settle into place instead of teleporting, and the source card fades back in on cancel. */
const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.35" } } }),
};

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
  const [active, setActive] = useState<{ project: ProjectRow; fromTagId: string } | null>(null);
  // A real drag ends with a click event on the card; swallow that one click so
  // dropping a card doesn't also navigate into the project.
  const suppressClick = useRef(false);

  // MouseSensor + TouchSensor rather than PointerSensor: PointerSensor also
  // claims touch events, which would double-handle taps on mobile and force
  // `touch-action: none` on cards (killing page scroll). Split sensors let each
  // input use the right activation rule.
  const sensors = useSensors(
    // Mouse: a short movement threshold means plain clicks still open the project.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Touch: press-and-hold to lift, so a normal swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

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

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${a.data.current?.projectName}.`,
    onDragOver: ({ over }) =>
      over ? `Over ${allTags.find((t) => t.id === over.id)?.name ?? "column"}.` : "No column.",
    onDragEnd: ({ over }) =>
      over
        ? `Moved to ${allTags.find((t) => t.id === over.id)?.name ?? "column"}.`
        : "Move cancelled.",
    onDragCancel: () => "Move cancelled.",
  };

  function handleDragStart(e: DragStartEvent) {
    const projectId = e.active.data.current?.projectId as string | undefined;
    const fromTagId = e.active.data.current?.fromTagId as string | undefined;
    const project = allProjects.find((p) => p.id === projectId);
    if (project && fromTagId) setActive({ project, fromTagId });
    suppressClick.current = true;
  }

  function endDrag() {
    setActive(null);
    // Released after the trailing click has been dispatched.
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const projectId = e.active.data.current?.projectId as string | undefined;
    const fromTagId = e.active.data.current?.fromTagId as string | undefined;
    const toTagId = e.over?.id ? String(e.over.id) : undefined;
    endDrag();
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
          collisionDetection={pointerWithin}
          accessibility={{ announcements }}
          // Pulls the horizontal column strip along when dragging near its edges,
          // so off-screen columns are reachable.
          autoScroll={{ threshold: { x: 0.2, y: 0.15 } }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={endDrag}
        >
          <div className="mt-5 flex snap-x gap-4 overflow-x-auto pb-4">
            {columns.map(({ tag, projects }) => (
              <BoardColumn
                key={tag.id}
                tag={tag}
                projects={projects}
                onAdd={() => setAddingToTag(tag)}
                active={active}
                suppressClick={suppressClick}
              />
            ))}
          </div>

          {/*
            Portalled to <body>: DragOverlay is `position: fixed`, and this page
            is wrapped in a pull-to-refresh `transform` container. A transformed
            ancestor becomes the containing block for fixed descendants, which
            offsets the overlay from the cursor. Escaping to body restores
            viewport-relative positioning.
          */}
          {typeof document !== "undefined" &&
            createPortal(
              <DragOverlay dropAnimation={dropAnimation}>
                {active ? (
                  <div className="w-[264px] rotate-2 cursor-grabbing rounded-lg border border-primary/60 bg-card p-3 shadow-2xl ring-2 ring-primary/20">
                    <p className="truncate text-sm font-bold text-foreground">{active.project.name}</p>
                    {projectAddress(active.project) && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {projectAddress(active.project)}
                      </p>
                    )}
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
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
  active,
  suppressClick,
}: {
  tag: TagRow;
  projects: ProjectRow[];
  onAdd: () => void;
  active: { project: ProjectRow; fromTagId: string } | null;
  suppressClick: React.MutableRefObject<boolean>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: tag.id });
  const isSource = active?.fromTagId === tag.id;
  // Only a move into a *different* column is meaningful.
  const willAccept = !!active && !isSource;

  return (
    <div className="flex w-[280px] shrink-0 snap-start flex-col">
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
          "mt-3 min-h-[220px] flex-1 space-y-2 rounded-xl border-2 border-dashed p-2 transition-colors duration-150",
          isOver && willAccept
            ? "border-primary bg-primary/10"
            : willAccept
              ? "border-border bg-muted/60"
              : "border-transparent bg-muted/40",
        )}
      >
        {projects.length === 0 && !(isOver && willAccept) ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {willAccept ? "Drop here to move" : "Projects with this tag will appear here."}
          </p>
        ) : (
          projects.map((p) => (
            <BoardCard key={p.id} project={p} tagId={tag.id} suppressClick={suppressClick} />
          ))
        )}

        {/* Shows exactly where the card will land. */}
        {isOver && willAccept && (
          <div className="rounded-lg border-2 border-dashed border-primary/70 bg-primary/5 p-3">
            <p className="truncate text-sm font-bold text-primary">{active!.project.name}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-primary/70">Release to move here</p>
          </div>
        )}
      </div>
    </div>
  );
}

function BoardCard({
  project,
  tagId,
  suppressClick,
}: {
  project: ProjectRow;
  tagId: string;
  suppressClick: React.MutableRefObject<boolean>;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: cardId(tagId, project.id),
    data: { projectId: project.id, fromTagId: tagId, projectName: project.name },
  });
  const addr = projectAddress(project);

  return (
    // The whole card is the drag target — no hunting for a small handle, and it
    // works identically under touch. `attributes` also makes it keyboard-draggable.
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-label={`${project.name}. Press space to move between columns.`}
      className={cn(
        // No `touch-action: none` here — TouchSensor's press-and-hold delay does
        // the disambiguation, so a plain swipe over a card still scrolls.
        "group relative rounded-lg border border-border bg-card shadow-sm transition-shadow",
        "cursor-grab hover:border-primary/40 hover:shadow-md active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isDragging && "opacity-35",
      )}
    >
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        search={{} as any}
        draggable={false}
        onClick={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className="block p-3"
      >
        <p className="text-[10px] text-muted-foreground">
          {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}
        </p>
        <p className="mt-1 truncate text-sm font-bold text-foreground">{project.name}</p>
        {addr && <p className="mt-0.5 truncate text-xs text-muted-foreground">{addr}</p>}
      </Link>
    </div>
  );
}
