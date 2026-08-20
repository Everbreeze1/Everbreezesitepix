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
  Sparkles,
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
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/sitepix/client";
import { sharePhotoNative } from "@/lib/native-share";
import { mutateByIds } from "@/lib/chunked-ids";
import { ensureGlobalTag } from "@/hooks/use-tag-colors";
import { useConfirm } from "@/hooks/use-confirm";
import { useSidebar } from "@/components/ui/sidebar";
import { clampPhotosPerPage, useProfile } from "@/hooks/use-profile";
import { cleanCaption, sanitizeCaption } from "@sitepix/shared";
import { NewReportDialog } from "@/features/projects/components/NewReportDialog";
import { GenerateDocumentMenu } from "@/features/projects/components/GenerateDocumentMenu";

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
  /**
   * The one project every selected photo belongs to, or null when the
   * selection spans several.
   *
   * The Gallery is cross-project, so it can hand over a mixed selection. Most
   * of this bar does not care - a download, a tag, a print sheet, a hide or a
   * trash is per-photo either way. Reports and Generate do care: a report lives
   * on a project, so there is no honest answer to "which one" for a mixed set.
   * Those two are disabled and say why, rather than silently filing photos
   * under whichever project happened to sort first.
   */
  projectId: string | null;
  projectName: string;
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

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/**
 * Build the print sheet at the author's chosen page density.
 *
 * The old sheet was a hardcoded two-column grid of bare images: no captions,
 * no page breaks it controlled, and no relationship to `photos_per_page` - so
 * a company that files four-up got two-up whenever it printed, and the printout
 * did not match the PDF of the same photos. The page geometry here is US
 * Letter with half-inch margins, the same page the report renderer draws on
 * (612x792pt), and the 1/2/3-across and 2x2 arrangements are the ones the rest
 * of the app already describes in its own copy.
 */
function buildPrintDocument(photos: BulkPhoto[], perPage: 1 | 2 | 3 | 4, projectName: string) {
  const cols = perPage === 4 ? 2 : perPage;
  const rows = perPage === 4 ? 2 : 1;
  const pages: BulkPhoto[][] = [];
  for (let i = 0; i < photos.length; i += perPage) pages.push(photos.slice(i, i + perPage));

  const sheets = pages
    .map((chunk, idx) => {
      const cells = chunk
        .map((p) => {
          const caption = cleanCaption(p.caption);
          return `<figure><img src="${esc(p.url)}" alt="" />${
            caption ? `<figcaption>${esc(caption)}</figcaption>` : ""
          }</figure>`;
        })
        .join("");
      return `<section class="page"><header><span>${esc(projectName)}</span><span>${
        idx + 1
      } / ${pages.length}</span></header><div class="grid">${cells}</div></section>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${esc(projectName)} photos</title>
<style>
  @page { size: letter; margin: 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; background: #fff; }
  .page { display: flex; flex-direction: column; height: 10in; break-after: page; page-break-after: always; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  header { display: flex; justify-content: space-between; gap: 12px; font-size: 10px; color: #555;
           border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-bottom: 12px; }
  .grid { flex: 1; min-height: 0; display: grid; gap: 16px;
          grid-template-columns: repeat(${cols}, minmax(0, 1fr));
          grid-template-rows: repeat(${rows}, minmax(0, 1fr)); }
  figure { margin: 0; min-height: 0; display: flex; flex-direction: column;
           break-inside: avoid; page-break-inside: avoid; }
  img { flex: 1; min-height: 0; width: 100%; object-fit: contain; }
  figcaption { margin-top: 6px; font-size: 10px; color: #333; text-align: center;
               overflow-wrap: anywhere; }
</style></head><body>${sheets}</body></html>`;
}

/**
 * Print through a hidden iframe rather than a popup window.
 *
 * `window.open` + `document.write` is blocked by default in most browsers now,
 * so the old Print reported "Popup blocked" and did nothing. An iframe in the
 * current document needs no permission, and waiting on its images means the
 * print dialog never opens over half-loaded photos.
 */
async function printPhotos(photos: BulkPhoto[], perPage: 1 | 2 | 3 | 4, projectName: string) {
  const usable = photos.filter((p) => p.url);
  if (!usable.length) throw new Error("Those photos have no image to print");

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("title", "Print sheet");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  frame.srcdoc = buildPrintDocument(usable, perPage, projectName);
  document.body.appendChild(frame);

  try {
    await loaded;
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    if (!win || !doc) throw new Error("Could not build the print sheet");
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
      ),
    );
    // Removing the frame the instant print() returns cancels the job in the
    // browsers where the dialog is not modal, so teardown waits for afterprint
    // and keeps a timer as the backstop for the ones that never fire it.
    win.addEventListener("afterprint", () => frame.remove(), { once: true });
    window.setTimeout(() => frame.remove(), 120_000);
    win.focus();
    win.print();
  } catch (e) {
    frame.remove();
    throw e;
  }
}

