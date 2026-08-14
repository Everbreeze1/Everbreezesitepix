import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Printer,
  Share2,
  FileText,
  FilePlus2,
  FolderPlus,
  Eye,
  EyeOff,
  MoveRight,
  Trash2,
  Tag as TagIcon,
  X,
  CheckSquare,
  Loader2,
  Plus,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/sitepix/client";
import { sharePhotoNative } from "@/lib/native-share";
import { mutateByIds } from "@/lib/chunked-ids";
import { ensureGlobalTag } from "@/hooks/use-tag-colors";
import { useConfirm } from "@/hooks/use-confirm";
import { sanitizeCaption } from "@sitepix/shared";

export interface BulkPhoto {
  id: string;
  url: string;
  caption: string | null;
  taken_at: string | null;
  created_at: string;
  hidden?: boolean;
  tags?: string[];
}

interface Props {
  projectId: string;
  userId: string | null;
  selectedIds: string[];
  photosById: Map<string, BulkPhoto>;
  totalVisible: number;
  allExistingTags: string[];
  onClear: () => void;
  onSelectAll: () => void;
  onRefresh: () => void;
}

async function downloadOne(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1500);
}

function printPhotos(urls: string[]) {
  const w = window.open("", "_blank");
  if (!w) {
    toast.error("Popup blocked");
    return;
  }
  w.document.write(`<!doctype html><html><head><title>Print photos</title>
    <style>
      body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111}
      .g{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px}
      img{width:100%;height:auto;break-inside:avoid;page-break-inside:avoid;border:1px solid #eee;border-radius:8px}
      @media print{.g{gap:8px;padding:8px}}
    </style></head><body>
    <div class="g">${urls.map((u) => `<img src="${u}" />`).join("")}</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),400)</script>
    </body></html>`);
  w.document.close();
}

