import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { TextStyle, FontFamily, FontSize } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import LinkExtension from "@tiptap/extension-link";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import {
  ArrowLeft,
  Bold,
  Italic,
  UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  List,
  ListOrdered,
  ListChecks,
  LinkIcon,
  ImagePlus,
  TableIcon,
  Palette,
  FileDown,
  Share2,
  Loader2,
  Undo2,
  Redo2,
  Sparkles,
  Copy,
  Globe,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { RichTextEditor } from "@/components/RichTextEditor";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/sitepix/client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePrompt } from "@/hooks/use-prompt";
import {
  getProjectPage,
  updateProjectPage,
  setProjectPageShare,
  generatePagePdf,
} from "@/lib/project-pages.functions";
import { listTextSnippets, createTextSnippet, type TextSnippet } from "@/lib/text-snippets.functions";
import { ProjectImage } from "@/lib/tiptap-project-image";
import { downloadBase64File } from "@/lib/download-file";

interface ProjectPhoto {
  id: string;
  url: string;
  caption: string | null;
}

export function ProjectPageEditorPage() {
  const { projectId, pageId } = useParams({ from: "/_app/projects/$projectId_/pages/$pageId" });
  const navigate = useNavigate();
  const prompt = usePrompt();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Untitled");
  const [headerHtml, setHeaderHtml] = useState("");
  const [footerHtml, setFooterHtml] = useState("");
  const [showHeader, setShowHeader] = useState(false);
  const [showFooter, setShowFooter] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [revoked, setRevoked] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<ProjectPhoto[]>([]);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUpdating, setShareUpdating] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [snippets, setSnippets] = useState<TextSnippet[]>([]);
  const [exporting, setExporting] = useState(false);
  const [, forceToolbarUpdate] = useState(0);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    onSelectionUpdate: () => forceToolbarUpdate((n) => n + 1),
    onTransaction: () => forceToolbarUpdate((n) => n + 1),
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: false }),
      LinkExtension.configure({ openOnClick: false }),
      ProjectImage,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "tiptap prose prose-sm max-w-none focus:outline-none min-h-[60vh] prose-headings:font-bold prose-p:my-2 prose-ul:my-2 prose-ol:my-2",
      },
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getProjectPage({ data: { pageId } });
        if (cancelled) return;
        setTitle(res.page.title);
        setHeaderHtml(res.page.header_html ?? "");
        setFooterHtml(res.page.footer_html ?? "");
        setShowHeader(!!res.page.header_html);
        setShowFooter(!!res.page.footer_html);
        setShareToken(res.page.share_token);
        setRevoked(!!res.page.revoked_at);
        setUpdatedAt(res.page.updated_at);
        editor?.commands.setContent(res.page.content_html || "");
      } catch (e: any) {
        toast.error(e?.message ?? "Could not load page");
      } finally {
        if (!cancelled) setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, editor]);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("photos")
        .select("id, image_url, storage_path, caption")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(200);
      const rows = (data as any[]) ?? [];
      const resolved: ProjectPhoto[] = [];
      for (const r of rows) {
        let url = r.image_url as string | null;
        if (!url) {
          const { data: s } = await supabase.storage.from("site-photos").createSignedUrl(r.storage_path, 3600);
          url = s?.signedUrl ?? null;
        }
        if (url) resolved.push({ id: r.id, url, caption: r.caption });
      }
      setPhotos(resolved);
    })();
  }, [projectId]);

  const html = editor?.getHTML() ?? "";
  const debouncedTitle = useDebouncedValue(title, 800);
  const debouncedHtml = useDebouncedValue(html, 1200);
  const debouncedHeaderHtml = useDebouncedValue(headerHtml, 1200);
  const debouncedFooterHtml = useDebouncedValue(footerHtml, 1200);
  const firstRun = useRef(true);

  useEffect(() => {
    if (loading) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    (async () => {
      setSaving(true);
      try {
        await updateProjectPage({
          data: {
            pageId,
            title: debouncedTitle,
            contentHtml: debouncedHtml,
            headerHtml: showHeader ? debouncedHeaderHtml : null,
            footerHtml: showFooter ? debouncedFooterHtml : null,
          },
        });
        setUpdatedAt(new Date().toISOString());
      } catch (e: any) {
        toast.error(e?.message ?? "Could not save");
      } finally {
        setSaving(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTitle, debouncedHtml, debouncedHeaderHtml, debouncedFooterHtml, showHeader, showFooter, loading]);

  async function handleToggleShare(enable: boolean) {
    setShareUpdating(true);
    try {
      const res = await setProjectPageShare({ data: { pageId, enable } });
      setShareToken(res.shareToken);
      setRevoked(!enable);
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

  async function handleExport() {
    setExporting(true);
    try {
      const res = await generatePagePdf({ data: { pageId } });
      downloadBase64File(res.pdfBase64, res.filename);
      toast.success("Exported to PDF");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not export PDF");
    } finally {
      setExporting(false);
    }
  }

  function insertImage(photo: ProjectPhoto) {
    editor?.chain().focus().setImage({ src: photo.url, alt: photo.caption ?? "", "data-photo-id": photo.id } as any).run();
    setImagePickerOpen(false);
  }

  async function openSnippets() {
    setSnippetsOpen(true);
    try {
      const res = await listTextSnippets();
      setSnippets(res.snippets);
    } catch {
      /* non-fatal */
    }
  }

  async function saveSelectionAsSnippet() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      toast.error("Select some text first");
      return;
    }
    const html = editor.getHTML();
    const title = await prompt({ title: "Save snippet", label: "Snippet name" });
    if (!title) return;
    try {
      await createTextSnippet({ data: { title, contentHtml: html } });
      toast.success("Snippet saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save snippet");
    }
  }

  if (loading || !editor) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Input
              ref={titleInputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 max-w-xs border-none bg-transparent px-1 text-base font-extrabold shadow-none focus-visible:ring-1"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {saving ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </span>
            ) : updatedAt ? (
              <span className="hidden sm:inline">
                Last updated {new Date(updatedAt).toLocaleString()}
              </span>
            ) : null}
            <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1.5 h-3.5 w-3.5" />}
              Export PDF
            </Button>
            <Button size="sm" variant={revoked ? "outline" : "default"} onClick={() => setShareOpen(true)}>
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              {revoked ? "Share" : "Shared"}
            </Button>
          </div>
        </div>

        <Toolbar
          editor={editor}
          onAddImage={() => setImagePickerOpen(true)}
          onOpenSnippets={openSnippets}
          onAddHeader={() => setShowHeader(true)}
          onAddFooter={() => setShowFooter(true)}
        />
      </div>

      <div className="mx-auto max-w-[850px] px-4 py-8 sm:px-0">
        <div className="rounded-sm border border-border bg-card p-10 shadow-sm sm:p-14">
          {showHeader ? (
            <div className="mb-4 flex items-start gap-2 border-b border-dashed border-border pb-3">
              <div className="flex-1">
                <RichTextEditor
                  value={headerHtml}
                  onChange={setHeaderHtml}
                  placeholder="Header — appears on every page"
                  compact
                  singleLine
                  className="border-none bg-transparent"
                />
              </div>
              <FieldTokenMenu onInsert={(token) => setHeaderHtml((prev) => appendToken(prev, token))} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowHeader(true)}
              className="mb-4 flex w-full items-center gap-2 border-b border-dashed border-border pb-3 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Add header
            </button>
          )}

          <EditorContent editor={editor} />

          {showFooter ? (
            <div className="mt-6 flex items-start gap-2 border-t border-dashed border-border pt-3">
              <div className="flex-1">
                <RichTextEditor
                  value={footerHtml}
                  onChange={setFooterHtml}
                  placeholder="Footer — appears on every page"
                  compact
                  singleLine
                  className="border-none bg-transparent"
                />
              </div>
              <FieldTokenMenu onInsert={(token) => setFooterHtml((prev) => appendToken(prev, token))} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowFooter(true)}
              className="mt-6 flex w-full items-center gap-2 border-t border-dashed border-border pt-3 text-xs font-bold text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Add footer
            </button>
          )}
        </div>
      </div>

      <Dialog open={imagePickerOpen} onOpenChange={setImagePickerOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden p-0">
          <div className="flex max-h-[80vh] flex-col">
            <DialogHeader className="border-b px-6 pb-4 pt-5">
              <DialogTitle>Insert a project photo</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4">
              {photos.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No photos in this project yet.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => insertImage(p)}
                      className="aspect-square overflow-hidden rounded-md border border-border hover:ring-2 hover:ring-primary"
                    >
                      <img src={p.url} alt={p.caption ?? ""} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share "{title}"</DialogTitle>
            <DialogDescription>
              Anyone with the link can view a read-only copy of this document.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="flex items-center gap-2.5">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-bold text-foreground">
                  {revoked ? "Link sharing off" : "Anyone with the link"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {revoked ? "Only you can see this document" : "Viewers can read and download a PDF"}
                </p>
              </div>
            </div>
            {shareUpdating ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Switch checked={!revoked} onCheckedChange={handleToggleShare} />
            )}
          </div>

          {!revoked && shareToken && (
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
        </DialogContent>
      </Dialog>

      <Dialog open={snippetsOpen} onOpenChange={setSnippetsOpen}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-hidden p-0">
          <div className="flex max-h-[80vh] flex-col">
            <DialogHeader className="border-b px-6 pb-4 pt-5">
              <DialogTitle>Text snippets</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4">
              <Button size="sm" variant="outline" className="mb-3 w-full" onClick={saveSelectionAsSnippet}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Save current selection as a new snippet
              </Button>
              {snippets.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No snippets yet.</p>
              ) : (
                <div className="space-y-2">
                  {snippets.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-foreground">{s.title}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          editor?.chain().focus().insertContent(s.content_html).run();
                          setSnippetsOpen(false);
                        }}
                      >
                        Use
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const FIELD_TOKENS = [
  { label: "Company name", token: "{{company}}" },
  { label: "Project name", token: "{{project_name}}" },
  { label: "Project address", token: "{{project_address}}" },
  { label: "Today's date", token: "{{date}}" },
];

/** Appends a field token into a header/footer's single `<p>` — resolved server-side on every read, so renaming the project/company later updates it automatically. */
function appendToken(current: string, token: string): string {
  if (/<\/p>\s*$/.test(current)) return current.replace(/<\/p>\s*$/, ` ${token}</p>`);
  return `<p>${token}</p>`;
}

function FieldTokenMenu({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs font-bold text-muted-foreground">
          Insert field
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {FIELD_TOKENS.map((f) => (
          <DropdownMenuItem key={f.token} onClick={() => onInsert(f.token)}>
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COLORS = ["#0f172a", "#dc2626", "#d97706", "#16a34a", "#2563eb", "#7c3aed"];
const HIGHLIGHT_COLORS = ["#fef08a", "#bfdbfe", "#bbf7d0", "#fbcfe8", "#fed7aa"];

const FONT_FAMILIES = [
  { label: "Default", value: "" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, sans-serif" },
];

const FONT_SIZES = [10, 11, 12, 14, 16, 18, 24, 32];

function Toolbar({
  editor,
  onAddImage,
  onOpenSnippets,
  onAddHeader,
  onAddFooter,
}: {
  editor: Editor;
  onAddImage: () => void;
  onOpenSnippets: () => void;
  onAddHeader: () => void;
  onAddFooter: () => void;
}) {
  const prompt = usePrompt();
  const btnCls = (active?: boolean) =>
    cn(
      "rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground",
      active && "bg-muted text-foreground",
    );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-t border-border px-4 py-1.5 sm:px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-bold">
            {editor.isActive("heading", { level: 1 })
              ? "Heading 1"
              : editor.isActive("heading", { level: 2 })
                ? "Heading 2"
                : editor.isActive("heading", { level: 3 })
                  ? "Heading 3"
                  : "Paragraph"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 className="mr-2 h-4 w-4" /> Heading 1
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className="mr-2 h-4 w-4" /> Heading 2
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 className="mr-2 h-4 w-4" /> Heading 3
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().setParagraph().run()}>
            <Pilcrow className="mr-2 h-4 w-4" /> Paragraph
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1.5 h-4 w-px bg-border" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-bold">
            {(editor.getAttributes("textStyle").fontFamily as string | undefined)?.replace(/,.*/, "") ?? "Font"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {FONT_FAMILIES.map((f) => (
            <DropdownMenuItem
              key={f.label}
              style={{ fontFamily: f.value }}
              onClick={() =>
                f.value
                  ? editor.chain().focus().setFontFamily(f.value).run()
                  : editor.chain().focus().unsetFontFamily().run()
              }
            >
              {f.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-bold">
            {(editor.getAttributes("textStyle").fontSize as string | undefined)?.replace("px", "") ?? "Size"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {FONT_SIZES.map((size) => (
            <DropdownMenuItem key={size} onClick={() => editor.chain().focus().setFontSize(`${size}px`).run()}>
              {size}px
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => editor.chain().focus().unsetFontSize().run()}>Default</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1.5 h-4 w-px bg-border" />

      <button type="button" className={btnCls(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
        <Bold className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
        <Italic className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline">
        <UnderlineIcon className="h-4 w-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={btnCls()} aria-label="Text color">
            <Palette className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto p-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Text color</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="grid h-6 w-6 place-items-center rounded-full border border-border text-[10px] font-bold"
              onClick={() => editor.chain().focus().unsetColor().run()}
              aria-label="Default text color"
            >
              A
            </button>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="h-6 w-6 rounded-full border border-border"
                style={{ backgroundColor: c }}
                onClick={() => editor.chain().focus().setColor(c).run()}
              />
            ))}
          </div>
          <p className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Highlight color
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="grid h-6 w-6 place-items-center rounded-full border border-border text-muted-foreground"
              onClick={() => editor.chain().focus().unsetHighlight().run()}
              aria-label="Remove highlight"
            >
              ×
            </button>
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="h-6 w-6 rounded-full border border-border"
                style={{ backgroundColor: c }}
                onClick={() => editor.chain().focus().toggleHighlight({ color: c }).run()}
              />
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1.5 h-4 w-px bg-border" />

      <button type="button" className={btnCls(editor.isActive("taskList"))} onClick={() => editor.chain().focus().toggleTaskList().run()} aria-label="Checklist">
        <ListChecks className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bulleted list">
        <List className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Numbered list">
        <ListOrdered className="h-4 w-4" />
      </button>

      <span className="mx-1.5 h-4 w-px bg-border" />

      <button
        type="button"
        className={btnCls(editor.isActive("link"))}
        onClick={async () => {
          const url = await prompt({ title: "Add link", label: "URL", placeholder: "https://" });
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
        aria-label="Link"
      >
        <LinkIcon className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls()} onClick={onAddImage} aria-label="Add image">
        <ImagePlus className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={btnCls()}
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        aria-label="Add table"
      >
        <TableIcon className="h-4 w-4" />
      </button>
      {editor.isActive("table") && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-bold">
              Table tools
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => editor.chain().focus().addRowBefore().run()}>
              Insert row above
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()}>
              Insert row below
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addColumnBefore().run()}>
              Insert column left
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}>
              Insert column right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</DropdownMenuItem>
            <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()}>
              Delete column
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteTable().run()}
              className="text-destructive focus:text-destructive"
            >
              Delete table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button type="button" className={btnCls()} onClick={onOpenSnippets} aria-label="Text snippets">
        <Sparkles className="h-4 w-4" />
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={btnCls()} aria-label="Insert">
            <Plus className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertContent('<h2>Notes</h2><p></p>')
                .run()
            }
          >
            <Pilcrow className="mr-2 h-4 w-4" /> Notes section
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onAddHeader}>Add header</DropdownMenuItem>
          <DropdownMenuItem onClick={onAddFooter}>Add footer</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1.5 h-4 w-px bg-border" />

      <button type="button" className={btnCls()} onClick={() => editor.chain().focus().undo().run()} aria-label="Undo">
        <Undo2 className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls()} onClick={() => editor.chain().focus().redo().run()} aria-label="Redo">
        <Redo2 className="h-4 w-4" />
      </button>
    </div>
  );
}
