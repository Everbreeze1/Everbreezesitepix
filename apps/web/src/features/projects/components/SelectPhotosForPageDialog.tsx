import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/sitepix/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MAX_PHOTOS = 50;

interface PickerPhoto {
  id: string;
  url: string;
  caption: string | null;
  takenAt: string;
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function SelectPhotosForPageDialog({
  open,
  projectId,
  templateLabel,
  generating,
  onCancel,
  onGenerate,
}: {
  open: boolean;
  projectId: string;
  templateLabel: string;
  generating: boolean;
  onCancel: () => void;
  onGenerate: (photoIds: string[]) => void;
}) {
  const [photos, setPhotos] = useState<PickerPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSelected(new Set());
    (async () => {
      try {
        const { data, error } = await (supabase as any)
          .from("photos")
          .select("id, image_url, storage_path, caption, taken_at, created_at")
          .eq("project_id", projectId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(300);
        if (error) throw error;

        const rows = (data as any[]) ?? [];
        const resolved: PickerPhoto[] = [];
        for (const r of rows) {
          let url = r.image_url as string | null;
          if (!url) {
            const { data: s } = await supabase.storage
              .from("site-photos")
              .createSignedUrl(r.storage_path, 3600);
            url = s?.signedUrl ?? null;
          }
          if (url) {
            resolved.push({
              id: r.id,
              url,
              caption: r.caption,
              takenAt: r.taken_at ?? r.created_at,
            });
          }
        }
        if (!cancelled) setPhotos(resolved);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Could not load photos");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const groups = useMemo(() => {
    const map = new Map<string, PickerPhoto[]>();
    for (const p of photos) {
      const k = dayKey(p.takenAt);
      const arr = map.get(k) ?? [];
      arr.push(p);
      map.set(k, arr);
    }
    return Array.from(map.entries());
  }, [photos]);

  const atLimit = selected.size >= MAX_PHOTOS;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PHOTOS) next.add(id);
      else toast.error(`You can select up to ${MAX_PHOTOS} photos`);
      return next;
    });
  }

  function toggleDay(items: PickerPhoto[]) {
    const allOn = items.every((p) => selected.has(p.id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) {
        items.forEach((p) => next.delete(p.id));
      } else {
        for (const p of items) {
          if (next.size >= MAX_PHOTOS) break;
          next.add(p.id);
        }
      }
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !generating && onCancel()}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pb-4 pt-5 text-left">
          <DialogTitle>Select up to {MAX_PHOTOS} photos</DialogTitle>
          <DialogDescription>
            {templateLabel} will be drafted from the photos you pick — their captions, tags and any
            AI analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : photos.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              This project has no photos yet. Add photos first, then generate a document from them.
            </p>
          ) : (
            <div className="space-y-6">
              {groups.map(([day, items]) => {
                const allOn = items.every((p) => selected.has(p.id));
                return (
                  <div key={day}>
                    <label className="mb-2.5 flex cursor-pointer items-center gap-2.5">
                      <Checkbox checked={allOn} onCheckedChange={() => toggleDay(items)} />
                      <span className="text-sm font-bold text-foreground">{day}</span>
                      <span className="text-xs text-muted-foreground">{items.length}</span>
                    </label>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
                      {items.map((p) => {
                        const on = selected.has(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggle(p.id)}
                            disabled={!on && atLimit}
                            className={cn(
                              "group relative aspect-square overflow-hidden rounded-md border-2 transition",
                              on ? "border-primary" : "border-transparent hover:border-border",
                              !on && atLimit && "cursor-not-allowed opacity-40",
                            )}
                          >
                            <img
                              src={p.url}
                              alt={p.caption ?? ""}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                            {on && (
                              <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                                <Check className="h-3 w-3" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={selected.size === 0 || generating}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
            <span className="text-xs font-semibold text-muted-foreground">
              {selected.size} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onCancel} disabled={generating}>
              Cancel
            </Button>
            <Button
              onClick={() => onGenerate(Array.from(selected))}
              disabled={selected.size === 0 || generating}
            >
              {generating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-4 w-4" />
              )}
              Generate
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
