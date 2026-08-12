import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Search, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/sitepix/client";
import { PhotoThumb } from "@/components/PhotoThumb";

interface PhotoRow {
  id: string;
  project_id: string;
  project_name: string;
  storage_path: string;
  /** Pre-generated thumbnail; null for photos uploaded before they existed. */
  thumb_path?: string | null;
  image_url: string | null;
  caption: string | null;
}

export interface PickedPhoto {
  id: string;
  image_url: string;
  project_id: string;
  project_name: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (photos: PickedPhoto[]) => void;
  /** Copy for the confirm button — the builder uses different verbs for
   *  "add to this section" vs "build sections from projects". */
  confirmLabel?: string;
  title?: string;
  description?: string;
  /**
   * One photo at a time. Used for the portfolio hero and a showcase's cover,
   * where "selected" means *this one*, not *these ones* — so picking a second
   * photo replaces the first instead of adding to it, and the per-project
   * "Select all" is hidden because it cannot mean anything here.
   */
  singleSelect?: boolean;
}

export function ShowcasePhotoPickerDialog({
  open,
  onClose,
  onPick,
  confirmLabel = "Add",
  title = "Add photos",
  description = "Photos are grouped by project — use “Select all” to pull in a whole job at once.",
  singleSelect = false,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setQuery("");
    void loadPhotos();
  }, [open]);

  const loadPhotos = async () => {
    setLoading(true);
    try {
      // Project names are fetched separately rather than as a PostgREST embed
      // (`project:projects(name)`) — the embed depends on a detectable FK and
      // silently returns no rows when it can't be resolved, which left the
      // picker permanently empty.
      const { data, error } = await supabase
        .from("photos")
        .select("id, project_id, storage_path, thumb_path, image_url, caption")
        .is("deleted_at", null)
        // A picker exists so the user can reach their photos; walkthrough
        // captures are photos. See the note in ProjectDetailPage's `load`.
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;

      const raw = (data as any[]) ?? [];

      const projectIds = [...new Set(raw.map((r) => r.project_id).filter(Boolean))];
      const names: Record<string, string> = {};
      if (projectIds.length) {
        const { data: projectRows } = await supabase
          .from("projects")
          .select("id, name")
          .in("id", projectIds);
        (projectRows as any[])?.forEach((p) => {
          names[p.id] = p.name ?? "";
        });
      }

      const rows = raw.map((r) => ({
        id: r.id,
        project_id: r.project_id,
        project_name: names[r.project_id] ?? "Untitled project",
        storage_path: r.storage_path,
        thumb_path: r.thumb_path ?? null,
        image_url: r.image_url,
        caption: r.caption,
      })) as PhotoRow[];
      setPhotos(rows);

      const needSign = rows.filter((r) => !r.image_url && r.storage_path);
      if (needSign.length) {
        const { data: signedUrls } = await supabase.storage.from("site-photos").createSignedUrls(
          needSign.map((r) => r.storage_path),
          60 * 60,
        );
        const map: Record<string, string> = {};
        signedUrls?.forEach((s, i) => {
          if (s.signedUrl) map[needSign[i].id] = s.signedUrl;
        });
        setSigned(map);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load photos");
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  };

  const urlFor = (p: PhotoRow) => p.image_url ?? signed[p.id] ?? "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return photos;
    return photos.filter(
      (p) =>
        p.project_name.toLowerCase().includes(q) || (p.caption ?? "").toLowerCase().includes(q),
    );
  }, [photos, query]);

  /** Photos bucketed by project, preserving the newest-project-first order. */
  const groups = useMemo(() => {
    const byProject = new Map<
      string,
      { projectId: string; projectName: string; photos: PhotoRow[] }
    >();
    for (const p of filtered) {
      const g = byProject.get(p.project_id);
      if (g) g.photos.push(p);
      else
        byProject.set(p.project_id, {
          projectId: p.project_id,
          projectName: p.project_name,
          photos: [p],
        });
    }
    return Array.from(byProject.values());
  }, [filtered]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      if (singleSelect) return prev.has(id) ? new Set() : new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleProject = (photosInProject: PhotoRow[]) => {
    const ids = photosInProject.map((p) => p.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const confirm = () => {
    // Iterate `photos` (not `filtered`) so a selection made before typing a
    // search term is never silently dropped by the active filter.
    const picked = photos
      .filter((p) => selected.has(p.id))
      .map((p) => ({
        id: p.id,
        image_url: urlFor(p),
        project_id: p.project_id,
        project_name: p.project_name,
      }));
    onPick(picked);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b px-6 pb-4 pt-5">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search project or caption…"
                className="h-9 pl-8"
              />
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : groups.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {photos.length === 0
                  ? "No photos in your projects yet — upload some from a project first."
                  : "No photos match your search."}
              </div>
            ) : (
              <div className="space-y-6">
                {groups.map((g) => {
                  const allSelected = g.photos.every((p) => selected.has(p.id));
                  return (
                    <div key={g.projectId}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-bold text-foreground">
                          {g.projectName}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {g.photos.length} photo{g.photos.length === 1 ? "" : "s"}
                          </span>
                        </p>
                        {!singleSelect && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 shrink-0 text-xs font-bold"
                            onClick={() => toggleProject(g.photos)}
                          >
                            {allSelected ? "Clear" : "Select all"}
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                        {g.photos.map((p) => {
                          const checked = selected.has(p.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => toggle(p.id)}
                              className={`group relative aspect-square overflow-hidden rounded-md border-2 transition ${
                                checked
                                  ? "border-primary ring-2 ring-primary/30"
                                  : "border-transparent"
                              }`}
                            >
                              {/* 300 photos as ~120px tiles — the clearest case
                                  in the app for thumbnails over originals. */}
                              <PhotoThumb
                                storagePath={p.storage_path}
                                thumbPath={p.thumb_path}
                                fallbackUrl={urlFor(p)}
                                width={200}
                              />
                              {checked && (
                                <div className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                                  <Check className="h-3 w-3" />
                                </div>
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

          <DialogFooter className="border-t px-6 py-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={selected.size === 0}>
              {singleSelect ? (
                confirmLabel
              ) : (
                <>
                  {confirmLabel} {selected.size > 0 ? selected.size : ""} photo
                  {selected.size === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
