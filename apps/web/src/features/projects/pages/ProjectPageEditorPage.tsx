import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useParams } from "@tanstack/react-router";
import { useEditor, EditorContent, getHTMLFromFragment, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { TextStyle, FontFamily, FontSize } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
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
  X,
  Trash2,
  Search,
  MoreHorizontal,
  Layers,
  AlignLeft,
  AlignCenter,
  AlignRight,
  LayoutList,
  Images,
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
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/sitepix/client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePrompt } from "@/hooks/use-prompt";
import { useConfirm } from "@/hooks/use-confirm";
import {
  getProjectPage,
  updateProjectPage,
  deleteProjectPage,
  setProjectPageShare,
  generatePagePdf,
  savePageAsTemplate,
} from "@/lib/project-pages.functions";
import {
  listTextSnippets,
  createTextSnippet,
  deleteTextSnippet,
  type TextSnippet,
} from "@/lib/text-snippets.functions";
import { ProjectImage, isPhotoSlot } from "@/lib/tiptap-project-image";
import { DocumentToolbar } from "@/features/projects/components/DocumentToolbar";
import { Spacer } from "@/lib/tiptap-spacer";
import { FillField, MergeToken } from "@/lib/tiptap-fill-field";
import { downloadBase64File } from "@/lib/download-file";

interface ProjectPhoto {
  id: string;
  url: string;
  caption: string | null;
}

