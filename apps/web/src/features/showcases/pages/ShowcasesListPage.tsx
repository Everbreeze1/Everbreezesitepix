import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Layers,
  Loader2,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Copy,
  ExternalLink,
  MoreVertical,
  Pencil,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { useSubscription } from "@/hooks/use-subscription";
import {
  listShowcases,
  createShowcase,
  deleteShowcase,
  setShowcaseShare,
  type ShowcaseSummary,
} from "@/lib/showcases.functions";

export function ShowcasesListPage() {
  const navigate = useNavigate();
  const { isTeam, loading: subLoading } = useSubscription();
  const [showcases, setShowcases] = useState<ShowcaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

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

  const doDelete = async (id: string) => {
    try {
      await deleteShowcase({ data: { id } });
      setShowcases((prev) => prev.filter((s) => s.id !== id));
      toast.success("Showcase deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete showcase");
    }
  };

  const toggleShare = async (s: ShowcaseSummary) => {
    const enable = !!s.revoked_at;
    try {
      await setShowcaseShare({ data: { id: s.id, enable } });
      setShowcases((prev) =>
        prev.map((x) => (x.id === s.id ? { ...x, revoked_at: enable ? null : new Date().toISOString() } : x)),
      );
      toast.success(enable ? "Share link enabled" : "Share link disabled");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
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
          <Button onClick={() => setCreateOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
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
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> New Showcase
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showcases.map((s) => (
              <Card key={s.id} className="overflow-hidden">
                <Link to="/showcases/$showcaseId" params={{ showcaseId: s.id }}>
                  <div className="aspect-video bg-muted">
                    {s.cover_image_url ? (
                      <img src={s.cover_image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <Layers className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                </Link>
                <div className="flex items-start justify-between gap-2 p-4">
                  <div className="min-w-0">
                    <Link
                      to="/showcases/$showcaseId"
                      params={{ showcaseId: s.id }}
                      className="truncate text-sm font-semibold hover:underline"
                    >
                      {s.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.item_count} photo{s.item_count === 1 ? "" : "s"} ·{" "}
                      {s.revoked_at ? "Not published" : "Published"}
                    </p>
                  </div>
                  {/* An explicit button, not just the card/title link — opening
                      the builder was previously discoverable only by guessing
                      the cover image was clickable. */}
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link to="/showcases/$showcaseId" params={{ showcaseId: s.id }}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Link>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="shrink-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          window.open(`${window.location.origin}/share/showcases/${s.share_token}`, "_blank")
                        }
                        disabled={!!s.revoked_at}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" /> Open share page
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${window.location.origin}/share/showcases/${s.share_token}`,
                          );
                          toast.success("Link copied");
                        }}
                        disabled={!!s.revoked_at}
                      >
                        <Copy className="mr-2 h-4 w-4" /> Copy link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleShare(s)}>
                        {s.revoked_at ? (
                          <>
                            <Eye className="mr-2 h-4 w-4" /> Publish
                          </>
                        ) : (
                          <>
                            <EyeOff className="mr-2 h-4 w-4" /> Unpublish
                          </>
                        )}
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
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Showcase</DialogTitle>
          </DialogHeader>
          <Input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Kitchen &amp; Bath Remodels"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={doCreate} disabled={creating || !title.trim()}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
