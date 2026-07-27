import { useEffect, useRef, useState } from "react";
import { FileText, Upload, MoreHorizontal, Download, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { formatBytes } from "@/hooks/use-storage-usage";
import { relativeTime } from "@sitepix/shared";
import { ProjectReports, type ReportPhotoRef } from "@/features/projects/components/ProjectReports";

interface ProjectDocument {
  id: string;
  project_id: string;
  uploaded_by: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
}

interface Props {
  projectId: string;
  projectName: string;
  projectPhotos: ReportPhotoRef[];
  onChanged?: () => void;
}

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

export function ProjectDocuments({ projectId, projectName, projectPhotos, onChanged }: Props) {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("project_documents")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) toast.error("Couldn't load documents", { description: error.message });
    else setDocuments((data ?? []) as ProjectDocument[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, projectId]);

  async function uploadFiles(files: FileList | File[]) {
    if (!user) return;
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      for (const file of list) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${user.id}/${projectId}/${crypto.randomUUID()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("site-documents")
          .upload(path, file, { contentType: file.type || undefined });
        if (upErr) {
          toast.error(`${file.name}: ${upErr.message}`);
          continue;
        }
        const { error: insErr } = await (supabase as any).from("project_documents").insert({
          project_id: projectId,
          uploaded_by: user.id,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
        });
        if (insErr) toast.error(`${file.name}: ${insErr.message}`);
      }
      toast.success(list.length > 1 ? `${list.length} documents added` : "Document added");
      await load();
      onChanged?.();
    } finally {
      setUploading(false);
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

  async function deleteDocument(doc: ProjectDocument) {
    if (!window.confirm(`Delete "${doc.file_name}"? This can't be undone.`)) return;
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

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        multiple
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
            Keep every plan, permit, report, and delivery ticket in one place.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="h-8 gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Add document
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0 rounded-lg border-border text-muted-foreground"
                aria-label="More document tools"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setLegacyOpen(true)}>
                Reports, checklists &amp; site logs
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Document list */}
      <div className="mt-5 overflow-hidden rounded-3xl border border-border bg-card/65">
        {loading ? (
          <div className="flex items-center justify-center py-14 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground">
              <FileText className="h-5 w-5" />
            </span>
            <p className="text-sm font-bold text-foreground">No documents yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Drop a file above or click Add document to upload plans, permits, and reports.
            </p>
          </div>
        ) : (
          documents.map((doc, i) => (
            <div
              key={doc.id}
              className={`flex items-center justify-between gap-4 p-4 ${i < documents.length - 1 ? "border-b border-border" : ""}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-foreground">{doc.file_name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {fileTypeLabel(doc.mime_type, doc.file_name)} · Created{" "}
                    {relativeTime(doc.created_at)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-muted px-3 py-1.5 text-[10px] font-extrabold text-muted-foreground">
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
          ))
        )}
      </div>

      <Dialog open={legacyOpen} onOpenChange={setLegacyOpen}>
        <DialogContent className="max-w-5xl p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle>Reports, checklists &amp; site logs</DialogTitle>
          </DialogHeader>
          <ProjectReports
            projectId={projectId}
            projectName={projectName}
            projectPhotos={projectPhotos}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