export function PhotoBulkActionBar(props: Props) {
  const {
    projectId,
    userId,
    selectedIds,
    photosById,
    totalVisible,
    allExistingTags,
    onClear,
    onSelectAll,
    onRefresh,
  } = props;
  const navigate = useNavigate();
  const confirm = useConfirm();
  const count = selectedIds.length;
  const selectedPhotos = useMemo(
    () => selectedIds.map((id) => photosById.get(id)).filter(Boolean) as BulkPhoto[],
    [selectedIds, photosById],
  );
  const allHidden = selectedPhotos.length > 0 && selectedPhotos.every((p) => p.hidden);

  const [tagOpen, setTagOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState<null | "new" | "template" | "existing">(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (count === 0) return null;

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const doDownload = () =>
    withBusy("dl", async () => {
      for (const p of selectedPhotos) {
        if (!p.url) continue;
        const name =
          // `-` is last in the class, so it is a literal and needs no escape.
          (p.caption?.replace(/[^\w.-]+/g, "_") || `photo_${p.id.slice(0, 8)}`) + ".jpg";
        await downloadOne(p.url, name);
      }
      toast.success(`${count} photo${count > 1 ? "s" : ""} downloaded`);
    });

  const doPrint = () => printPhotos(selectedPhotos.map((p) => p.url).filter(Boolean));

  const doShare = () =>
    withBusy("share", async () => {
      if (count === 1 && selectedPhotos[0]?.url) {
        await sharePhotoNative({
          url: selectedPhotos[0].url,
          title: selectedPhotos[0].caption ?? "Photo",
        });
        return;
      }
      const links = selectedPhotos
        .map((p) => p.url)
        .filter(Boolean)
        .join("\n");
      try {
        await navigator.clipboard.writeText(links);
        toast.success(`${count} links copied to clipboard`);
      } catch {
        toast.error("Could not copy links");
      }
    });

  const doHideToggle = () =>
    withBusy("hide", async () => {
      const next = !allHidden;
      // Batched - "Select all" is unbounded and a single `.in()` past ~670 ids
      // is rejected by the gateway on URI length. See lib/chunked-ids.ts.
      await mutateByIds(selectedIds, (idChunk) =>
        (supabase as any).from("photos").update({ hidden: next }).in("id", idChunk),
      );
      toast.success(next ? `${count} hidden from timeline` : `${count} restored to timeline`);
      onRefresh();
    });

  const doTrash = () =>
    withBusy("trash", async () => {
      if (
        !(await confirm({
          description: `Move ${count} photo${count > 1 ? "s" : ""} to Trash?`,
          variant: "destructive",
        }))
      )
        return;
      await mutateByIds(selectedIds, (idChunk) =>
        (supabase as any)
          .from("photos")
          .update({ deleted_at: new Date().toISOString() })
          .in("id", idChunk),
      );
      toast.success(`${count} moved to Trash`);
      onClear();
      onRefresh();
    });

  // "Create new report" opens the dialog so the user can pick photos-per-section.

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4">
        <div className="pointer-events-auto w-full max-w-[min(1100px,98vw)] rounded-2xl border border-border/70 bg-background/95 shadow-2xl ring-1 ring-primary/10 backdrop-blur-xl animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
            {/* Count pill */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 items-center gap-2 rounded-xl bg-primary px-3 text-primary-foreground shadow-sm">
                <CheckSquare className="h-4 w-4" />
                <span className="text-sm font-semibold tabular-nums">{count}</span>
                <span className="text-xs font-medium opacity-90">Selected</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-10 rounded-xl px-3 text-xs font-medium"
                onClick={onSelectAll}
              >
                Select all {totalVisible}
              </Button>
            </div>

            <div className="mx-1 hidden h-8 w-px bg-border sm:block" />

            {/* Primary actions */}
            <div className="flex flex-1 flex-wrap items-center gap-1.5">
              <ActionBtn
                label="Download"
                icon={Download}
                onClick={doDownload}
                busy={busy === "dl"}
              />
              <ActionBtn label="Tag" icon={TagIcon} onClick={() => setTagOpen(true)} />
              <ActionBtn label="Print" icon={Printer} onClick={doPrint} />
              <ActionBtn label="Share" icon={Share2} onClick={doShare} busy={busy === "share"} />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-11 gap-2 rounded-xl px-3 hover:bg-muted"
                  >
                    <FileText className="h-[18px] w-[18px]" />
                    <span className="hidden text-sm font-medium sm:inline">Report</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="bottom" className="w-60">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Reports
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setReportOpen("new")}>
                    <FilePlus2 className="mr-2 h-4 w-4" />
                    Create new report
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setReportOpen("template")}>
                    <FileText className="mr-2 h-4 w-4" />
                    Create from template
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setReportOpen("existing")}>
                    <FolderPlus className="mr-2 h-4 w-4" />
                    Add to existing report
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="mx-1 h-8 w-px bg-border" />

              <ActionBtn
                label={allHidden ? "Unhide" : "Hide"}
                icon={allHidden ? Eye : EyeOff}
                onClick={doHideToggle}
                busy={busy === "hide"}
              />
              <ActionBtn label="Move" icon={MoveRight} onClick={() => setMoveOpen(true)} />
              <ActionBtn
                label="Trash"
                icon={Trash2}
                onClick={doTrash}
                busy={busy === "trash"}
                danger
              />
            </div>

            <div className="mx-1 hidden h-8 w-px bg-border sm:block" />

            <Button
              size="sm"
              variant="ghost"
              className="h-10 gap-1.5 rounded-xl px-3 text-muted-foreground hover:text-foreground"
              onClick={onClear}
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
              <span className="hidden text-xs font-medium sm:inline">Clear</span>
            </Button>
          </div>
        </div>
      </div>

      <BulkTagDialog
        open={tagOpen}
        onClose={() => setTagOpen(false)}
        selectedPhotos={selectedPhotos}
        allExistingTags={allExistingTags}
        userId={userId}
        onDone={() => {
          setTagOpen(false);
          onRefresh();
        }}
      />

      <MoveDialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        projectId={projectId}
        selectedIds={selectedIds}
        onDone={() => {
          setMoveOpen(false);
          onClear();
          onRefresh();
        }}
      />

      <ReportBulkDialog
        mode={reportOpen}
        onClose={() => setReportOpen(null)}
        projectId={projectId}
        userId={userId}
        selectedPhotos={selectedPhotos}
      />
    </>
  );
}

function ActionBtn({
  label,
  icon: Icon,
  onClick,
  busy,
  danger,
}: {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={busy}
      className={`h-11 gap-2 rounded-xl px-3 transition-all hover:bg-muted hover:shadow-sm ${
        danger ? "text-destructive hover:bg-destructive/10 hover:text-destructive" : ""
      }`}
      title={label}
    >
      {busy ? (
        <Loader2 className="h-[18px] w-[18px] animate-spin" />
      ) : (
        <Icon className="h-[18px] w-[18px]" />
      )}
      <span className="hidden text-sm font-medium sm:inline">{label}</span>
    </Button>
  );
}

