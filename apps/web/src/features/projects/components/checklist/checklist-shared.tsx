import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, Star, Upload } from "lucide-react";
import { photoObjectPaths } from "@everlumen/shared";
import { toast } from "sonner";
import { uploadPhotoThumbnail } from "@/lib/photo-thumbnails";
import { compressImageFile } from "@/features/photos/components/CameraCapture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";
import type { ItemType } from "@/lib/checklist-items";

/**
 * The pieces a single checklist is filled in with, shared by the panel that
 * lists checklists and the page that runs one.
 *
 * These used to be private helpers inside `ProjectChecklists.tsx`, back when the
 * only way to open a checklist was a dialog inside that panel. The record now
 * has its own route (`ChecklistDocumentPage`) so it can be printed and shared,
 * and both files need the same answer widget and the same photo picker - a
 * second copy of either is a second definition of what a recorded answer is.
 */

export interface ChecklistItem {
  id: string;
  checklist_id: string;
  position: number;
  label: string;
  required: boolean;
  completed_at: string | null;
  notes: string | null;
  item_type: ItemType;
  description: string | null;
  response_value: any;
}

export interface ProjectPhoto {
  id: string;
  storage_path: string;
  image_url: string | null;
  caption: string | null;
}

export interface ItemPhoto {
  id: string;
  item_id: string;
  photo_id: string;
}

/** Every column a `ChecklistItem` needs - shared so the refetch and the
 *  optimistic inserts can never select different shapes. */
export const ITEM_COLUMNS =
  "id, checklist_id, position, label, required, completed_at, notes, item_type, description, response_value";

/**
 * The answer widget for a non-checkbox item.
 *
 * `immediate: false` marks the inputs that are typed rather than tapped, so
 * they ride the debounced autosave queue instead of firing a write per
 * keystroke. Both are controlled: the text field used to be uncontrolled and
 * save only on blur, which silently discarded the answer if the dialog was
 * dismissed with Escape or by clicking the overlay.
 */
export function ChecklistItemResponse({
  item,
  readOnly = false,
  onChange,
}: {
  item: ChecklistItem;
  readOnly?: boolean;
  onChange: (value: any, opts?: { immediate?: boolean }) => void;
}) {
  const value = item.response_value;
  switch (item.item_type) {
    case "rating": {
      const n = typeof value === "number" ? value : 0;
      return (
        <div className="flex items-center gap-0.5" role="group" aria-label="Rating out of 5">
          {[1, 2, 3, 4, 5].map((v) => (
            <button
              key={v}
              type="button"
              disabled={readOnly}
              onClick={() => onChange(v === n ? null : v)}
              aria-pressed={v <= n}
              className="p-1.5 disabled:cursor-default"
              aria-label={`Rate ${v} out of 5`}
            >
              <Star
                className={`h-5 w-5 ${
                  v <= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
                }`}
              />
            </button>
          ))}
          {n > 0 && <span className="ml-2 text-xs text-muted-foreground">{n}/5</span>}
        </div>
      );
    }
    case "pass_fail":
    case "yes_no": {
      const opts = item.item_type === "pass_fail" ? ["Pass", "Fail"] : ["Yes", "No"];
      const colors =
        item.item_type === "pass_fail"
          ? [
              "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
              "bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-400",
            ]
          : [
              "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
              "bg-muted border-border",
            ];
      return (
        <div className="flex gap-2" role="group" aria-label={item.label}>
          {opts.map((o, i) => (
            <button
              key={o}
              type="button"
              disabled={readOnly}
              onClick={() => onChange(value === o ? null : o)}
              aria-pressed={value === o}
              className={`min-h-11 min-w-[76px] rounded-lg border px-4 py-2 text-sm font-bold transition-colors disabled:cursor-default ${
                value === o ? colors[i] : "border-border text-muted-foreground hover:bg-muted/60"
              }`}
            >
              {o}
            </button>
          ))}
        </div>
      );
    }
    case "numeric":
      return (
        <Input
          type="number"
          inputMode="decimal"
          value={value ?? ""}
          readOnly={readOnly}
          aria-label={item.label}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(null, { immediate: false });
              return;
            }
            // A partial entry like "1e" or "-" parses to NaN, which used to be
            // written straight to the record.
            const n = Number(raw);
            if (Number.isNaN(n)) return;
            onChange(n, { immediate: false });
          }}
          placeholder="Enter a value"
          className="h-10 max-w-[180px] text-base sm:text-sm"
        />
      );
    case "text":
      return (
        <Textarea
          value={typeof value === "string" ? value : ""}
          readOnly={readOnly}
          aria-label={item.label}
          onChange={(e) => onChange(e.target.value || null, { immediate: false })}
          placeholder="Type a response…"
          rows={2}
          className="text-base sm:text-sm"
        />
      );
    default:
      return null;
  }
}