export function PhotoBulkActionBar(props: Props) {
  const {
    projectId,
    projectName,
    userId,
    selectedIds,
    photosById,
    totalVisible,
    allExistingTags,
    onClear,
    onSelectAll,
    onRefresh,
  } = props;
  const confirm = useConfirm();
  const { profile } = useProfile();
  const { state: sidebarState, isMobile } = useSidebar();
  const barLeftOffset = isMobile
    ? 0
    : sidebarState === "collapsed"
      ? "var(--sidebar-width-icon)"
      : "var(--sidebar-width)";
  const count = selectedIds.length;
  const selectedPhotos = useMemo(
    () => selectedIds.map((id) => photosById.get(id)).filter(Boolean) as BulkPhoto[],
    [selectedIds, photosById],
  );
  const allHidden = selectedPhotos.length > 0 && selectedPhotos.every((p) => p.hidden);

  const [tagOpen, setTagOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [newReportOpen, setNewReportOpen] = useState(false);
  const [addToReportOpen, setAddToReportOpen] = useState(false);
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

  const doPrint = () =>
    withBusy("print", async () => {
      await printPhotos(
        selectedPhotos,
        clampPhotosPerPage(profile?.report_photos_per_page),
        projectName,
      );
    });

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

  return (
    <>
      {/*
        Offset by the sidebar. `inset-x-0` centred this across the whole
        viewport, so the bar sat on top of the logo and the top nav rows, and
        centred over the window rather than over the photos it acts on.

        The offset is read from `useSidebar` rather than hardcoded, because the
        rail is `collapsible="icon"`: a fixed 16rem would be wrong the moment
        anyone collapses it. On mobile the sidebar is a sheet over the content,
        so there is nothing to clear.
      */}
      <div
        style={{ left: barLeftOffset }}
        className="pointer-events-none fixed right-0 top-3 z-50 flex justify-center px-3 transition-[left] duration-200 ease-linear sm:top-4"
      >
        {/*
          1100 fitted the seven actions this bar shipped with. Generate is an
          eighth, and clearing the sidebar took 16rem of room away, so the row
          needed both a higher cap and tighter controls: measured at 1222px it
          wrapped on any window under 1500. The paddings and gaps below are
          trimmed to bring that to roughly 1120, which holds one row from a
          1440 laptop up. Narrower than that it wraps, which is what the
          flex-wrap is for.
        */}
        <div className="pointer-events-auto w-full max-w-[min(1280px,98vw)] rounded-2xl border border-border/70 bg-background/95 shadow-2xl ring-1 ring-primary/10 backdrop-blur-xl animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-3 sm:py-3">
            {/* Count pill */}
            <div className="flex items-center gap-2">
              <div className="flex h-10 items-center gap-1.5 rounded-xl bg-primary px-2.5 text-primary-foreground shadow-sm">
                <CheckSquare className="h-4 w-4" />
                <span className="text-sm font-semibold tabular-nums">{count}</span>
                <span className="text-xs font-medium opacity-90">Selected</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-10 rounded-xl px-2.5 text-xs font-medium"
                onClick={onSelectAll}
              >
                Select all {totalVisible}
              </Button>
            </div>

            <div className="mx-1 hidden h-8 w-px bg-border sm:block" />

            {/* Primary actions */}
            <div className="flex flex-1 flex-wrap items-center gap-1">
              <ActionBtn
                label="Download"
                icon={Download}
                onClick={doDownload}
                busy={busy === "dl"}
              />
              <ActionBtn label="Tag" icon={TagIcon} onClick={() => setTagOpen(true)} />
              <ActionBtn label="Print" icon={Printer} onClick={doPrint} busy={busy === "print"} />
              <ActionBtn label="Share" icon={Share2} onClick={doShare} busy={busy === "share"} />

              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={!projectId}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!projectId}
                    title={
                      projectId
                        ? "Report"
                        : "These photos are from more than one project. Narrow the selection to one to build a report."
                    }
                    className="h-11 gap-1.5 rounded-xl px-2.5 hover:bg-muted"
                  >
                    <FileText className="h-[18px] w-[18px]" />
                    <span className="hidden text-sm font-medium sm:inline">Report</span>
                  </Button>
                </DropdownMenuTrigger>
                {/*
                  Both items hand off to the report flow the rest of the app
                  uses. "Create from template" used to be a third entry here
                  that listed existing *reports* and copied their settings - it
                  never touched the template library at all. The New Report
                  dialog's "Start from" grid is the real one: built-in starters,
                  your team's saved templates, and the Pro gate.
                */}
                <DropdownMenuContent align="center" side="bottom" className="w-72">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Reports
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setNewReportOpen(true)}>
                    <FilePlus2 className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <span className="block font-medium">New report</span>
                      <span className="block text-xs text-muted-foreground">
                        Blank or from a template, with cover page and layout
                      </span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAddToReportOpen(true)}>
                    <FolderPlus className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <span className="block font-medium">Add to existing report</span>
                      <span className="block text-xs text-muted-foreground">
                        Files them as one section, at that report's density
                      </span>
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/*
                The same menu the project header and the Documents tab mount,
                so "generate something from these photos" means one thing
                everywhere. It opens its own photo picker with this selection
                already ticked rather than asking for the photos twice.
              */}
              {projectId ? (
                <GenerateDocumentMenu
                  projectId={projectId}
                  photoIds={selectedIds}
                  align="start"
                  trigger={
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-11 gap-1.5 rounded-xl px-2.5 hover:bg-muted"
                    >
                      <Sparkles className="h-[18px] w-[18px]" />
                      <span className="hidden text-sm font-medium sm:inline">Generate</span>
                    </Button>
                  }
                />
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled
                  title="These photos are from more than one project. Narrow the selection to one to generate a document."
                  className="h-11 gap-1.5 rounded-xl px-2.5 hover:bg-muted"
                >
                  <Sparkles className="h-[18px] w-[18px]" />
                  <span className="hidden text-sm font-medium sm:inline">Generate</span>
                </Button>
              )}

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
              className="h-10 gap-1.5 rounded-xl px-2.5 text-muted-foreground hover:text-foreground"
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

      {/* Both report dialogs are project-scoped, and the Report button that
          opens them is disabled without one, so they simply do not mount. */}
      {projectId && (
        <NewReportDialog
          open={newReportOpen}
          onOpenChange={setNewReportOpen}
          projectId={projectId}
          projectName={projectName}
          attachPhotos={selectedPhotos.map((p) => ({ id: p.id, caption: p.caption }))}
        />
      )}

      {/*
        Neither dialog clears the selection on success: both open the report
        builder, which unmounts this project screen and its selection with it.
        Clearing first would unmount the open dialog mid-submit.
      */}
      {projectId && (
        <AddToReportDialog
          open={addToReportOpen}
          onClose={() => setAddToReportOpen(false)}
          projectId={projectId}
          selectedPhotos={selectedPhotos}
        />
      )}
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
      className={`h-11 gap-1.5 rounded-xl px-2.5 transition-all hover:bg-muted hover:shadow-sm ${
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
  projectId: string | null;
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
      // Hiding the source project keeps the list to real destinations. A mixed
      // selection has no single source, so every project is a real destination.
      const query = supabase.from("projects").select("id, name");
      const { data } = await (projectId ? query.neq("id", projectId) : query)
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
              {projectId ? "No other projects found." : "No projects found."}
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

// ── Add-to-existing-report dialog ──────────────────────────────────────────
interface ReportOption {
  id: string;
  title: string;
  created_at: string;
  photos_per_page: number | null;
}

/** What the PDF renderer will actually use, whatever the column holds. */
function densityOf(r: ReportOption) {
  return Math.min(4, Math.max(1, Number(r.photos_per_page ?? 2)));
}

function AddToReportDialog({
  open,
  onClose,
  projectId,
  selectedPhotos,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  selectedPhotos: BulkPhoto[];
}) {
  const navigate = useNavigate();
  const [reports, setReports] = useState<ReportOption[]>([]);
  const [reportId, setReportId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReportId("");
    setLoading(true);
    (async () => {
      const { data } = await (supabase as any)
        .from("project_reports")
        .select("id, title, created_at, photos_per_page")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      setReports((data as ReportOption[]) ?? []);
      setLoading(false);
    })();
  }, [open, projectId]);

  const target = reports.find((r) => r.id === reportId);

  /*
   * One section, not one section per N photos.
   *
   * This used to ask for a "photos per section" size and chunk the selection
   * into sections called "Photos 1-4", "Photos 5-8" and so on, which is how
   * page density worked before the report renderer paginated. It does now:
   * `planSectionPages` fills pages from a section's photo list at the report's
   * own `photos_per_page`, so chunking here only ever added headings nobody
   * asked for and fought the layout the author picked.
   */
  const submit = async () => {
    if (!reportId) return;
    setSaving(true);
    try {
      const { data: secRows, error: secErr } = await (supabase as any)
        .from("project_report_sections")
        .select("id, position, title, photos")
        .eq("report_id", reportId)
        .order("position", { ascending: true });
      if (secErr) throw secErr;
      const existing = (secRows as any[]) ?? [];

      // A photo filed twice renders twice in the PDF, so a repeat drop of an
      // overlapping selection adds only what is new.
      const already = new Set<string>();
      existing.forEach((s) =>
        (s.photos ?? []).forEach((p: any) => p?.photo_id && already.add(p.photo_id)),
      );
      const fresh = selectedPhotos.filter((p) => !already.has(p.id));
      if (fresh.length === 0) {
        toast.info("Those photos are already in this report");
        setSaving(false);
        return;
      }

      // "Photos", then "Photos 2" - a second drop should not collide with the first.
      const priorDrops = existing.filter((s) =>
        /^Photos( \d+)?$/.test(String(s.title ?? "")),
      ).length;
      const sectionTitle = priorDrops === 0 ? "Photos" : `Photos ${priorDrops + 1}`;
      const nextPos = existing.reduce((max, s) => Math.max(max, Number(s.position) || 0), -1) + 1;

      const { error } = await (supabase as any).from("project_report_sections").insert({
        report_id: reportId,
        position: nextPos,
        title: sectionTitle,
        body: null,
        photos: fresh.map((p) => ({ photo_id: p.id, caption: sanitizeCaption(p.caption) })),
      });
      if (error) throw error;

      const skipped = selectedPhotos.length - fresh.length;
      toast.success(`${fresh.length} photo${fresh.length > 1 ? "s" : ""} added to the report`, {
        description: skipped
          ? `${skipped} already in it, so ${skipped > 1 ? "they were" : "it was"} skipped.`
          : undefined,
      });
      onClose();
      navigate({
        to: "/projects/$projectId/reports/$reportId",
        params: { projectId, reportId },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add to report");
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
          <DialogTitle>Add to existing report</DialogTitle>
          <DialogDescription>
            {selectedPhotos.length} photo{selectedPhotos.length > 1 ? "s" : ""} will be appended as
            one section. The report's own page layout decides how they are laid out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Report
          </label>
          <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-border p-1">
            {loading ? (
              <div className="flex items-center justify-center p-6 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : reports.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                No reports yet on this project. Use New report instead.
              </p>
            ) : (
              reports.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReportId(r.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
                    reportId === r.id ? "bg-primary/10" : "hover:bg-muted"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {new Date(r.created_at).toLocaleDateString()} · {densityOf(r)} per page
                    </span>
                  </span>
                  {reportId === r.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              ))
            )}
          </div>
          {target && (
            <p className="text-[11px] text-muted-foreground">
              {selectedPhotos.length} photo{selectedPhotos.length > 1 ? "s" : ""} at{" "}
              {densityOf(target)} per page fills{" "}
              {Math.ceil(selectedPhotos.length / densityOf(target))} page
              {Math.ceil(selectedPhotos.length / densityOf(target)) > 1 ? "s" : ""}. Change the
              density in the builder.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !reportId}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Add to report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
