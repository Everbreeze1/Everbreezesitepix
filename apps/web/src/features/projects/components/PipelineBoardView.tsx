import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import {
  Plus,
  Settings2,
  MapPin,
  Clock,
  FileText,
  Image as ImageIcon,
  Search,
  MoreVertical,
  Inbox,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  CircleSlash,
  Users as UsersIcon,
} from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AddProjectToStageDialog } from "@/features/projects/components/AddProjectToStageDialog";
import { AssignTeammatesDialog } from "@/features/projects/components/AssignTeammatesDialog";
import { ProjectCrew } from "@/features/projects/components/ProjectCrew";
import { useProjectAssignees } from "@/hooks/use-project-assignees";
import { useEdgeScroll } from "@/hooks/use-edge-scroll";
import {
  setProjectPipelineStage,
  type PipelineStage,
  type ProjectBoard,
} from "@/lib/project-boards.functions";

interface ProjectRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  street: string | null;
  location: string | null;
  updated_at: string;
  created_at: string;
  /** The single-select pipeline field. NULL means the project is in no pipeline. */
  pipeline_stage_id?: string | null;
}

/**
 * The unassigned rail's droppable id.
 *
 * Not a stage, and deliberately not stored as one: dropping here writes NULL.
 * A sentinel keeps that single case out of the stage list, rather than every
 * board carrying a "none" row it then has to hide.
 */
const UNASSIGNED = "__unassigned__";

function projectAddress(p: ProjectRow): string | null {
  if (p.location?.trim()) return p.location;
  const parts = [p.street, p.city, p.state].filter((x): x is string => !!x && x.trim().length > 0);
  return parts.length ? parts.join(", ") : null;
}

function matchesQuery(p: ProjectRow, q: string): boolean {
  if (!q) return true;
  const addr = [p.location, p.street, p.city, p.state].filter(Boolean).join(" ").toLowerCase();
  return p.name.toLowerCase().includes(q) || addr.includes(q);
}

/**
 * Readable text colour for a coloured chip - stage colours span light yellows to
 * dark navies. Picks whichever of black/white has the higher WCAG contrast
 * ratio against the chip, rather than thresholding a perceived-brightness
 * approximation: the old 0.6 cutoff put white text on mid-tone chips, where
 * black is markedly more legible.
 */
function chipTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  // Contrast vs white is 1.05/(L+0.05); vs black it's (L+0.05)/0.05.
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? "#111827" : "#ffffff";
}

/** Cards settle into place instead of teleporting, and the source card fades back in on cancel. */
const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.35" } } }),
};

/**
 * A pipeline board: one column per stage, one card per project, and every card
 * in exactly one column.
 *
 * That last part is the whole change from the tag boards this replaces. A
 * column is `board.stages[n]`, a card's column is `project.pipeline_stage_id`,
 * and a drag writes that one field. There is no arrangement of tags that can
 * put the same job in two columns, because no tag is consulted here at all.
 *
 * Three things the tag boards could not offer, which single-select makes
 * possible and which this layout is built around:
 *
 *   The unassigned rail. "Which jobs are not on the board yet" became a
 *   question with an answer (`pipeline_stage_id IS NULL`), so it is a column
 *   you can drag out of, and dragging back into it is how a job leaves the
 *   pipeline. Under tags there was no such question: a project not carrying any
 *   of the board's tags was indistinguishable from one that had nothing to do
 *   with the board.
 *
 *   Search across the board. Hiding cards is safe when a card has one home, and
 *   it is what keeps a forty-job pipeline usable.
 *
 *   A move menu on the card. Dragging is the gesture, but it is not the only
 *   one that should work: keyboard-only, one-handed on a phone, or into a
 *   column that is currently off-screen. One move is one field, so a menu item
 *   does exactly what the drag does.
 */