export function AttachItemPhotosDialog({
  projectId,
  item,
  alreadyAttached,
  onClose,
  onAttached,
}: {
  projectId: string;
  item: ChecklistItem | null;
  alreadyAttached: string[];
  onClose: () => void;
  onAttached: () => void;
}) {
  const { user } = useAuth();
  const [photos, setPhotos] = useState<ProjectPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const loadPhotos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("photos")
      .select("id, storage_path, image_url, caption")
      .eq("project_id", projectId)
      // Trashed photos are soft-deleted with no database-level enforcement.
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(60);
    const rows = ((data as any[]) ?? []) as ProjectPhoto[];
    setPhotos(rows);

    const toSign = rows.filter((p) => !p.image_url).map((p) => p.storage_path);
    const signedMap: Record<string, string> = {};
    if (toSign.length) {
      const { data: signed } = await supabase.storage
        .from("site-photos")
        .createSignedUrls(toSign, 3600);
      signed?.forEach((s, i) => {
        if (s.signedUrl) signedMap[toSign[i]] = s.signedUrl;
      });
    }
    const map: Record<string, string> = {};
    rows.forEach((p) => {
      const url = p.image_url ?? signedMap[p.storage_path];
      if (url) map[p.id] = url;
    });
    setUrls(map);
    setLoading(false);
  };

  // Keyed on the item *id*, not the row. The row is looked up from live state
  // each render, so depending on the object would re-fetch the gallery and clear
  // the user's selection every time anything about the item changed.
  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!itemId) return;
    setPicked(new Set());
    void loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, projectId]);

  const togglePick = (photoId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length || !user || !item) return;
    setUploading(true);
    const newPhotoIds: string[] = [];
    try {
      for (const raw of Array.from(files)) {
        try {
          const file = await compressImageFile(raw);
          const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
          const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("site-photos")
            .upload(path, file, { contentType: file.type });
          if (upErr) throw upErr;
          const thumbPath = await uploadPhotoThumbnail(path, file);
          const { data: row, error: insErr } = await supabase
            .from("photos")
            .insert({
              project_id: projectId,
              uploaded_by: user.id,
              storage_path: path,
              thumb_path: thumbPath,
              size_bytes: file.size,
              caption: file.name,
              phase: "untagged",
              taken_at: new Date().toISOString(),
            } as any)
            .select("id")
            .single();
          if (insErr || !row) {
            // Reclaim the orphaned upload - nothing references it, so no
            // delete path can ever reach it and storage usage won't count it.
            void supabase.storage.from("site-photos").remove(photoObjectPaths(path, thumbPath));
            throw insErr ?? new Error("Upload failed");
          }
          newPhotoIds.push(row.id);
        } catch (e: any) {
          toast.error(e?.message ?? "Upload failed");
        }
      }
      if (newPhotoIds.length) {
        // Auto-attach to the checklist item and refresh gallery
        const rows = newPhotoIds.map((photo_id) => ({
          item_id: item.id,
          photo_id,
          created_by: user.id,
        }));
        const { error } = await supabase.from("checklist_item_photos" as any).insert(rows);
        if (error) {
          toast.error(error.message);
        } else {
          toast.success(`Attached ${rows.length} photo${rows.length === 1 ? "" : "s"}`);
          onAttached();
        }
        await loadPhotos();
      }
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const save = async () => {
    if (!item || !user || picked.size === 0) return;
    setSaving(true);
    try {
      const rows = Array.from(picked).map((photo_id) => ({
        item_id: item.id,
        photo_id,
        created_by: user.id,
      }));
      const { error } = await supabase.from("checklist_item_photos" as any).insert(rows);
      if (error) throw error;
      toast.success(`Attached ${rows.length} photo${rows.length === 1 ? "" : "s"}`);
      onAttached();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to attach photos");
    } finally {
      setSaving(false);
    }
  };

  const busy = uploading;

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle className="truncate">
            Attach photos{item ? ` - ${item.label}` : ""}
          </DialogTitle>
        </DialogHeader>

        {/* Upload actions - always available */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border-[0.8px] border-dashed border-border bg-muted/30 p-3">
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={busy}
            onClick={() => uploadInputRef.current?.click()}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            Upload photo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="mr-1.5 h-4 w-4" />
            Take photo
          </Button>
          <span className="text-xs text-muted-foreground">
            New photos are attached automatically and added to the project gallery.
          </span>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : photos.length === 0 ? (
          <div className="rounded-xl border-[0.8px] border-dashed border-border bg-muted/20 py-8 text-center text-sm text-muted-foreground">
            No photos in this project yet - upload or take one above to attach it to this item.
          </div>
        ) : (
          <>
            <p className="text-xs font-medium text-muted-foreground">
              Or pick from existing project photos
            </p>
            <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
              {photos.map((p) => {
                const url = urls[p.id];
                const isAttached = alreadyAttached.includes(p.id);
                const isPicked = picked.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={isAttached}
                    onClick={() => togglePick(p.id)}
                    className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-all ${
                      isAttached
                        ? "border-emerald-500/60 opacity-50"
                        : isPicked
                          ? "border-primary"
                          : "border-transparent hover:border-border"
                    }`}
                  >
                    {url ? (
                      <img src={url} alt={p.caption ?? ""} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-muted" />
                    )}
                    {isAttached && (
                      <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20">
                        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      </div>
                    )}
                    {isPicked && !isAttached && (
                      <div className="absolute right-1 top-1 rounded-full bg-primary text-primary-foreground">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void save()} disabled={picked.size === 0 || saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Attach selected {picked.size > 0 ? `(${picked.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
