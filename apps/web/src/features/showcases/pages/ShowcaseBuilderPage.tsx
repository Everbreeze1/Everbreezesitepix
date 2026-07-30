import { Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2,
  ArrowLeft,
  Plus,
  X as XIcon,
  ArrowUp,
  ArrowDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  getShowcase,
  updateShowcase,
  setShowcaseItems,
  setShowcaseShare,
  type ShowcaseItemDetail,
} from "@/lib/showcases.functions";
import { ShowcasePhotoPickerDialog } from "@/features/showcases/components/ShowcasePhotoPickerDialog";

export function ShowcaseBuilderPage() {
  const { showcaseId } = useParams({ from: "/_app/showcases/$showcaseId" });
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [layout, setLayout] = useState<"grid" | "masonry" | "featured">("grid");
  const [shareToken, setShareToken] = useState("");
  const [revokedAt, setRevokedAt] = useState<string | null>(null);
  const [items, setItems] = useState<ShowcaseItemDetail[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  /** `silent` refreshes in place after a mutation, without blanking the page behind a spinner. */
  const load = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true);
    try {
      const s = await getShowcase({ data: { id: showcaseId } });
      if (!s) {
        toast.error("Showcase not found");
        return;
      }
      setTitle(s.title);
      setTagline(s.tagline ?? "");
      setLayout(s.layout as "grid" | "masonry" | "featured");
      setShareToken(s.share_token);
      setRevokedAt(s.revoked_at);
      setItems(s.items);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load showcase");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showcaseId]);

  const saveDetails = async () => {
    try {
      await updateShowcase({ data: { id: showcaseId, title: title.trim(), tagline: tagline.trim() || null, layout } });
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    }
  };

  /** Returns false when the write failed, so callers don't report success. */
  const savePhotos = async (next: ShowcaseItemDetail[]): Promise<boolean> => {
    setSaving(true);
    try {
      await setShowcaseItems({
        data: {
          showcaseId,
          items: next.map((it) => ({ photoId: it.photo_id, caption: it.caption })),
        },
      });
      setItems(next);
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save photos");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...items];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    void savePhotos(next.map((it, i) => ({ ...it, position: i })));
  };

  const removeItem = (id: string) => {
    void savePhotos(items.filter((it) => it.id !== id));
  };

  const updateCaption = (id: string, caption: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, caption } : it)));
  };

  const commitCaption = () => {
    void savePhotos(items);
  };

  const addPhotos = async (picked: Array<{ id: string; image_url: string }>) => {
    const existing = new Set(items.map((it) => it.photo_id));
    const fresh = picked.filter((p) => !existing.has(p.id));
    setPickerOpen(false);
    if (fresh.length === 0) {
      toast.info("Those photos are already in this showcase");
      return;
    }
    const next = [
      ...items,
      ...fresh.map((p, i) => ({
        id: `new-${p.id}`,
        photo_id: p.id,
        caption: null,
        position: items.length + i,
        image_url: p.image_url,
      })),
    ];
    const ok = await savePhotos(next);
    // Re-read so the optimistic `new-*` rows are replaced by real item ids —
    // and so a failed write rolls back to the server's state.
    await load({ silent: true });
    if (ok) toast.success(`Added ${fresh.length} photo${fresh.length === 1 ? "" : "s"}`);
  };

  const toggleShare = async () => {
    const enable = !!revokedAt;
    try {
      await setShowcaseShare({ data: { id: showcaseId, enable } });
      setRevokedAt(enable ? null : new Date().toISOString());
      toast.success(enable ? "Published" : "Unpublished");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/share/showcases/${shareToken}`;

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 sm:p-10">
      <Link to="/showcases" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Showcases
      </Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveDetails} />
              </div>
              <div>
                <Label>Tagline (optional)</Label>
                <Textarea
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  onBlur={saveDetails}
                  rows={2}
                  placeholder="One line about what makes this work stand out"
                />
              </div>
              <div>
                <Label>Layout</Label>
                <Select
                  value={layout}
                  onValueChange={(v) => {
                    setLayout(v as typeof layout);
                    void updateShowcase({ data: { id: showcaseId, layout: v as typeof layout } });
                  }}
                >
                  <SelectTrigger className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="grid">Grid</SelectItem>
                    <SelectItem value="masonry">Masonry</SelectItem>
                    <SelectItem value="featured">Featured + grid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between">
              <p className="text-sm font-extrabold text-foreground">
                Photos ({items.length}) {saving && <Loader2 className="ml-1 inline h-3.5 w-3.5 animate-spin" />}
              </p>
              <Button size="sm" onClick={() => setPickerOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Add photos
              </Button>
            </div>

            {items.length === 0 ? (
              <p className="mt-6 text-center text-sm text-muted-foreground">
                No photos yet — add some from any of your projects.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {items.map((it, idx) => (
                  <div key={it.id} className="flex gap-3 rounded-xl border border-border p-3">
                    <img src={it.image_url} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <Textarea
                        value={it.caption ?? ""}
                        onChange={(e) => updateCaption(it.id, e.target.value)}
                        onBlur={commitCaption}
                        rows={2}
                        placeholder="Caption (optional)"
                        className="text-sm"
                      />
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => move(idx, -1)} disabled={idx === 0}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => move(idx, 1)}
                        disabled={idx === items.length - 1}
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => removeItem(it.id)}
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="h-fit rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-extrabold text-foreground">Share</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {revokedAt ? "Not published — this link won't work until you publish." : "Live at this link."}
          </p>
          <Button onClick={toggleShare} variant="outline" className="mt-4 w-full">
            {revokedAt ? (
              <>
                <Eye className="mr-1.5 h-4 w-4" /> Publish
              </>
            ) : (
              <>
                <EyeOff className="mr-1.5 h-4 w-4" /> Unpublish
              </>
            )}
          </Button>
          {!revokedAt && (
            <div className="mt-2 space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  toast.success("Link copied");
                }}
              >
                <Copy className="mr-1.5 h-4 w-4" /> Copy link
              </Button>
              <Button asChild variant="outline" className="w-full">
                <a href={shareUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-4 w-4" /> Open
                </a>
              </Button>
            </div>
          )}
        </div>
      </div>

      <ShowcasePhotoPickerDialog open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addPhotos} />
    </div>
  );
}
