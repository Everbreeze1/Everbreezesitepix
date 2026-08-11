import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  FileText,
  Upload,
  MoreHorizontal,
  Download,
  Trash2,
  Loader2,
  Folder,
  FolderPlus,
  FilePlus2,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Move,
  Pencil,
  Copy,
  Share2,
  FileDown,
  Search,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { usePrompt } from "@/hooks/use-prompt";
import { toast } from "sonner";
import { formatBytes } from "@/hooks/use-storage-usage";
import { MAX_UPLOAD_BYTES, isOverUploadLimit } from "@/lib/upload-limits";
import { uploadWithResume } from "@/lib/resumable-upload";
import { relativeTime } from "@sitepix/shared";
import { BlueprintItemBadge } from "./BlueprintItemBadge";
import { downloadBase64File } from "@/lib/download-file";
import { type ReportPhotoRef } from "@/features/projects/components/ProjectReports";
import {
  listProjectDocumentTree,
  createDocumentFolder,
  deleteDocumentFolder,
  updateProjectPage,
  deleteProjectPage,
  duplicateProjectPage,
  getProjectPage,
  setProjectPageShare,
  generatePagePdf,
  moveDocument,
  type DocumentTree,
  type DocumentTreeFolder,
} from "@/lib/project-pages.functions";
import { GenerateDocumentMenu } from "@/features/projects/components/GenerateDocumentMenu";

interface ProjectDocument {
  id: string;
  project_id: string;
  uploaded_by: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
  folder_id: string | null;
}

interface Props {
  projectId: string;
  projectName: string;
  projectPhotos: ReportPhotoRef[];
  /**
   * Source template id → the blueprint that brought it in. Keyed on a page's
   * `sourceTemplateId`, so only pages created from a document template that a
   * blueprint actually contains are badged.
   */
  blueprintSources?: Record<string, { blueprintId: string | null; blueprintName: string | null }>;
  onChanged?: () => void;
}

type TypeFilter = "all" | "pages" | "files";
type SortKey = "name" | "type" | "updated";

function fileTypeLabel(mime: string | null, fileName: string) {
  const lower = fileName.toLowerCase();
  if (mime?.includes("pdf") || lower.endsWith(".pdf")) return "PDF document";
  if (mime?.startsWith("image/")) return "Image";
  if (mime?.includes("word") || lower.endsWith(".doc") || lower.endsWith(".docx"))
    return "Word document";
  if (mime?.includes("sheet") || lower.endsWith(".xls") || lower.endsWith(".xlsx"))
    return "Spreadsheet";
  const ext = fileName.includes(".") ? fileName.split(".").pop() : null;
  return ext ? `${ext.toUpperCase()} file` : "File";
}