export function PipelineBoardView({
  board,
  allProjects,
  coverUrls = {},
  photoCounts = {},
  reportCounts = {},
  onManage,
  onStageChanged,
}: {
  board: ProjectBoard;
  allProjects: ProjectRow[];
  /** At-a-glance card signals, already loaded by the projects page. */
  coverUrls?: Record<string, string>;
  photoCounts?: Record<string, number>;
  reportCounts?: Record<string, number>;
  onManage: () => void;
  /** Optimistic local move. Called again with the old stage id if the write fails. */
  onStageChanged: (projectId: string, stageId: string | null) => void;
}) {
  const [addingToStage, setAddingToStage] = useState<PipelineStage | null>(null);
  const [assignFor, setAssignFor] = useState<ProjectRow | null>(null);
  /*
   * The crew on every card of the board, in one request.
   *
   * A pipeline is where staffing actually gets decided - you move a job into
   * Scheduled and the next question is who is doing it - so the board carries
   * the same crew stack and the same Assign action as the card grid. Read here
   * rather than passed down from the projects page: the two views are never
   * mounted at once, so nothing is fetched twice.
   */
  const { byProject: crewByProject, canAssign } = useProjectAssignees(
    useMemo(() => allProjects.slice(0, 200).map((p) => p.id), [allProjects]),
  );
  const [active, setActive] = useState<{ project: ProjectRow; fromStageId: string } | null>(null);
  const [query, setQuery] = useState("");
  const [showUnassigned, setShowUnassigned] = useState(true);
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

  const stages = useMemo(
    () => [...board.stages].sort((a, b) => a.position - b.position),
    [board.stages],
  );
  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const q = query.trim().toLowerCase();

  const columns = useMemo(
    () =>
      stages.map((stage) => {
        const all = allProjects.filter((p) => p.pipeline_stage_id === stage.id);
        return { stage, projects: all.filter((p) => matchesQuery(p, q)), total: all.length };
      }),
    [stages, allProjects, q],
  );

  const unassignedAll = useMemo(
    () => allProjects.filter((p) => !p.pipeline_stage_id),
    [allProjects],
  );
  const unassigned = useMemo(
    () => unassignedAll.filter((p) => matchesQuery(p, q)),
    [unassignedAll, q],
  );

  const placedTotal = columns.reduce((n, c) => n + c.total, 0);
  const shownTotal = columns.reduce((n, c) => n + c.projects.length, 0);

  /*
   * The columns scroll sideways, and now they say so at the top instead of
   * along the bottom.
   *
   * The client, after using the board: "i can move it from side to side with a
   * bar at the bottom but these bars will eventually need to go away and have a
   * cleaner look, there should be an arrow or something on top to move from
   * side to side for each Pipeline Created."
   *
   * This strip was the last horizontal scroller in the app still showing a
   * native scrollbar - the pipeline tabs, the photo carousel and the page tab
   * strips all hide theirs. Hiding it is only half the job: the hook that gives
   * the pipeline tabs their arrows gives these columns arrows and edge fades
   * too, so nothing goes off-screen without a way back to it.
   */
  const {
    ref: strip,
    overflow: stripEdge,
    nudge,
  } = useEdgeScroll<HTMLDivElement>([columns.length, showUnassigned, unassignedAll.length]);

  /**
   * One click moves whole columns, never a fraction of one, and stops a column
   * short of a full screenful so something you were looking at stays in view.
   */
  function columnStep(): number | undefined {
    const el = strip.current;
    const column = el?.querySelector<HTMLElement>("[data-pipeline-column]");
    if (!el || !column) return undefined;
    const stride = column.offsetWidth + 16; // gap-4
    return stride * Math.max(1, Math.floor(el.clientWidth / stride) - 1);
  }

  function labelFor(id: string): string {
    if (id === UNASSIGNED) return "Not in a pipeline";
    return stageById.get(id)?.name ?? "stage";
  }

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${a.data.current?.projectName}.`,
    onDragOver: ({ over }) => (over ? `Over ${labelFor(String(over.id))}.` : "No stage."),
    onDragEnd: ({ over }) => (over ? `Moved to ${labelFor(String(over.id))}.` : "Move cancelled."),
    onDragCancel: () => "Move cancelled.",
  };

  function handleDragStart(e: DragStartEvent) {
    const projectId = e.active.data.current?.projectId as string | undefined;
    const fromStageId = e.active.data.current?.fromStageId as string | undefined;
    const project = allProjects.find((p) => p.id === projectId);
    if (project && fromStageId) setActive({ project, fromStageId });
    suppressClick.current = true;
  }

  function endDrag() {
    setActive(null);
    // Released after the trailing click has been dispatched.
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  }

  /**
   * The one write on this screen. `null` is the unassigned rail.
   *
   * Optimistic, and its own undo: on failure the local row goes back where it
   * came from, so a card never sits in a column the database disagrees with.
   */
  async function move(projectId: string, fromStageId: string | null, toStageId: string | null) {
    if (fromStageId === toStageId) return;
    onStageChanged(projectId, toStageId);
    try {
      await setProjectPipelineStage({ data: { projectId, stageId: toStageId } });
    } catch (err: any) {
      toast.error(err?.message ?? "Could not move project");
      onStageChanged(projectId, fromStageId);
    }
  }

  async function handleDragEnd(e: DragEndEvent) {
    const projectId = e.active.data.current?.projectId as string | undefined;
    const fromStageId = e.active.data.current?.fromStageId as string | undefined;
    const overId = e.over?.id ? String(e.over.id) : undefined;
    endDrag();
    if (!projectId || !fromStageId || !overId) return;
    if (overId !== UNASSIGNED && !stageById.has(overId)) return;
    await move(
      projectId,
      fromStageId === UNASSIGNED ? null : fromStageId,
      overId === UNASSIGNED ? null : overId,
    );
  }

  if (stages.length === 0) {
    return (
      <div className="mt-8 text-center">
        <p className="text-sm text-muted-foreground">This pipeline has no stages yet.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onManage}>
          <Settings2 className="mr-1.5 h-4 w-4" /> Manage Pipeline
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/*
        The board's own toolbar. Search lives here rather than in the page
        header because it narrows the cards in these columns, and the page
        header's search narrows the project list, which is a different list.
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a job on this board…"
            aria-label="Search this pipeline"
            className="h-9 pl-8"
          />
        </div>

        <p className="text-xs font-semibold text-muted-foreground">
          {q ? `${shownTotal} of ${placedTotal} shown` : `${placedTotal} in this pipeline`}
        </p>

        <div className="ml-auto flex items-center gap-2">
          {unassignedAll.length > 0 && (
            <Button
              variant={showUnassigned ? "secondary" : "outline"}
              size="sm"
              className="h-9 text-xs"
              onClick={() => setShowUnassigned((v) => !v)}
              aria-pressed={showUnassigned}
            >
              {/*
                Panel icons, not chevrons: the two scroll arrows now sit beside
                this button, and a third and fourth chevron pointing the same
                way would read as more of the same control.
              */}
              {showUnassigned ? (
                <PanelLeftClose className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <PanelLeftOpen className="mr-1.5 h-3.5 w-3.5" />
              )}
              {unassignedAll.length} not in a pipeline
            </Button>
          )}

          {/*
            Only when there is something off-screen: a board whose stages all
            fit needs no control for scrolling it. Once shown, each arrow stays
            put and greys out at its end of the run, so the toolbar does not
            reshuffle itself under the cursor halfway across the board.
          */}
          {(stripEdge.left || stripEdge.right) && (
            <div className="flex items-center gap-1" role="group" aria-label="Scroll stages">
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                disabled={!stripEdge.left}
                onClick={() => nudge(-1, columnStep())}
                aria-label="Scroll stages left"
                title="Scroll stages left"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9"
                disabled={!stripEdge.right}
                onClick={() => nudge(1, columnStep())}
                aria-label="Scroll stages right"
                title="Scroll stages right"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

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
        <div className="relative">
          {/* No scroll-smooth class here on purpose: dnd-kit's auto-scroll writes
            scrollLeft every frame while a card is held near the edge, and a CSS
            smooth behaviour animates each of those writes into a crawl. The
            arrows ask for smooth scrolling themselves instead. */}
          <div
            ref={strip}
            className="flex snap-x gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {showUnassigned && unassignedAll.length > 0 && (
              <BoardColumn
                columnId={UNASSIGNED}
                title="Not in a pipeline"
                projects={unassigned}
                total={unassignedAll.length}
                filtered={!!q}
                active={active}
                suppressClick={suppressClick}
                coverUrls={coverUrls}
                photoCounts={photoCounts}
                reportCounts={reportCounts}
                stages={stages}
                onMove={move}
                crewByProject={crewByProject}
                canAssign={canAssign}
                onAssign={setAssignFor}
                emptyLabel="Every project is on a board."
              />
            )}

            {columns.map(({ stage, projects, total }) => (
              <BoardColumn
                key={stage.id}
                columnId={stage.id}
                title={stage.name}
                color={stage.color}
                projects={projects}
                total={total}
                filtered={!!q}
                onAdd={() => setAddingToStage(stage)}
                active={active}
                suppressClick={suppressClick}
                coverUrls={coverUrls}
                photoCounts={photoCounts}
                reportCounts={reportCounts}
                stages={stages}
                onMove={move}
                crewByProject={crewByProject}
                canAssign={canAssign}
                onAssign={setAssignFor}
                emptyLabel="No projects at this stage."
              />
            ))}
          </div>

          {/*
            A column cut off by a hard edge reads as the last one. Under a fade
            it reads as "there is more", which is what makes the arrow beside it
            worth pressing.
          */}
          {stripEdge.left && (
            <span className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent" />
          )}
          {stripEdge.right && (
            <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
          )}
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
                  <p className="truncate text-sm font-bold text-foreground">
                    {active.project.name}
                  </p>
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

      {addingToStage && (
        <AddProjectToStageDialog
          open={!!addingToStage}
          stage={addingToStage}
          /*
            Everything that is not already in this column, including projects
            sitting in another stage. Moving one here is the same single write
            as dragging it, so the picker says where it is coming from rather
            than hiding it.
          */
          projects={allProjects
            .filter((p) => p.pipeline_stage_id !== addingToStage.id)
            .map((p) => ({
              ...p,
              currentStageName: p.pipeline_stage_id
                ? (stageById.get(p.pipeline_stage_id)?.name ?? null)
                : null,
            }))}
          onClose={() => setAddingToStage(null)}
          onMoved={(projectId) => onStageChanged(projectId, addingToStage.id)}
          onFailed={(projectId, previousStageId) => onStageChanged(projectId, previousStageId)}
        />
      )}

      {/* One dialog for the whole board, opened with whichever card was picked. */}
      {assignFor && (
        <AssignTeammatesDialog
          projectId={assignFor.id}
          projectName={assignFor.name}
          open
          onOpenChange={(o) => !o && setAssignFor(null)}
        />
      )}
    </div>
  );
}

function BoardColumn({
  columnId,
  title,
  color,
  projects,
  total,
  filtered,
  onAdd,
  active,
  suppressClick,
  coverUrls,
  photoCounts,
  reportCounts,
  stages,
  onMove,
  crewByProject,
  canAssign,
  onAssign,
  emptyLabel,
}: {
  columnId: string;
  title: string;
  /** Absent on the unassigned rail, which is deliberately not a stage. */
  color?: string;
  projects: ProjectRow[];
  total: number;
  filtered: boolean;
  onAdd?: () => void;
  active: { project: ProjectRow; fromStageId: string } | null;
  suppressClick: React.MutableRefObject<boolean>;
  coverUrls: Record<string, string>;
  photoCounts: Record<string, number>;
  reportCounts: Record<string, number>;
  stages: PipelineStage[];
  onMove: (projectId: string, from: string | null, to: string | null) => void;
  /** Crew for every project on the board, resolved once by the view. */
  crewByProject: Record<string, string[]>;
  canAssign: boolean;
  onAssign: (project: ProjectRow) => void;
  emptyLabel: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });
  const isSource = active?.fromStageId === columnId;
  // Only a move into a *different* column is meaningful.
  const willAccept = !!active && !isSource;
  const isRail = columnId === UNASSIGNED;

  return (
    // data-pipeline-column is what the toolbar arrows measure, so a click moves
    // by whole columns rather than a guessed number of pixels.
    <div data-pipeline-column className="flex w-[280px] shrink-0 snap-start flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {isRail ? (
            <span
              className="inline-flex max-w-[190px] items-center gap-1.5 truncate rounded-full border border-dashed border-border px-3 py-1.5 text-sm font-extrabold tracking-tight text-muted-foreground"
              title={title}
            >
              <Inbox className="h-3.5 w-3.5 shrink-0" />
              {title}
            </span>
          ) : (
            <span
              className="inline-flex max-w-[190px] items-center truncate rounded-full px-3.5 py-1.5 text-sm font-extrabold tracking-tight shadow-sm"
              style={{ background: color, color: chipTextColor(color ?? "#64748b") }}
              title={title}
            >
              {title}
            </span>
          )}
          <span className="shrink-0 text-sm font-extrabold text-muted-foreground">
            {filtered && projects.length !== total ? `${projects.length}/${total}` : total}
          </span>
        </div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Add project to ${title}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>

      {/*
        The column body scrolls; the header does not.

        Without the cap, one stage holding forty jobs made the whole page that
        tall and pushed every other column's header off-screen. The board
        stopped reading as a board at exactly the point it had enough work on it
        to be worth looking at.
      */}
      <div
        ref={setNodeRef}
        className={cn(
          "mt-3 max-h-[min(70vh,640px)] min-h-[220px] flex-1 space-y-2 overflow-y-auto rounded-xl border-2 border-dashed p-2 transition-colors duration-150",
          isOver && willAccept
            ? "border-primary bg-primary/10"
            : willAccept
              ? "border-border bg-muted/60"
              : "border-transparent bg-muted/40",
        )}
      >
        {projects.length === 0 && !(isOver && willAccept) ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {willAccept
              ? isRail
                ? "Drop here to take it out of the pipeline"
                : "Drop here to move"
              : filtered && total > 0
                ? "Nothing here matches your search."
                : emptyLabel}
          </p>
        ) : (
          projects.map((p) => (
            <BoardCard
              key={p.id}
              project={p}
              columnId={columnId}
              color={color}
              suppressClick={suppressClick}
              coverUrl={coverUrls[p.id]}
              photoCount={photoCounts[p.id] ?? 0}
              reportCount={reportCounts[p.id] ?? 0}
              stages={stages}
              onMove={onMove}
              crew={crewByProject[p.id] ?? []}
              canAssign={canAssign}
              onAssign={onAssign}
            />
          ))
        )}

        {/* Shows exactly where the card will land. */}
        {isOver && willAccept && (
          <div className="rounded-lg border-2 border-dashed border-primary/70 bg-primary/5 p-3">
            <p className="truncate text-sm font-bold text-primary">{active!.project.name}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-primary/70">
              {isRail ? "Release to take it out of the pipeline" : "Release to move here"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BoardCard({
  project,
  columnId,
  color,
  suppressClick,
  coverUrl,
  photoCount,
  reportCount,
  stages,
  onMove,
  crew,
  canAssign,
  onAssign,
}: {
  project: ProjectRow;
  columnId: string;
  color?: string;
  suppressClick: React.MutableRefObject<boolean>;
  coverUrl?: string;
  photoCount: number;
  reportCount: number;
  stages: PipelineStage[];
  onMove: (projectId: string, from: string | null, to: string | null) => void;
  /** User ids staffed on this job. */
  crew: string[];
  canAssign: boolean;
  onAssign: (project: ProjectRow) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
    data: { projectId: project.id, fromStageId: columnId, projectName: project.name },
  });
  const addr = projectAddress(project);
  // Days since last touch drives a colour cue - a board should surface what's
  // gone quiet without the reader having to parse every timestamp.
  const daysStale = Math.floor((Date.now() - new Date(project.updated_at).getTime()) / 86_400_000);
  const from = columnId === UNASSIGNED ? null : columnId;

  return (
    // The whole card is the drag target - no hunting for a small handle, and it
    // works identically under touch. `attributes` also makes it keyboard-draggable.
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      aria-label={`${project.name}. Press space to move between stages.`}
      className={cn(
        // No `touch-action: none` here - TouchSensor's press-and-hold delay does
        // the disambiguation, so a plain swipe over a card still scrolls.
        "group relative rounded-lg border border-border bg-card shadow-sm transition-shadow",
        "cursor-grab hover:border-primary/40 hover:shadow-md active:cursor-grabbing",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isDragging && "opacity-35",
      )}
      // A 3px edge in the column's own colour, so a card scrolled away from its
      // header still says which column it belongs to.
      style={color ? { borderLeft: `3px solid ${color}` } : undefined}
    >
      {/*
        The move menu is what makes a stage change reachable without a drag: by
        keyboard, one-handed on a phone, or into a column that is currently
        off-screen. Stopping pointer events here keeps opening the menu from
        being read as the start of a drag.
      */}
      <div
        className="absolute right-1 top-1 z-[1]"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Move ${project.name} to another stage`}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-card/80 text-muted-foreground opacity-0 backdrop-blur transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Move to stage
            </DropdownMenuLabel>
            {stages.map((s) => (
              <DropdownMenuItem
                key={s.id}
                disabled={s.id === columnId}
                onClick={() => onMove(project.id, from, s.id)}
              >
                <span
                  className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="truncate">{s.name}</span>
                {s.id === columnId && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={columnId === UNASSIGNED}
              onClick={() => onMove(project.id, from, null)}
            >
              <CircleSlash className="mr-2 h-3.5 w-3.5" />
              Take out of the pipeline
            </DropdownMenuItem>
            {/*
              Staffing, on the board where staffing is decided. Same dialog and
              same rows as the card grid and the project page.
            */}
            {canAssign && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAssign(project)}>
                  <UsersIcon className="mr-2 h-3.5 w-3.5" />
                  {crew.length === 0 ? "Assign teammates" : `Change crew (${crew.length})`}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/projects/$projectId" params={{ projectId: project.id }} search={{} as any}>
                Open project
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
        className="block"
      >
        {coverUrl && (
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            draggable={false}
            className="h-24 w-full rounded-t-lg object-cover"
          />
        )}
        <div className="p-3">
          <p className="truncate pr-7 text-sm font-bold text-foreground">{project.name}</p>
          {addr && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{addr}</span>
            </p>
          )}

          <div className="mt-2 flex items-center gap-3 text-[11px] font-semibold text-muted-foreground">
            {photoCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> {photoCount}
              </span>
            )}
            {reportCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3" /> {reportCount}
              </span>
            )}
            {/*
              Display only, and deliberately so: the card is a drag handle, and an
              interactive chip inside it competes with the gesture that moves the
              job between stages. Changing the crew is one tap away in the card
              menu, where every other action on this card already lives.
            */}
            <ProjectCrew userIds={crew} canAssign={false} onAssign={() => {}} max={3} />
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1",
                daysStale >= 30
                  ? "text-destructive"
                  : daysStale >= 14
                    ? "text-amber-600 dark:text-amber-500"
                    : "text-muted-foreground",
              )}
              title={`Last updated ${formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}`}
            >
              <Clock className="h-3 w-3" />
              {formatDistanceToNow(new Date(project.updated_at))}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