/** Plain-text preview of a snippet's HTML, for the list row and search matching. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function ProjectPageEditorPage() {
  const { projectId, pageId } = useParams({ from: "/_app/projects/$projectId_/pages/$pageId" });
  const navigate = useNavigate();
  const prompt = usePrompt();
  const confirm = useConfirm();
  /** True if this page was just created and abandoned without ever being edited — deleted on exit instead of left as clutter in the Documents list. */
  const freshRef = useRef(false);
  /** True once the user has made any edit this session. */
  const dirtyRef = useRef(false);
  /** True while there are edits not yet confirmed saved to the server. */
  const unsavedRef = useRef(false);
  function markDirty() {
    dirtyRef.current = true;
    unsavedRef.current = true;
  }

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
  /** Doc position of the template photo slot being filled, if the picker was opened by clicking one. */
  const slotPosRef = useRef<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUpdating, setShareUpdating] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [snippets, setSnippets] = useState<TextSnippet[]>([]);
  const [snippetsLoading, setSnippetsLoading] = useState(false);
  const [snippetSearch, setSnippetSearch] = useState("");
  /** Resolved merge-field values, so "Insert field" shows the real company/project name. */
  const [tokenValues, setTokenValues] = useState<TokenValues>({});
  const [exporting, setExporting] = useState(false);
  const [, forceToolbarUpdate] = useState(0);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    onSelectionUpdate: () => forceToolbarUpdate((n) => n + 1),
    onTransaction: () => forceToolbarUpdate((n) => n + 1),
    onUpdate: () => markDirty(),
    extensions: [
      // Tiptap 3's StarterKit now bundles Link and Underline itself, which
      // duplicated the standalone Underline/LinkExtension below (console warning:
      // "Duplicate extension names found: ['link', 'underline']"). Disable
      // StarterKit's copies so ours — which needs openOnClick: false — stay
      // the single registered instance of each.
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false }),
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
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ProjectImage,
      Spacer,
      FillField,
      MergeToken,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: "",
    editorProps: {
      // Clicking an unfilled template photo slot OR an already-inserted project
      // photo (hover reveals a "Change photo" overlay — see ProjectImage's
      // NodeView) opens the picker and swaps in the chosen photo at that spot.
      handleClickOn: (_view, _pos, node, nodePos) => {
        if (node.type.name === "image" && (isPhotoSlot(node.attrs) || node.attrs["data-photo-id"])) {
          slotPosRef.current = nodePos;
          setImagePickerOpen(true);
          return true;
        }
        return false;
      },
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
        const freshKey = `sitepix:freshPage:${pageId}`;
        if (sessionStorage.getItem(freshKey)) {
          freshRef.current = true;
          sessionStorage.removeItem(freshKey);
        }
        setTitle(res.page.title);
        setTokenValues((res as { tokens?: TokenValues }).tokens ?? {});
        setHeaderHtml(res.page.header_html ?? "");
        setFooterHtml(res.page.footer_html ?? "");
        setShowHeader(!!res.page.header_html);
        setShowFooter(!!res.page.footer_html);
        setShareToken(res.page.share_token);
        setRevoked(!!res.page.revoked_at);
        setUpdatedAt(res.page.updated_at);
        editor?.commands.setContent(res.page.content_html || "", { emitUpdate: false });
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
        unsavedRef.current = false;
      } catch (e: any) {
        toast.error(e?.message ?? "Could not save");
      } finally {
        setSaving(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTitle, debouncedHtml, debouncedHeaderHtml, debouncedFooterHtml, showHeader, showFooter, loading]);

  useBlocker({
    shouldBlockFn: async () => {
      if (freshRef.current && !dirtyRef.current) {
        // Never-edited page created via "Create" — drop it instead of leaving an
        // empty "Untitled" entry cluttering the Documents list.
        try {
          await deleteProjectPage({ data: { pageId } });
        } catch {
          /* best-effort cleanup */
        }
        return false;
      }
      if (!unsavedRef.current) return false;
      const proceed = await confirm({
        title: "Leave without saving?",
        description: "You have unsaved changes. If you leave now, they won't be saved.",
        confirmText: "Leave",
        cancelText: "Stay",
        variant: "destructive",
      });
      return !proceed;
    },
    enableBeforeUnload: () => unsavedRef.current,
  });

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

  async function handleSaveAsTemplate() {
    const name = await prompt({
      title: "Save as template",
      label: "Template name",
      defaultValue: title,
    });
    if (!name) return;
    try {
      await savePageAsTemplate({ data: { pageId, name } });
      toast.success(`Saved "${name}" to your templates`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save template");
    }
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
    const attrs: Record<string, unknown> = { src: photo.url, alt: photo.caption ?? "", "data-photo-id": photo.id };
    const slotPos = slotPosRef.current;
    slotPosRef.current = null;
    if (slotPos !== null && editor) {
      // Carry the slot's fixed width/height onto the replacement photo (styles.css
      // then crops it to fit via object-fit) so the template's layout never
      // reflows just because a real photo's aspect ratio differs from the slot's.
      const slotNode = editor.state.doc.nodeAt(slotPos);
      if (slotNode?.attrs.width) attrs.width = slotNode.attrs.width;
      if (slotNode?.attrs.height) attrs.height = slotNode.attrs.height;
      // setImage() inserts over the current selection, so selecting the slot
      // node first makes this a replace rather than an insert.
      editor.chain().focus().setNodeSelection(slotPos).setImage(attrs as any).run();
    } else {
      editor?.chain().focus().setImage(attrs as any).run();
    }
    setImagePickerOpen(false);
  }

  async function loadSnippets() {
    setSnippetsLoading(true);
    try {
      const res = await listTextSnippets();
      setSnippets(res.snippets);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load snippets");
    } finally {
      setSnippetsLoading(false);
    }
  }

  function openSnippets() {
    setSnippetsOpen(true);
    setSnippetSearch("");
    void loadSnippets();
  }

  const filteredSnippets = useMemo(() => {
    const q = snippetSearch.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(
      (s) => s.title.toLowerCase().includes(q) || stripHtml(s.content_html).toLowerCase().includes(q),
    );
  }, [snippets, snippetSearch]);

  async function saveSelectionAsSnippet() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      toast.error("Select some text in the document first");
      return;
    }
    // Only the selected range — `editor.getHTML()` would capture the whole document.
    const html = getHTMLFromFragment(editor.state.doc.slice(from, to).content, editor.schema);
    const title = await prompt({ title: "Save snippet", label: "Snippet name" });
    if (!title) return;
    try {
      await createTextSnippet({ data: { title, contentHtml: html } });
      toast.success("Snippet saved");
      await loadSnippets();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save snippet");
    }
  }

  async function handleDeleteSnippet(snippetId: string) {
    try {
      await deleteTextSnippet({ data: { snippetId } });
      setSnippets((prev) => prev.filter((s) => s.id !== snippetId));
      toast.success("Snippet deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete snippet");
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
      {/* Sticks just below AppHeader (h-[82px], also sticky top-0) rather than at top-0 itself —
          otherwise both stick to the same viewport position and AppHeader's higher z-index
          paints over this toolbar as soon as the page scrolls. */}
      <div className="sticky top-[82px] z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() =>
                navigate({ to: "/projects/$projectId", params: { projectId }, search: { panel: "reports" } })
              }
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Input
              ref={titleInputRef}
              value={title}
              onChange={(e) => {
                markDirty();
                setTitle(e.target.value);
              }}
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleSaveAsTemplate}>
                  <Layers className="mr-2 h-4 w-4" /> Save as a New Template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <DocumentToolbar
          editor={editor}
          onAddImage={() => setImagePickerOpen(true)}
          onOpenSnippets={openSnippets}
          onAddHeader={() => {
            markDirty();
            setShowHeader(true);
          }}
          onAddFooter={() => {
            markDirty();
            setShowFooter(true);
          }}
        />
      </div>

      <div className="mx-auto max-w-[850px] px-4 py-8 sm:px-0">
        <div className="rounded-sm border border-border bg-card p-10 shadow-sm sm:p-14">
          <RunningBlock
            kind="header"
            tokens={tokenValues}
            enabled={showHeader}
            value={headerHtml}
            onChange={(v) => {
              markDirty();
              setHeaderHtml(v);
            }}
            onEnable={() => {
              markDirty();
              setShowHeader(true);
            }}
            onRemove={() => {
              markDirty();
              setShowHeader(false);
              setHeaderHtml("");
            }}
          />

          <EditorContent editor={editor} />

          <RunningBlock
            kind="footer"
            tokens={tokenValues}
            enabled={showFooter}
            value={footerHtml}
            onChange={(v) => {
              markDirty();
              setFooterHtml(v);
            }}
            onEnable={() => {
              markDirty();
              setShowFooter(true);
            }}
            onRemove={() => {
              markDirty();
              setShowFooter(false);
              setFooterHtml("");
            }}
          />
        </div>
      </div>

      <Dialog
        open={imagePickerOpen}
        onOpenChange={(v) => {
          if (!v) slotPosRef.current = null;
          setImagePickerOpen(v);
        }}
      >
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-hidden p-0">
          <div className="flex max-h-[80vh] flex-col">
            <DialogHeader className="border-b px-6 pb-4 pt-5">
              <DialogTitle>
                {slotPosRef.current !== null ? "Fill this photo slot" : "Insert a project photo"}
              </DialogTitle>
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
              <Button size="sm" className="mb-3 w-full font-bold" onClick={saveSelectionAsSnippet}>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Save selected text as a new snippet
              </Button>

              {snippets.length > 0 && (
                <div className="relative mb-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={snippetSearch}
                    onChange={(e) => setSnippetSearch(e.target.value)}
                    placeholder="Find a snippet…"
                    className="h-10 pl-9 text-sm font-medium"
                    autoFocus
                  />
                </div>
              )}

              {snippetsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSnippets.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {snippets.length === 0
                    ? "No snippets yet. Select text in the document, then save it here to reuse later."
                    : "No snippets match your search."}
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredSnippets.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border p-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-bold text-foreground">{s.title}</p>
                        <p
                          className="truncate text-sm text-muted-foreground"
                          title={stripHtml(s.content_html)}
                        >
                          {stripHtml(s.content_html)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          className="font-bold"
                          onClick={() => {
                            editor?.chain().focus().insertContent(s.content_html).run();
                            setSnippetsOpen(false);
                          }}
                        >
                          Use
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteSnippet(s.id)}
                          aria-label="Delete snippet"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
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
  { label: "Company name", key: "company" },
  { label: "Project name", key: "project_name" },
  { label: "Project address", key: "project_address" },
  { label: "Today's date", key: "date" },
];

