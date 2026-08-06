import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Layers,
  Loader2,
  Plus,
  Trash2,
  ExternalLink,
  MoreVertical,
  Share2,
  Sparkles,
  Star,
  MapPin,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/sitepix/client";
import {
  listShowcases,
  createShowcase,
  createShowcaseFromProject,
  deleteShowcase,
  type ShowcaseSummary,
} from "@/lib/showcases.functions";
import { reorderPortfolioShowcases, updateShowcaseSite } from "@/lib/portfolio.functions";
import { ShowcaseShareDialog } from "@/features/showcases/components/ShowcaseShareDialog";

/**
 * The list of showcases — now framed as "the projects on your site" rather than
 * "your standalone brochures".
 *
 * The order here IS the order visitors see, so the grid is drag-sortable and
 * each card carries the two site controls that matter at a glance: whether the
 * project is listed at all, and whether it is badged as featured. Editing
 * anything deeper happens in the builder; putting slug/service/products here as
 * well would just be a second place to get them wrong.
 */
export function ShowcasesPanel({
  portfolioSlug,
  published,
  canEdit,
  onCountsChanged,
}: {
  portfolioSlug: string;
  published: boolean;
  canEdit: boolean;
  onCountsChanged?: () => void;
}) {
  const navigate = useNavigate();
  const [showcases, setShowcases] = useState<ShowcaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [shareFor, setShareFor] = useState<ShowcaseSummary | null>(null);
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; location: string | null }>
  >([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  // A drag must beat a click: without a distance threshold, every tap on a
  // card's Switch or menu would start a drag instead of activating the control.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = async () => {
    setLoading(true);
    try {
      const res = await listShowcases();
      setShowcases(res.showcases);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load portfolios");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const doCreate = async () => {
    const t = title.trim();
    if (!t) return;
    setCreating(true);
    try {
      const res = await createShowcase({ data: { title: t } });
      toast.success("Portfolio created");
      setCreateOpen(false);
      setTitle("");
      navigate({ to: "/showcases/$showcaseId", params: { showcaseId: res.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create portfolio");
    } finally {
      setCreating(false);
    }
  };

  /** Loaded lazily when the dialog opens — the list itself doesn't need it. */
  const loadProjects = async () => {
    setProjectsLoading(true);
    try {
      const { data } = await supabase
        .from("projects")
        .select("id, name, location, street, city, state")
        .order("updated_at", { ascending: false })
        .limit(50);
      setProjects(
        ((data as any[]) ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          location: p.location ?? [p.street, p.city, p.state].filter(Boolean).join(", ") ?? null,
        })),
      );
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  const openCreate = () => {
    setCreateOpen(true);
    void loadProjects();
  };

  const doCreateFromProject = async (projectId: string) => {
    setCreating(true);
    try {
      const res = await createShowcaseFromProject({ data: { projectId } });
      toast.success(`Portfolio built from ${res.photoCount} photos — edit anything you like.`);
      setCreateOpen(false);
      navigate({ to: "/showcases/$showcaseId", params: { showcaseId: res.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not build portfolio");
    } finally {
      setCreating(false);
    }
  };

  const doDelete = async (id: string) => {
    try {
      await deleteShowcase({ data: { id } });
      setShowcases((prev) => prev.filter((x) => x.id !== id));
      onCountsChanged?.();
      toast.success("Portfolio deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete portfolio");
    }
  };

  /**
   * Persists the dragged order.
   *
   * The list is reordered locally first and only reverted on failure — a card
   * that snaps back to where it was for the length of a round trip reads as
   * "the drag didn't take", which is the one thing a sortable grid must never
   * do. `onCountsChanged` is deliberately NOT called: it refetches the whole
   * portfolio and would yank the grid out from under the user mid-interaction.
   */
  const persistOrder = async (next: ShowcaseSummary[], previous: ShowcaseSummary[]) => {
    setSavingOrder(true);
    try {
      await reorderPortfolioShowcases({ data: { ids: next.map((s) => s.id) } });
    } catch (e: any) {
      setShowcases(previous);
      toast.error(e?.message ?? "Could not save the new order");
    } finally {
      setSavingOrder(false);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = showcases.findIndex((s) => s.id === active.id);
    const newIndex = showcases.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const previous = showcases;
    const next = arrayMove(showcases, oldIndex, newIndex);
    setShowcases(next);
    void persistOrder(next, previous);
  };

  /**
   * Optimistic: these are one-tap switches on a grid, and waiting ~300ms for a
   * round trip before the toggle moves makes the whole list feel stuck. Rolled
   * back on failure.
   */
  const patchSite = async (s: ShowcaseSummary, patch: { onSite?: boolean; featured?: boolean }) => {
    const before = showcases;
    setBusyId(s.id);
    setShowcases((prev) =>
      prev.map((x) =>
        x.id === s.id
          ? {
              ...x,
              on_site: patch.onSite ?? x.on_site,
              featured: patch.featured ?? x.featured,
            }
          : x,
      ),
    );
    try {
      await updateShowcaseSite({ data: { id: s.id, ...patch } });
      onCountsChanged?.();
    } catch (e: any) {
      setShowcases(before);
      toast.error(e?.message ?? "Could not update the site listing");
    } finally {
      setBusyId(null);
    }
  };

  /** Keeps the card's Live/Draft pill in step with the share dialog's switch. */
  const applyShareChange = (id: string, revokedAt: string | null) => {
    setShowcases((prev) => prev.map((x) => (x.id === id ? { ...x, revoked_at: revokedAt } : x)));
    setShareFor((cur) => (cur && cur.id === id ? { ...cur, revoked_at: revokedAt } : cur));
    onCountsChanged?.();
  };

  const listedCount = showcases.filter((s) => s.on_site && !s.revoked_at).length;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            {loading ? (
              "Loading…"
            ) : (
              <>
                <span className="font-bold text-foreground">{listedCount}</span> of{" "}
                {showcases.length} showing on your site
              </>
            )}
          </p>
          {!loading && canEdit && showcases.length > 1 && (
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <GripVertical className="h-3 w-3" />
              Drag to set the order visitors see
              {savingOrder && <Loader2 className="h-3 w-3 animate-spin" />}
            </p>
          )}
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> New portfolio
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : showcases.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No portfolios yet"
          description="Build your first portfolio from a finished job — it becomes a page on your public site."
          action={
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> New portfolio
            </Button>
          }
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={showcases.map((s) => s.id)} strategy={rectSortingStrategy}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {showcases.map((s) => (
                <SortableShowcaseCard
                  key={s.id}
                  showcase={s}
                  portfolioSlug={portfolioSlug}
                  published={published}
                  canEdit={canEdit}
                  busy={busyId === s.id}
                  onPatchSite={(patch) => patchSite(s, patch)}
                  onShare={() => setShareFor(s)}
                  onDelete={() => doDelete(s.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {shareFor && (
        <ShowcaseShareDialog
          open
          onOpenChange={(o) => !o && setShareFor(null)}
          showcaseId={shareFor.id}
          title={shareFor.title}
          shareToken={shareFor.share_token}
          revokedAt={shareFor.revoked_at}
          onChanged={(revokedAt) => applyShareChange(shareFor.id, revokedAt)}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New portfolio</DialogTitle>
            <DialogDescription>
              Build one from a finished job in one click, or start from a blank page.
            </DialogDescription>
          </DialogHeader>

          {/* Project-first: everything a showcase needs (name, address, photos
              already tagged before/progress/after) is on the project, so
              generating the finished draft beats asking the user to author it. */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Build from a project
            </p>
            {projectsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : projects.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No projects with photos yet.</p>
            ) : (
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={creating}
                    onClick={() => doCreateFromProject(p.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition hover:border-primary/50 hover:bg-accent disabled:opacity-60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">{p.name}</p>
                      {p.location && (
                        <p className="truncate text-xs text-muted-foreground">{p.location}</p>
                      )}
                    </div>
                    <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 py-1">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              or
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Start blank
            </p>
            <div className="mt-2 flex gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Kitchen &amp; Bath Remodels"
                onKeyDown={(e) => e.key === "Enter" && title.trim() && void doCreate()}
              />
              <Button onClick={doCreate} disabled={creating || !title.trim()} className="shrink-0">
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One project tile.
 *
 * The drag handle is an explicit grip rather than the whole card, because the
 * card is already a link to the builder and carries a switch, a star and a
 * menu — making the entire surface draggable would fight all four.
 */
function SortableShowcaseCard({
  showcase: s,
  portfolioSlug,
  published,
  canEdit,
  busy,
  onPatchSite,
  onShare,
  onDelete,
}: {
  showcase: ShowcaseSummary;
  portfolioSlug: string;
  published: boolean;
  canEdit: boolean;
  busy: boolean;
  onPatchSite: (patch: { onSite?: boolean; featured?: boolean }) => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
    disabled: !canEdit,
  });

  const listed = s.on_site && !s.revoked_at;
  const location = [s.city, s.state].filter(Boolean).join(", ");

  return (
    <Card
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Lifted above its neighbours so it isn't clipped while crossing rows.
        zIndex: isDragging ? 30 : undefined,
      }}
      className={cn(
        "group relative overflow-hidden transition hover:border-primary/40 hover:shadow-lg",
        !isDragging && "hover:-translate-y-0.5",
        isDragging && "opacity-80 shadow-2xl ring-2 ring-primary/40",
        !listed && "opacity-70",
      )}
    >
      {/* Stretched link: the whole card opens the builder, while the controls
          below sit above it on z-index. A real anchor keeps keyboard focus,
          middle-click and "open in new tab" working. */}
      <Link
        to="/showcases/$showcaseId"
        params={{ showcaseId: s.id }}
        aria-label={`Open ${s.title}`}
        className="absolute inset-0 z-[1] rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="relative aspect-video bg-muted">
        {s.cover_image_url ? (
          <img
            src={s.cover_image_url}
            alt=""
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Layers className="h-8 w-8" />
          </div>
        )}

        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm",
              listed ? "bg-emerald-500/90 text-white" : "bg-black/55 text-white/90",
            )}
          >
            {s.revoked_at ? "Draft" : listed ? "On site" : "Hidden"}
          </span>
          {s.service_type && (
            <span className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/90 backdrop-blur-sm">
              {s.service_type}
            </span>
          )}
        </div>

        <div className="absolute right-2 top-2 z-[2] flex items-center gap-1.5">
          {s.featured && (
            <span
              className="grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-amber-950 shadow-sm"
              title="Featured"
            >
              <Star className="h-3.5 w-3.5 fill-current" />
            </span>
          )}
          {canEdit && (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${s.title}`}
              className={cn(
                "grid h-6 w-6 cursor-grab touch-none place-items-center rounded-md bg-black/55 text-white",
                "opacity-0 backdrop-blur-sm transition hover:bg-black/75 focus-visible:opacity-100",
                "group-hover:opacity-100 active:cursor-grabbing",
                isDragging && "opacity-100",
              )}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        <p className="truncate text-sm font-semibold text-foreground">{s.title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {s.item_count} photo{s.item_count === 1 ? "" : "s"}
          {location && (
            <>
              <span className="text-border">·</span>
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{location}</span>
            </>
          )}
        </p>

        <div className="relative z-[2] mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          <label className={cn("flex items-center gap-2", canEdit && "cursor-pointer")}>
            <Switch
              checked={s.on_site}
              disabled={!canEdit || busy || !!s.revoked_at}
              onCheckedChange={(v) => onPatchSite({ onSite: v })}
              aria-label="Show on portfolio site"
            />
            <span className="text-xs font-bold text-muted-foreground">On site</span>
          </label>

          <div className="flex shrink-0 items-center gap-1">
            {canEdit && (
              <Button
                size="icon"
                variant="ghost"
                className={cn("h-8 w-8", s.featured && "text-amber-500")}
                disabled={busy}
                onClick={() => onPatchSite({ featured: !s.featured })}
                aria-label={s.featured ? "Remove featured badge" : "Add featured badge"}
                title={s.featured ? "Featured — badged on the card" : "Badge as featured"}
              >
                <Star className={cn("h-4 w-4", s.featured && "fill-current")} />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!published || !listed || !s.slug}
                  onClick={() =>
                    window.open(`${window.location.origin}/p/${portfolioSlug}/${s.slug}`, "_blank")
                  }
                >
                  <ExternalLink className="mr-2 h-4 w-4" /> View on site
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onShare}>
                  <Share2 className="mr-2 h-4 w-4" /> Share direct link…
                </DropdownMenuItem>
                {canEdit && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </Card>
  );
}
