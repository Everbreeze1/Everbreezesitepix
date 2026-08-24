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
import { supabase } from "@/integrations/everlumen/client";
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
  outputNoun = "document",
  options,
  generating,
  initialSelected,
  onCancel,
  onGenerate,
}: {
  open: boolean;
  projectId: string;
  templateLabel: string;
  /**
   * Photos to arrive pre-ticked - the photo selection bar opens this with the
   * user's current selection, and re-picking what they just picked is the kind
   * of step that makes a feature feel like it was bolted on. Ids the project
   * does not have (or beyond the cap) are dropped, and the drop is announced.
   */
  initialSelected?: string[];
  /**
   * Per-template controls shown above the footer - the Report's photos-per-page
   * density, for instance. Rendered here rather than after generation because
   * layout is a decision about the document, and asking for it once beats
   * generating something informal and making the user go fix it.
   */
  options?: React.ReactNode;
  /**
   * What the picker produces, for the no-photos copy. Defaults to "document"
   * because most templates here file into Documents - but Summary writes a
   * walkthrough, and telling its user to "generate a document" points them at
   * the wrong tab. Passed explicitly rather than derived from `templateLabel`,
   * which is display copy and free to change.
   */
  outputNoun?: string;
  generating: boolean;
  onCancel: () => void;
  onGenerate: (photoIds: string[]) => void;
}) {
  const [photos, setPhotos] = useState<PickerPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // A joined key, not the array itself: callers build `initialSelected` inline,
  // so depending on the array re-runs this load on every parent render.
  const initialKey = (initialSelected ?? []).join(",");

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
        /*
         * One batch signing request rather than one per row inside an awaited
         * loop. At the 300-row limit above that was 300 sequential round trips
         * - tens of seconds on a field connection before a single thumbnail
         * appeared, and invisible in dev where a project has five photos.
         * `createSignedUrls` (plural) signs the whole array at once;
         * `ProjectChecklists.signPhotos` is the model implementation.
         */
        const toSign = rows
          .filter((r) => !r.image_url && r.storage_path)
          .map((r) => r.storage_path as string);
        const signedByPath: Record<string, string> = {};
        if (toSign.length) {
          const { data: signed } = await supabase.storage
            .from("site-photos")
            .createSignedUrls(toSign, 3600);
          signed?.forEach((s, i) => {
            if (s.signedUrl) signedByPath[toSign[i]] = s.signedUrl;
          });
        }
        const resolved: PickerPhoto[] = [];
        for (const r of rows) {
          const url = (r.image_url as string | null) ?? signedByPath[r.storage_path] ?? null;
          if (url) {
            resolved.push({
              id: r.id,
              url,
              caption: r.caption,
              takenAt: r.taken_at ?? r.created_at,
            });
          }
        }
        if (cancelled) return;
        setPhotos(resolved);

        const seed = initialKey ? initialKey.split(",") : [];
        if (seed.length) {
          const onScreen = new Set(resolved.map((p) => p.id));
          const usable = seed.filter((id) => onScreen.has(id));
          const kept = usable.slice(0, MAX_PHOTOS);
          setSelected(new Set(kept));
          const dropped = seed.length - kept.length;
          if (dropped > 0) {
            toast.warning(`${kept.length} of your ${seed.length} selected photos carried over`, {
              description:
                usable.length > MAX_PHOTOS
                  ? `${templateLabel} takes up to ${MAX_PHOTOS}. Adjust the picks below.`
                  : `${dropped} are not in this project's recent photos. Adjust the picks below.`,
            });
          }
        }
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? "Could not load photos");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId, initialKey]);

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
            {templateLabel} will be drafted from the photos you pick - their captions, tags and any
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
              This project has no photos yet. Add photos first, then generate a {outputNoun} from
              them.
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

        {options && <div className="border-t px-6 py-4">{options}</div>}

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
