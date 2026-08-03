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
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { supabase } from "@/integrations/sitepix/client";
import { useSubscription } from "@/hooks/use-subscription";
import {
  listShowcases,
  createShowcase,
  createShowcaseFromProject,
  deleteShowcase,
  type ShowcaseSummary,
} from "@/lib/showcases.functions";
import { ShowcaseShareDialog } from "@/features/showcases/components/ShowcaseShareDialog";

export function ShowcasesListPage() {
  const navigate = useNavigate();
  const { isTeam, loading: subLoading } = useSubscription();
  const [showcases, setShowcases] = useState<ShowcaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [shareFor, setShareFor] = useState<ShowcaseSummary | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; location: string | null }>>(
    [],
  );
  const [projectsLoading, setProjectsLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listShowcases();
      setShowcases(res.showcases);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load showcases");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isTeam) void load();
  }, [isTeam]);

  const doCreate = async () => {
    const t = title.trim();
    if (!t) return;
    setCreating(true);
    try {
      const res = await createShowcase({ data: { title: t } });
      toast.success("Showcase created");
      setCreateOpen(false);
      setTitle("");
      navigate({ to: "/showcases/$showcaseId", params: { showcaseId: res.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create showcase");
    } finally {
      setCreating(false);
    }
  };

  /** Loaded lazily when the dialog opens — the list page itself doesn't need it. */
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
          location:
            p.location ?? [p.street, p.city, p.state].filter(Boolean).join(", ") ?? null,
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
      toast.success(`Showcase built from ${res.photoCount} photos — edit anything you like.`);
      setCreateOpen(false);
      navigate({ to: "/showcases/$showcaseId", params: { showcaseId: res.id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not build showcase");
    } finally {
      setCreating(false);
    }
  };

  const doDelete = async (id: string) => {
    try {
      await deleteShowcase({ data: { id } });
      setShowcases((prev) => prev.filter((s) => s.id !== id));
      toast.success("Showcase deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete showcase");
    }
  };

  /** Keeps the card's Live/Draft pill in step with the share dialog's switch. */
  const applyShareChange = (id: string, revokedAt: string | null) => {
    setShowcases((prev) => prev.map((x) => (x.id === id ? { ...x, revoked_at: revokedAt } : x)));
    setShareFor((cur) => (cur && cur.id === id ? { ...cur, revoked_at: revokedAt } : cur));
  };

  if (subLoading) {
    return (
      <div className="flex min-h-full items-center justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isTeam) {
    return (
      <div className="p-6 sm:p-10">
        <PageHeader title="Showcases" description="Build a public portfolio to help sell your business." />
        <div className="mt-8 rounded-2xl border border-border bg-card/70 p-10 text-center">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <p className="mt-3 text-sm text-muted-foreground">
            Job Showcases are a Team plan feature.
          </p>
          <Button asChild className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90">
            <Link to="/pricing">See Team plan</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-10">
      <PageHeader
        title="Showcases"
        description="Build a shareable brochure of your best work — pick projects, write the copy, publish."
        actions={
          <Button onClick={openCreate} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-1.5 h-4 w-4" /> New Showcase
          </Button>
        }
      />

      <div className="mt-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : showcases.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No showcases yet"
            description="Build your first portfolio page to show prospects what your crew can do."
            action={
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> New Showcase
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showcases.map((s) => (
              <Card
                key={s.id}
                className="group relative overflow-hidden transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
              >
                {/* Stretched link: the whole card opens the builder, while the
                    menu and Share button below sit above it on z-index. A real
                    anchor (not an onClick) keeps keyboard focus, middle-click
                    and "open in new tab" working. */}
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
                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm ${
                      s.revoked_at
                        ? "bg-black/55 text-white/90"
                        : "bg-emerald-500/90 text-white"
                    }`}
                  >
                    {s.revoked_at ? "Draft" : "Live"}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{s.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.item_count} photo{s.item_count === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="relative z-[2] flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-xs font-bold"
                      onClick={() => setShareFor(s)}
                    >
                      <Share2 className="mr-1.5 h-3.5 w-3.5" /> Share
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setShareFor(s)}>
                          <Share2 className="mr-2 h-4 w-4" /> Share…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            window.open(
                              `${window.location.origin}/share/showcases/${s.share_token}`,
                              "_blank",
                            )
                          }
                          disabled={!!s.revoked_at}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" /> Open share page
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => doDelete(s.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

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
            <DialogTitle>New Showcase</DialogTitle>
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
              <p className="mt-2 text-sm text-muted-foreground">
                No projects with photos yet.
              </p>
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