export type TokenValues = Record<string, { label: string; empty: boolean }>;

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Markup for an inserted merge field. It shows the *resolved* value (the actual
 * company name), never `{{company}}` — nobody wants to see template source in
 * their document. The token itself rides along in `data-token`, and the API
 * converts the pill back to `{{company}}` on save, so the field stays live and
 * renaming the company still updates every page.
 */
function tokenPillHtml(key: string, values: TokenValues): string {
  const resolved = values[key];
  const label = resolved?.label ?? key;
  const empty = resolved?.empty ? ` data-empty="true"` : "";
  return `<span data-token="${escapeAttr(key)}" data-label="${escapeAttr(label)}"${empty}>${escapeAttr(label)}</span>`;
}

/** Appends a field into a header/footer's single `<p>`. */
function appendToken(current: string, html: string): string {
  if (/<\/p>\s*$/.test(current)) return current.replace(/<\/p>\s*$/, ` ${html}</p>`);
  return `<p>${html}</p>`;
}

/**
 * A running header or footer. When absent it renders as an invisible hover strip
 * that reveals a "+ Add header/footer" button — so a document with neither stays
 * visually clean, matching how Word/Docs treat these regions.
 */
function RunningBlock({
  kind,
  enabled,
  value,
  tokens,
  onChange,
  onEnable,
  onRemove,
}: {
  kind: "header" | "footer";
  enabled: boolean;
  value: string;
  tokens: TokenValues;
  onChange: (html: string) => void;
  onEnable: () => void;
  onRemove: () => void;
}) {
  const isHeader = kind === "header";
  const label = isHeader ? "header" : "footer";

  if (!enabled) {
    return (
      <div
        className={cn(
          "group/add flex h-8 items-center justify-center",
          isHeader ? "mb-2" : "mt-2",
        )}
      >
        <button
          type="button"
          onClick={onEnable}
          className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1 text-[11px] font-bold text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/add:opacity-100"
        >
          <Plus className="h-3 w-3" /> Add {label}
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group/hf relative",
        isHeader ? "mb-4 border-b border-dashed border-border pb-3" : "mt-6 border-t border-dashed border-border pt-3",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <RichTextEditor
            value={value}
            onChange={onChange}
            placeholder={`${isHeader ? "Header" : "Footer"} — appears on every page`}
            compact
            singleLine
            toolbarOnFocus
            minHeight={24}
            className="border-none bg-transparent"
          />
        </div>
        <FieldTokenMenu
          tokens={tokens}
          onInsert={(key) => onChange(appendToken(value, tokenPillHtml(key, tokens)))}
        />
        <button
          type="button"
          onClick={onRemove}
          title={`Remove ${label}`}
          aria-label={`Remove ${label}`}
          className="mt-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive focus-visible:opacity-100 group-hover/hf:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function FieldTokenMenu({
  onInsert,
  tokens,
}: {
  onInsert: (key: string) => void;
  tokens: TokenValues;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs font-bold text-muted-foreground">
          Insert field
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {FIELD_TOKENS.map((f) => {
          const resolved = tokens[f.key];
          return (
            <DropdownMenuItem key={f.key} onClick={() => onInsert(f.key)}>
              <span className="min-w-0">
                <span className="block font-bold">{f.label}</span>
                {/* Preview of what will actually be inserted, so it's obvious
                    this drops in the real value and not a code token. */}
                <span className="block truncate text-xs text-muted-foreground">
                  {resolved && !resolved.empty ? resolved.label : "Not set — add it in Settings"}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