// ── Bulk tag dialog ────────────────────────────────────────────────────────
function BulkTagDialog({
  open,
  onClose,
  selectedPhotos,
  allExistingTags,
  userId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  selectedPhotos: BulkPhoto[];
  allExistingTags: string[];
  userId: string | null;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setPicked([]);
      setNewTag("");
    }
  }, [open]);

  const toggle = (t: string) =>
    setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const apply = async () => {
    const toApply = [...picked];
    const nt = newTag.trim().toLowerCase();
    if (nt && !toApply.includes(nt)) toApply.push(nt);
    if (toApply.length === 0) return;
    setSaving(true);
    try {
      for (const t of toApply) await ensureGlobalTag(t, undefined, userId);
      for (const p of selectedPhotos) {
        const merged = Array.from(new Set([...(p.tags ?? []), ...toApply]));
        const { error } = await (supabase as any)
          .from("photos")
          .update({ tags: merged })
          .eq("id", p.id);
        if (error) throw error;
      }
      toast.success(`Tagged ${selectedPhotos.length} photo${selectedPhotos.length > 1 ? "s" : ""}`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not apply tags");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Add tags to {selectedPhotos.length} photo{selectedPhotos.length > 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Tags will be merged with any tags already on the photos.
          </DialogDescription>
        </DialogHeader>
        {allExistingTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {allExistingTags.map((t) => {
              const on = picked.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggle(t)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition ${
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-foreground/40"
                  }`}
                >
                  {on && <Check className="h-3 w-3" />}#{t}
                </button>
              );
            })}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
          className="flex items-center gap-2"
        >
          <Input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="New tag…"
            className="h-9"
            maxLength={32}
          />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={saving || (picked.length === 0 && !newTag.trim())}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Apply tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Move-to-project dialog ─────────────────────────────────────────────────
function MoveDialog({
  open,
  onClose,
  projectId,
  selectedIds,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  selectedIds: string[];
  onDone: () => void;
}) {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setTarget("");
    setQ("");
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .neq("id", projectId)
        .order("updated_at", { ascending: false })
        .limit(200);
      setProjects((data as any[]) ?? []);
      setLoading(false);
    })();
  }, [open, projectId]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? projects.filter((p) => p.name.toLowerCase().includes(term)) : projects;
  }, [projects, q]);

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await mutateByIds(selectedIds, (idChunk) =>
        (supabase as any).from("photos").update({ project_id: target }).in("id", idChunk),
      );
    } catch (error: any) {
      setSaving(false);
      toast.error(error?.message ?? "Could not move photos");
      return;
    }
    setSaving(false);
    toast.success(`Moved ${selectedIds.length} photo${selectedIds.length > 1 ? "s" : ""}`);
    onDone();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Move {selectedIds.length} photo{selectedIds.length > 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Pick the destination project. Photos keep their tags and captions.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search projects…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9"
        />
        <div className="max-h-64 space-y-1 overflow-auto rounded-lg border border-border p-1">
          {loading ? (
            <div className="flex items-center justify-center p-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              No other projects found.
            </p>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setTarget(p.id)}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${
                  target === p.id ? "bg-primary/10 text-foreground" : "hover:bg-muted"
                }`}
              >
                <span className="truncate">{p.name}</span>
                {target === p.id && <Check className="h-4 w-4 text-primary" />}
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!target || saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MoveRight className="mr-2 h-4 w-4" />
            )}
            Move photos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Report bulk dialog ─────────────────────────────────────────────────────
function ReportBulkDialog({
  mode,
  onClose,
  projectId,
  userId,
  selectedPhotos,
}: {
  mode: null | "new" | "template" | "existing";
  onClose: () => void;
  projectId: string;
  userId: string | null;
  selectedPhotos: BulkPhoto[];
}) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [reports, setReports] = useState<Array<{ id: string; title: string; created_at: string }>>(
    [],
  );
  const [reportId, setReportId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Photos per section - also drives the report's photos-per-page layout
  // (clamped to 1..4 for PDF layout density).
  const [perSection, setPerSection] = useState<number>(4);

  useEffect(() => {
    if (!mode) return;
    setTitle(`Report - ${new Date().toLocaleDateString()}`);
    setReportId("");
    setPerSection(4);
    if (mode === "template" || mode === "existing") {
      setLoading(true);
      (async () => {
        const { data } = await (supabase as any)
          .from("project_reports")
          .select("id, title, created_at, photos_per_page")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });
        setReports((data as any[]) ?? []);
        setLoading(false);
      })();
    }
  }, [mode, projectId]);

  // Split selectedPhotos into chunks of `perSection` and insert one section per chunk.
  const insertSections = async (rid: string, startPos: number) => {
    const size = Math.max(1, Math.min(24, perSection));
    const chunks: BulkPhoto[][] = [];
    for (let i = 0; i < selectedPhotos.length; i += size) {
      chunks.push(selectedPhotos.slice(i, i + size));
    }
    const total = chunks.length;
    const rows = chunks.map((chunk, idx) => ({
      report_id: rid,
      position: startPos + idx,
      title:
        total > 1
          ? `Photos ${idx * size + 1}–${idx * size + chunk.length}`
          : `${chunk.length} photo${chunk.length > 1 ? "s" : ""}`,
      body: null,
      photos: chunk.map((p) => ({ photo_id: p.id, caption: sanitizeCaption(p.caption) })),
    }));
    const { error } = await (supabase as any).from("project_report_sections").insert(rows);
    if (error) throw error;
  };

  const submit = async () => {
    if (!userId) return;
    setSaving(true);
    try {
      let rid = reportId;
      // Layout density for the PDF: clamp to 1..4 since that's what the renderer supports.
      const layoutPerPage = Math.max(1, Math.min(4, perSection));
      if (mode === "new") {
        const { data, error } = await (supabase as any)
          .from("project_reports")
          .insert({
            project_id: projectId,
            created_by: userId,
            title: title.trim() || "Report",
            summary: null,
            photo_ids: [],
            include_project_info: true,
            allow_download: true,
            photos_per_page: layoutPerPage,
          })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("Could not create report");
        rid = data.id;
      } else if (mode === "template") {
        if (!reportId) throw new Error("Pick a template report");
        const { data: tmpl, error: tErr } = await (supabase as any)
          .from("project_reports")
          .select("*")
          .eq("id", reportId)
          .maybeSingle();
        if (tErr || !tmpl) throw tErr ?? new Error("Template not found");
        const { data, error } = await (supabase as any)
          .from("project_reports")
          .insert({
            project_id: projectId,
            created_by: userId,
            title: title.trim() || `${tmpl.title} (copy)`,
            summary: null,
            photo_ids: [],
            include_project_info: tmpl.include_project_info,
            allow_download: tmpl.allow_download,
            photos_per_page: layoutPerPage,
            cover_enabled: tmpl.cover_enabled,
            cover_show_project_name: tmpl.cover_show_project_name,
            cover_show_address: tmpl.cover_show_address,
            cover_show_date: tmpl.cover_show_date,
            cover_show_author: tmpl.cover_show_author,
          })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("Could not create report");
        rid = data.id;
      } else if (mode === "existing") {
        if (!reportId) throw new Error("Pick a report");
        rid = reportId;
      }
      // Compute the starting position for the new sections.
      const { data: existing } = await (supabase as any)
        .from("project_report_sections")
        .select("position")
        .eq("report_id", rid)
        .order("position", { ascending: false })
        .limit(1);
      const nextPos = ((existing as any[])?.[0]?.position ?? -1) + 1;
      await insertSections(rid, nextPos);
      toast.success(
        mode === "existing"
          ? "Added to report - opening builder…"
          : "Report created - opening builder…",
      );
      onClose();
      navigate({
        to: "/projects/$projectId/reports/$reportId",
        params: { projectId, reportId: rid },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!mode}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "new"
              ? "New report"
              : mode === "template"
                ? "Create from template"
                : "Add to existing report"}
          </DialogTitle>
          <DialogDescription>
            {(() => {
              const size = Math.max(1, Math.min(24, perSection));
              const chunks = Math.ceil(selectedPhotos.length / size);
              return `${selectedPhotos.length} photo${selectedPhotos.length > 1 ? "s" : ""} will be split into ${chunks} section${chunks > 1 ? "s" : ""} of up to ${size}.`;
            })()}
          </DialogDescription>
        </DialogHeader>

        {mode === "new" && (
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Report title
            </label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-9" />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Photos per section
          </label>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 6, 8, 12].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPerSection(n)}
                className={`h-8 min-w-9 rounded-md border px-2.5 text-sm transition ${
                  perSection === n
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Values above 4 keep the PDF layout at 4 photos per page.
          </p>
        </div>

        {(mode === "template" || mode === "existing") && (
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {mode === "template" ? "Copy settings from" : "Report"}
            </label>
            {mode === "template" && (
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New report title"
                className="h-9"
              />
            )}
            <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-border p-1">
              {loading ? (
                <div className="flex items-center justify-center p-6 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : reports.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  No reports yet on this project.
                </p>
              ) : (
                reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setReportId(r.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition ${
                      reportId === r.id ? "bg-primary/10" : "hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{r.title}</span>
                    {reportId === r.id && <Check className="h-4 w-4 text-primary" />}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving || ((mode === "template" || mode === "existing") && !reportId)}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {mode === "existing" ? "Add to report" : "Create report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