function MoveToFolderSubmenu({
  folders,
  currentFolderId,
  onMove,
}: {
  folders: DocumentTreeFolder[];
  currentFolderId: string | null;
  onMove: (folderId: string | null) => void;
}) {
  if (folders.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Move className="mr-2 h-4 w-4" /> Move to…
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent>
          {currentFolderId && (
            <DropdownMenuItem onClick={() => onMove(null)}>Top level</DropdownMenuItem>
          )}
          {folders
            .filter((f) => f.id !== currentFolderId)
            .map((f) => (
              <DropdownMenuItem key={f.id} onClick={() => onMove(f.id)}>
                {f.name}
              </DropdownMenuItem>
            ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export function ProjectDocuments({
  projectId,
  projectName,
  projectPhotos,
  blueprintSources,
  onChanged,
}: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [tree, setTree] = useState<DocumentTree | null>(null);
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  /** Which file of the batch is transferring, and how far along. Null when idle. */
  const [uploadStatus, setUploadStatus] = useState<{
    index: number;
    total: number;
    percent: number;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [sharePage, setSharePage] = useState<{ id: string; title: string } | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareUpdating, setShareUpdating] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareRevoked, setShareRevoked] = useState(true);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [bulkExporting, setBulkExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [t, { data: docRows, error }] = await Promise.all([
        listProjectDocumentTree({ data: { projectId } }),
        (supabase as any)
          .from("project_documents")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false }),
      ]);
      if (error) toast.error("Couldn't load documents", { description: error.message });
      setTree(t);
      setDocuments((docRows ?? []) as ProjectDocument[]);
    } catch (e: any) {
      toast.error("Couldn't load documents", { description: e?.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, projectId]);

  useEffect(() => {
    setSelectedPageIds(new Set());
    setSelectedFileIds(new Set());
  }, [currentFolderId]);

  async function uploadFiles(files: FileList | File[]) {
    if (!user) return;
    const list = Array.from(files);
    if (!list.length) return;

    /*
     * Sort before uploading anything. The picker hands over whatever the OS will
     * give it — this is the only input in the app not restricted to images, so a
     * multi-GB video from the camera roll can land here. Splitting up front
     * means oversized files are reported immediately instead of interrupting
     * progress on the others, and the counter below reflects what will actually
     * be attempted.
     */
    const queue: File[] = [];
    for (const file of list) {
      if (isOverUploadLimit(file.size)) {
        toast.error(
          `${file.name} is ${formatBytes(file.size)}, over the ${formatBytes(
            MAX_UPLOAD_BYTES,
          )} upload limit — skipped.`,
        );
        continue;
      }
      queue.push(file);
    }
    if (!queue.length) {
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    setUploading(true);
    let added = 0;
    try {
      for (const [index, file] of queue.entries()) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${user.id}/${projectId}/${crypto.randomUUID()}-${safeName}`;
        try {
          // Resumable above one chunk: a big blueprint PDF over site LTE has the
          // same failure mode as a walkthrough video, and the same fix.
          await uploadWithResume({
            bucket: "site-documents",
            path,
            blob: file,
            contentType: file.type || "application/octet-stream",
            onProgress: (p) =>
              setUploadStatus({ index: index + 1, total: queue.length, percent: p.percent }),
          });
        } catch (upErr: any) {
          toast.error(`${file.name}: ${upErr?.message ?? "upload failed"}`);
          continue;
        }
        const { error: insErr } = await (supabase as any).from("project_documents").insert({
          project_id: projectId,
          uploaded_by: user.id,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          folder_id: currentFolderId,
        });
        if (insErr) {
          toast.error(`${file.name}: ${insErr.message}`);
          // Reclaim the orphaned upload: with no `project_documents` row
          // pointing at it, every delete path in this file — which all key off
          // `storage_path` — is permanently unable to find it.
          void supabase.storage.from("site-documents").remove([path]);
          continue;
        }
        added++;
      }
      // Count what actually landed. Reporting `list.length` claimed success for
      // files that were skipped for size or failed to upload.
      if (added) toast.success(added > 1 ? `${added} documents added` : "Document added");
      await load();
      onChanged?.();
    } finally {
      setUploading(false);
      setUploadStatus(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function downloadDocument(doc: ProjectDocument) {
    const { data, error } = await supabase.storage
      .from("site-documents")
      .createSignedUrl(doc.storage_path, 60);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Couldn't open document");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function renameDocument(doc: ProjectDocument) {
    const name = await prompt({ title: "Rename document", defaultValue: doc.file_name });
    if (!name?.trim() || name.trim() === doc.file_name) return;
    const { error } = await (supabase as any)
      .from("project_documents")
      .update({ file_name: name.trim() })
      .eq("id", doc.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Document renamed");
    await load();
  }

  async function deleteDocument(doc: ProjectDocument) {
    if (
      !(await confirm({
        description: `Delete "${doc.file_name}"? This can't be undone.`,
        variant: "destructive",
      }))
    )
      return;
    const prev = documents;
    setDocuments((ds) => ds.filter((d) => d.id !== doc.id));
    const { error } = await (supabase as any).from("project_documents").delete().eq("id", doc.id);
    if (error) {
      setDocuments(prev);
      toast.error(error.message);
      return;
    }
    void supabase.storage.from("site-documents").remove([doc.storage_path]);
    toast.success("Document deleted");
    onChanged?.();
  }

  async function handleCreateFolder() {
    const name = await prompt({ title: "New folder", label: "Folder name" });
    if (!name?.trim()) return;
    try {
      await createDocumentFolder({ data: { projectId, name: name.trim() } });
      toast.success("Folder created");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create folder");
    }
  }

  async function handleDeleteFolder(folderId: string) {
    if (
      !(await confirm({
        description: "Delete this folder? Its contents move back to the top level.",
        variant: "destructive",
      }))
    )
      return;
    try {
      await deleteDocumentFolder({ data: { folderId } });
      if (currentFolderId === folderId) setCurrentFolderId(null);
      toast.success("Folder deleted");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete folder");
    }
  }

  async function handleMove(kind: "page" | "file", id: string, folderId: string | null) {
    try {
      await moveDocument({ data: { kind, id, folderId } });
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not move");
    }
  }

  async function handleRenamePage(pageId: string, currentTitle: string) {
    const title = await prompt({ title: "Rename page", defaultValue: currentTitle });
    if (!title?.trim() || title.trim() === currentTitle) return;
    try {
      await updateProjectPage({ data: { pageId, title: title.trim() } });
      toast.success("Page renamed");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not rename page");
    }
  }

  async function handleDuplicatePage(pageId: string) {
    try {
      const res = await duplicateProjectPage({ data: { pageId } });
      toast.success(`Duplicated as "${res.page.title}"`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not duplicate page");
    }
  }

  async function openSharePage(page: { id: string; title: string }) {
    setSharePage(page);
    setShareLoading(true);
    try {
      const res = await getProjectPage({ data: { pageId: page.id } });
      setShareToken(res.page.share_token);
      setShareRevoked(!!res.page.revoked_at);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load sharing status");
      setSharePage(null);
    } finally {
      setShareLoading(false);
    }
  }

  async function handleToggleShare(enable: boolean) {
    if (!sharePage) return;
    setShareUpdating(true);
    try {
      const res = await setProjectPageShare({ data: { pageId: sharePage.id, enable } });
      setShareToken(res.shareToken);
      setShareRevoked(!enable);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update sharing");
    } finally {
      setShareUpdating(false);
    }
  }

  async function copyShareLink() {
    if (!shareToken) return;
    const url = `${window.location.origin}/share/pages/${shareToken}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  }

  async function handleExportPagePdf(pageId: string) {
    setExportingId(pageId);
    try {
      const res = await generatePagePdf({ data: { pageId } });
      downloadBase64File(res.pdfBase64, res.filename);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not export PDF");
    } finally {
      setExportingId(null);
    }
  }

  async function handleDeletePage(pageId: string, title: string) {
    if (
      !(await confirm({
        description: `Delete "${title}"? This can't be undone.`,
        variant: "destructive",
      }))
    )
      return;
    try {
      await deleteProjectPage({ data: { pageId } });
      toast.success("Page deleted");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete page");
    }
  }

  function togglePageSelected(id: string) {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFileSelected(id: string) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedPageIds(new Set());
    setSelectedFileIds(new Set());
  }

  async function handleBulkDelete() {
    const count = selectedPageIds.size + selectedFileIds.size;
    if (!count) return;
    if (
      !(await confirm({
        description: `Delete ${count} item${count > 1 ? "s" : ""}? This can't be undone.`,
        variant: "destructive",
      }))
    )
      return;
    const pageIds = Array.from(selectedPageIds);
    const fileDocs = documents.filter((d) => selectedFileIds.has(d.id));
    try {
      await Promise.all([
        ...pageIds.map((id) => deleteProjectPage({ data: { pageId: id } })),
        ...fileDocs.map(async (doc) => {
          /*
           * The row delete has to be CONFIRMED before the blob is destroyed,
           * and `error === null` is not that confirmation. A delete with no
           * trailing `.select()` comes back 204 with an empty body, so an RLS
           * policy that filters every row away is indistinguishable from a
           * successful delete. `.select("id")` asks for the affected rows, so
           * an empty array means nothing was deleted and the file must be left
           * where it is — otherwise the row survives, its blob doesn't, and the
           * document 404s forever behind a success toast.
           */
          const { data: deleted, error } = await (supabase as any)
            .from("project_documents")
            .delete()
            .eq("id", doc.id)
            .select("id");
          if (error) throw error;
          if (!((deleted as unknown[] | null) ?? []).length)
            throw new Error(`You don't have permission to delete “${doc.file_name}”`);
          void supabase.storage.from("site-documents").remove([doc.storage_path]);
        }),
      ]);
      toast.success(`${count} item${count > 1 ? "s" : ""} deleted`);
      clearSelection();
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete the selected items");
      // A rejected batch is a PARTIAL batch — `Promise.all` abandons the other
      // deletes' results, and some will have succeeded. Resync rather than
      // leaving the list showing rows that are already gone.
      clearSelection();
      await load();
      onChanged?.();
    }
  }

  async function handleBulkMove(folderId: string | null) {
    const pageIds = Array.from(selectedPageIds);
    const fileIds = Array.from(selectedFileIds);
    try {
      await Promise.all([
        ...pageIds.map((id) => moveDocument({ data: { kind: "page", id, folderId } })),
        ...fileIds.map((id) => moveDocument({ data: { kind: "file", id, folderId } })),
      ]);
      toast.success("Moved");
      clearSelection();
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not move the selected items");
    }
  }

  async function handleBulkExportPdf() {
    const ids = Array.from(selectedPageIds);
    if (!ids.length) return;
    setBulkExporting(true);
    try {
      for (const id of ids) {
        const res = await generatePagePdf({ data: { pageId: id } });
        downloadBase64File(res.pdfBase64, res.filename);
      }
      toast.success(`Exported ${ids.length} PDF${ids.length > 1 ? "s" : ""}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not export the selected pages");
    } finally {
      setBulkExporting(false);
    }
  }

  const folders = (tree?.folders ?? []).filter(() => currentFolderId === null); // folders are flat, shown only at top level
  const q = search.trim().toLowerCase();

  const pagesInView = useMemo(() => {
    let list = (tree?.pages ?? []).filter((p) => p.folderId === currentFolderId);
    if (q) list = list.filter((p) => p.title.toLowerCase().includes(q));
    return list;
  }, [tree, currentFolderId, q]);

  const filesInView = useMemo(() => {
    let list = documents.filter((d) => d.folder_id === currentFolderId);
    if (q) list = list.filter((d) => d.file_name.toLowerCase().includes(q));
    return list;
  }, [documents, currentFolderId, q]);

  const sortedPages = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...pagesInView].sort((a, b) => {
      if (sortKey === "name") return a.title.localeCompare(b.title) * dir;
      if (sortKey === "updated") return (a.updatedAt < b.updatedAt ? -1 : 1) * dir;
      return 0; // "type" — pages and files are sorted as separate lists, nothing to compare within one
    });
  }, [pagesInView, sortKey, sortDir]);

  const sortedFiles = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filesInView].sort((a, b) => {
      if (sortKey === "name") return a.file_name.localeCompare(b.file_name) * dir;
      if (sortKey === "updated") return (a.created_at < b.created_at ? -1 : 1) * dir;
      if (sortKey === "type")
        return (
          fileTypeLabel(a.mime_type, a.file_name).localeCompare(
            fileTypeLabel(b.mime_type, b.file_name),
          ) * dir
        );
      return 0;
    });
  }, [filesInView, sortKey, sortDir]);

  const showPages = typeFilter !== "files";
  const showFiles = typeFilter !== "pages";
  const visiblePages = showPages ? sortedPages : [];
  const visibleFiles = showFiles ? sortedFiles : [];
  const currentFolder = tree?.folders.find((f) => f.id === currentFolderId) ?? null;
  const isEmpty = folders.length === 0 && visiblePages.length === 0 && visibleFiles.length === 0;

  const selectedCount = selectedPageIds.size + selectedFileIds.size;
  const selectableCount = visiblePages.length + visibleFiles.length;
  const allVisibleSelected =
    selectableCount > 0 &&
    visiblePages.every((p) => selectedPageIds.has(p.id)) &&
    visibleFiles.every((f) => selectedFileIds.has(f.id));
  const someVisibleSelected =
    visiblePages.some((p) => selectedPageIds.has(p.id)) ||
    visibleFiles.some((f) => selectedFileIds.has(f.id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      clearSelection();
    } else {
      setSelectedPageIds(new Set(visiblePages.map((p) => p.id)));
      setSelectedFileIds(new Set(visibleFiles.map((f) => f.id)));
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortHeader({ label, sortKeyValue }: { label: string; sortKeyValue: SortKey }) {
    const active = sortKey === sortKeyValue;
    return (
      <button
        type="button"
        onClick={() => toggleSort(sortKeyValue)}
        className={`flex items-center gap-1 text-xs font-bold uppercase tracking-wide ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        {label}
        {active &&
          (sortDir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          ))}
      </button>
    );
  }

  return (
    <div>
      {/* `accept` steers the picker toward paperwork and away from the camera
          roll, which is where the multi-GB files come from. It is a hint, not a
          guard — every platform lets you switch back to "All files" — so the
          real limit is the size check in `uploadFiles`. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.zip,.dwg,.dxf,application/pdf,image/*"
        className="hidden"
        onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
      />

      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
            Plans, reports &amp; files
          </p>
          <h2 className="font-display mt-3 text-4xl font-bold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
            Project documents
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Storage for every plan, permit, report, and delivery ticket. Generated logs and reports
            are filed here too — create them from{" "}
            <span className="font-bold">Create document</span> at the top of the project. Summaries
            are filed under <span className="font-bold">Walkthroughs</span>.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleCreateFolder}
            className="h-8 gap-2 rounded-lg px-4 text-xs font-bold"
          >
            <FolderPlus className="h-4 w-4" />
            New folder
          </Button>
          <GenerateDocumentMenu
            projectId={projectId}
            folderId={currentFolderId}
            onCreated={() => void load()}
            trigger={
              <Button
                disabled={creating}
                className="h-8 gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FilePlus2 className="h-4 w-4" />
                )}
                Create
              </Button>
            }
          />
          <Button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            variant="outline"
            className="h-8 gap-2 rounded-lg px-4 text-xs font-bold"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {uploadStatus
              ? uploadStatus.total > 1
                ? `Uploading ${uploadStatus.index}/${uploadStatus.total} — ${uploadStatus.percent}%`
                : `Uploading ${uploadStatus.percent}%`
              : "Add document"}
          </Button>
        </div>
      </div>

      {currentFolder && (
        <button
          type="button"
          onClick={() => setCurrentFolderId(null)}
          className="mt-4 flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground"
        >
          Documents <ChevronRight className="h-3 w-3" /> {currentFolder.name}
        </button>
      )}

      {/* Search + type filter */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a document…"
            className="h-9 pl-8"
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "pages", "files"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setTypeFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold capitalize ${
                typeFilter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Tree */}
      <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-card/65">
        {loading ? (
          <div className="flex items-center justify-center py-14 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground">
              <FileText className="h-5 w-5" />
            </span>
            <p className="text-sm font-bold text-foreground">Nothing here yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {q
                ? "No documents match your search."
                : "Create a page, add a folder, or upload plans, permits, and reports."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 border-b border-border bg-muted/30 px-4 py-2.5">
              {selectableCount > 0 && (
                <Checkbox
                  checked={
                    allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false
                  }
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                  className="shrink-0"
                />
              )}
              {selectedCount > 0 ? (
                <>
                  <span className="text-xs font-bold text-foreground">
                    {selectedCount} selected
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    {selectedFileIds.size === 0 && selectedPageIds.size > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleBulkExportPdf}
                        disabled={bulkExporting}
                        className="h-8 gap-1.5 text-xs font-bold"
                      >
                        {bulkExporting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileDown className="h-3.5 w-3.5" />
                        )}
                        Export PDF
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 text-xs font-bold"
                        >
                          <Move className="h-3.5 w-3.5" /> Move to…
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleBulkMove(null)}>
                          Top level
                        </DropdownMenuItem>
                        {(tree?.folders ?? []).map((f) => (
                          <DropdownMenuItem key={f.id} onClick={() => handleBulkMove(f.id)}>
                            {f.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleBulkDelete}
                      className="h-8 gap-1.5 text-xs font-bold text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearSelection}
                      className="h-8 text-xs font-bold"
                    >
                      Clear
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <SortHeader label="Name" sortKeyValue="name" />
                  </div>
                  <div className="w-28 shrink-0">
                    <SortHeader label="Type" sortKeyValue="type" />
                  </div>
                  <div className="w-36 shrink-0">
                    <SortHeader label="Last updated" sortKeyValue="updated" />
                  </div>
                  <div className="w-8 shrink-0" />
                </>
              )}
            </div>

            {!currentFolder &&
              folders.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-4 border-b border-border p-4 transition-colors hover:bg-muted/60"
                >
                  <button
                    type="button"
                    onClick={() => setCurrentFolderId(f.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                      <Folder className="h-5 w-5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-extrabold text-foreground">{f.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">Folder</p>
                    </div>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => handleDeleteFolder(f.id)}
                    aria-label="Delete folder"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

            {visiblePages.map((p) => (
              <div
                key={p.id}
                className="group flex items-center justify-between gap-4 border-b border-border p-4 transition-colors last:border-b-0 hover:bg-muted/60"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Checkbox
                    checked={selectedPageIds.has(p.id)}
                    onCheckedChange={() => togglePageSelected(p.id)}
                    aria-label={`Select ${p.title}`}
                    className="shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      navigate({
                        to: "/projects/$projectId/pages/$pageId",
                        params: { projectId, pageId: p.id },
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <FileText className="h-5 w-5 text-primary" />
                    </span>
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-extrabold text-foreground">
                          {p.title}
                        </span>
                        <BlueprintItemBadge
                          className="shrink-0"
                          source={
                            p.sourceTemplateId ? blueprintSources?.[p.sourceTemplateId] : null
                          }
                        />
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">
                        Page · Updated {relativeTime(p.updatedAt)}
                      </p>
                    </div>
                  </button>
                </div>
                <span className="hidden w-28 shrink-0 text-xs text-muted-foreground transition-colors group-hover:text-foreground sm:inline">
                  Page
                </span>
                <span className="hidden w-36 shrink-0 text-xs text-muted-foreground sm:inline">
                  {relativeTime(p.updatedAt)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground"
                      aria-label="Page actions"
                      disabled={exportingId === p.id}
                    >
                      {exportingId === p.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MoreHorizontal className="h-4 w-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() =>
                        navigate({
                          to: "/projects/$projectId/pages/$pageId",
                          params: { projectId, pageId: p.id },
                        })
                      }
                    >
                      <FileText className="mr-2 h-4 w-4" /> Open
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExportPagePdf(p.id)}>
                      <FileDown className="mr-2 h-4 w-4" /> Export to PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openSharePage({ id: p.id, title: p.title })}>
                      <Share2 className="mr-2 h-4 w-4" /> Share
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleRenamePage(p.id, p.title)}>
                      <Pencil className="mr-2 h-4 w-4" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleDuplicatePage(p.id)}>
                      <Copy className="mr-2 h-4 w-4" /> Duplicate
                    </DropdownMenuItem>
                    <MoveToFolderSubmenu
                      folders={tree?.folders ?? []}
                      currentFolderId={p.folderId}
                      onMove={(folderId) => handleMove("page", p.id, folderId)}
                    />
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleDeletePage(p.id, p.title)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}

            {visibleFiles.map((doc) => (
              <div
                key={doc.id}
                className="group flex items-center justify-between gap-4 border-b border-border p-4 transition-colors last:border-b-0 hover:bg-muted/60"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Checkbox
                    checked={selectedFileIds.has(doc.id)}
                    onCheckedChange={() => toggleFileSelected(doc.id)}
                    aria-label={`Select ${doc.file_name}`}
                    className="shrink-0"
                  />
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <FileText className="h-5 w-5 text-primary" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-foreground">
                      {doc.file_name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">
                      {fileTypeLabel(doc.mime_type, doc.file_name)} · Created{" "}
                      {relativeTime(doc.created_at)}
                    </p>
                  </div>
                </div>
                <span className="hidden w-28 shrink-0 text-xs text-muted-foreground transition-colors group-hover:text-foreground sm:inline">
                  {fileTypeLabel(doc.mime_type, doc.file_name)}
                </span>
                <span className="hidden w-36 shrink-0 text-xs text-muted-foreground sm:inline">
                  {relativeTime(doc.created_at)}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="hidden rounded-full bg-muted px-3 py-1.5 text-[10px] font-extrabold text-muted-foreground sm:inline-block">
                    {formatBytes(doc.size_bytes)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label="Document actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => void downloadDocument(doc)}>
                        <Download className="mr-2 h-4 w-4" /> Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void renameDocument(doc)}>
                        <Pencil className="mr-2 h-4 w-4" /> Rename
                      </DropdownMenuItem>
                      <MoveToFolderSubmenu
                        folders={tree?.folders ?? []}
                        currentFolderId={doc.folder_id}
                        onMove={(folderId) => handleMove("file", doc.id, folderId)}
                      />
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => void deleteDocument(doc)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <Dialog open={sharePage !== null} onOpenChange={(open) => !open && setSharePage(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share "{sharePage?.title}"</DialogTitle>
            <DialogDescription>
              Anyone with the link can view a read-only copy of this document.
            </DialogDescription>
          </DialogHeader>

          {shareLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex items-center gap-2.5">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      {shareRevoked ? "Link sharing off" : "Anyone with the link"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {shareRevoked
                        ? "Only you can see this document"
                        : "Viewers can read and download a PDF"}
                    </p>
                  </div>
                </div>
                {shareUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Switch checked={!shareRevoked} onCheckedChange={handleToggleShare} />
                )}
              </div>

              {!shareRevoked && shareToken && (
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={`${window.location.origin}/share/pages/${shareToken}`}
                    className="h-9 text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button size="sm" onClick={copyShareLink}>
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
