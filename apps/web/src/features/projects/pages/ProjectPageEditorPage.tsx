import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { NodeSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
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
  LayoutTemplate,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  updateTemplateFromPage,
  listDocumentTemplates,
  type DocumentTemplateSummary,
} from "@/lib/project-pages.functions";
import { nextCopyName } from "@/lib/duplicate-name";
import {
  listTextSnippets,
  createTextSnippet,
  deleteTextSnippet,
  type TextSnippet,
} from "@/lib/text-snippets.functions";
import { ProjectImage, isPhotoSlot } from "@/lib/tiptap-project-image";
import { findImagePos, emptySlotNearSelection } from "@/lib/tiptap-photo-fill";
import { DocumentToolbar } from "@/features/projects/components/DocumentToolbar";
import { Spacer } from "@/lib/tiptap-spacer";
import { InfoPanel } from "@/lib/tiptap-info-panel";
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
  /** True if this page was just created and abandoned without ever being edited - deleted on exit instead of left as clutter in the Documents list. */
  const freshRef = useRef(false);
  /** True once the user has made any edit this session. */
  const dirtyRef = useRef(false);
  /** True while there are edits not yet confirmed saved to the server. */
  const unsavedRef = useRef(false);
  /**
   * The title the server is known to hold. Renaming on a phone means tapping the
   * box, clearing it, then waiting for the keyboard - so the field sits empty far
   * longer than the 800ms autosave debounce, and an empty box has to mean "rename
   * in progress", never "blank the title". Autosave omits the field while it is
   * empty and blur restores this value, so the header can't show a name the page
   * doesn't have.
   */
  const savedTitleRef = useRef("Untitled");
  /**
   * Bumped on every edit, so a save can tell whether the document moved on
   * while its request was in flight. Without it, a save that started before the
   * user's last keystroke cleared `unsavedRef` on the way back and the
   * leave-confirmation stopped guarding an edit that was never written.
   */
  const editCountRef = useRef(0);
  function markDirty() {
    dirtyRef.current = true;
    unsavedRef.current = true;
    editCountRef.current += 1;
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
  /** The document template this page was created from, if it was created from one. */
  const [sourceTemplateId, setSourceTemplateId] = useState<string | null>(null);
  /**
   * The document library, read once the ··· menu is first opened.
   *
   * Two things need it and neither is worth a request on page load: naming a
   * new template without colliding with an existing one, and deciding whether
   * the template this page came from is one this team is allowed to update.
   */
  const [library, setLibrary] = useState<DocumentTemplateSummary[] | null>(null);
  /**
   * Optimistic-concurrency token: the row version this editor is working from.
   * A ref, not state, because the autosave chain reads it outside React's
   * render cycle and must always see the newest value.
   */
  const versionRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState<ProjectPhoto[]>([]);
  /**
   * The photo picker's open state and, when it was opened by clicking a slot
   * (or an already-filled photo), the exact node that click landed on.
   *
   * One state object, not two: `open` and `target` used to live in a boolean
   * `useState` plus a separate `useRef`, and the dialog's title read the ref
   * during render to decide between "Fill this photo slot" and "Insert a
   * project photo". A ref mutates without triggering a render, so that read
   * only ever showed the *previous* render's value - right the instant the
   * click handler happened to fire before the state update it triggered was
   * committed, stale otherwise, and visibly wrong for the ~200ms the dialog
   * spends fading out after `target` is cleared but before `open` catches up.
   * Keeping both in one state value makes them change together, on the same
   * render, every time.
   *
   * `target` carries the node itself, not just its position: a bare position
   * that drifted (an undo, a reload, an edit elsewhere in the document) still
   * points at *something*, so filling it blindly would put the photo in the
   * wrong place. Keeping the node lets the target be recovered by identity -
   * see `findImagePos` - or the fill refused outright.
   */
  const [picker, setPicker] = useState<{
    open: boolean;
    target: { pos: number; node: ProseMirrorNode } | null;
  }>({ open: false, target: null });
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUpdating, setShareUpdating] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [snippets, setSnippets] = useState<TextSnippet[]>([]);
  const [snippetsLoading, setSnippetsLoading] = useState(false);
  const [snippetSearch, setSnippetSearch] = useState("");
  /**
   * Id of the snippet whose row is currently asking "delete this?".
   *
   * Deliberately an inline, in-row confirmation rather than a confirm dialog.
   * A dialog opened from inside the snippets dialog renders in its own portal,
   * so Radix reads a click inside it as an interaction *outside* the snippets
   * dialog and dismisses the library behind it - measured: cancelling the
   * delete threw you out of the snippet list entirely. (`usePrompt` gets away
   * with it because it is a Dialog, not an AlertDialog.) Confirming in the row
   * keeps it to one layer, so there is nothing to cascade.
   */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  /** Resolved merge-field values, so "Insert field" shows the real company/project name. */
  const [tokenValues, setTokenValues] = useState<TokenValues>({});
  const [exporting, setExporting] = useState(false);
  const [, forceToolbarUpdate] = useState(0);
  /**
   * Bumped whenever the document itself changes, so the HTML is re-serialised
   * then and not on every render. See `html` below.
   */
  const [docVersion, setDocVersion] = useState(0);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Both built once, not on every render. `useEditor`'s default `deps: []`
  // only skips *recreating* the editor instance - it does not stop
  // `EditorInstanceManager.onRender` from diffing the options object on every
  // single render (including the ones `onTransaction` below triggers just to
  // repaint the toolbar) and calling `editor.setOptions(...)` whenever a key
  // differs. `extensions` and `editorProps` were both fresh objects every
  // render - `.configure()` returns a new instance each call, and the
  // `editorProps` object literal is itself new - so that diff never once came
  // back clean: every keystroke's toolbar repaint was also re-propping the
  // whole ProseMirror view. Neither has anything to capture from render scope
  // (the click handler below reads `view.state` live, and only closes over
  // `setPicker`, which React guarantees stable), so building them once is safe.
  const editorExtensions = useMemo(
    () => [
      // Tiptap 3's StarterKit now bundles Link and Underline itself, which
      // duplicated the standalone Underline/LinkExtension below (console warning:
      // "Duplicate extension names found: ['link', 'underline']"). Disable
      // StarterKit's copies so ours - which needs openOnClick: false - stay
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
      InfoPanel,
      FillField,
      MergeToken,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    [],
  );

  const editorProps = useMemo(
    () => ({
      /*
       * Clicking an unfilled template photo slot OR an already-inserted project
       * photo (hover reveals a "Change photo" overlay - see ProjectImage's
       * NodeView) opens the picker and swaps in the chosen photo at that spot.
       *
       * A real DOM `click`, deliberately not ProseMirror's `handleClickOn`.
       * ProseMirror abandons its own click handling the moment the pointer
       * travels more than 4px between press and release
       * (`MouseDown.updateAllowDefault`, prosemirror-view), and a 280px-tall
       * dashed box that ProseMirror also turns into a drag handle collects
       * exactly that kind of imprecise click. When it was abandoned the slot
       * simply did not react - and the caret was left parked right beside it,
       * so the next thing the user reached for (the toolbar's "Add photo")
       * dropped the photo next to the empty box instead of into it. That is
       * the "photo inserted separately and detached" report. A DOM click
       * tolerates the travel, and fires for taps too.
       */
      handleDOMEvents: {
        /*
         * An unfilled slot is a call to action, not cargo.
         *
         * ProseMirror marks every image node draggable and sets `draggable` on
         * the NodeView wrapper, so Chromium turns press-and-twitch on one into
         * a native HTML5 drag. A drag swallows `mouseup` and `click` outright -
         * measured on the real page, a 9px wobble emits `mousedown, dragstart,
         * dragend` and nothing else - so the box silently ignored anything but
         * a perfectly still click, whichever handler was listening. Cancelling
         * the drag restores the normal mouseup/click pair.
         *
         * Only unfilled slots. A real photo stays draggable, because reordering
         * photos inside a document is a genuine thing to want.
         */
        dragstart: (view: EditorView, event: DragEvent) => {
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!at || at.inside < 0) return false;
          const node = view.state.doc.nodeAt(at.inside);
          if (!node || node.type.name !== "image" || !isPhotoSlot(node.attrs)) return false;
          event.preventDefault();
          return true;
        },
        click: (view: EditorView, event: MouseEvent) => {
          // Dragging a text selection that happens to end on a photo is not a
          // click on that photo. A click leaves either a collapsed caret or a
          // NodeSelection on the image itself; a range of text means the user
          // was selecting, so leave their selection alone.
          const selection = view.state.selection;
          if (!selection.empty && !(selection instanceof NodeSelection)) return false;
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!at || at.inside < 0) return false;
          const node = view.state.doc.nodeAt(at.inside);
          if (!node || node.type.name !== "image") return false;
          if (!isPhotoSlot(node.attrs) && !node.attrs["data-photo-id"]) return false;
          setPicker({ open: true, target: { pos: at.inside, node } });
          return true;
        },
      },
      attributes: {
        class:
          "tiptap prose prose-sm max-w-none focus:outline-none min-h-[60vh] prose-headings:font-bold prose-p:my-2 prose-ul:my-2 prose-ol:my-2",
      },
    }),
    [],
  );

  const editor = useEditor({
    // `onTransaction` fires for every dispatched transaction, selection-only
    // ones included, so it already covers `onSelectionUpdate` - registering
    // both simply re-rendered the whole page twice per keystroke.
    onTransaction: () => forceToolbarUpdate((n) => n + 1),
    onUpdate: () => {
      markDirty();
      setDocVersion((n) => n + 1);
    },
    extensions: editorExtensions,
    content: "",
    editorProps,
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
        savedTitleRef.current = res.page.title;
        setTokenValues((res as { tokens?: TokenValues }).tokens ?? {});
        setHeaderHtml(res.page.header_html ?? "");
        setFooterHtml(res.page.footer_html ?? "");
        setShowHeader(!!res.page.header_html);
        setShowFooter(!!res.page.footer_html);
        setShareToken(res.page.share_token);
        setRevoked(!!res.page.revoked_at);
        setUpdatedAt(res.page.updated_at);
        setSourceTemplateId(res.page.sourceTemplateId ?? null);
        versionRef.current = res.page.updated_at;
        editor?.commands.setContent(res.page.content_html || "", { emitUpdate: false });
        // `emitUpdate: false` keeps loading from counting as an edit, but it
        // also means `onUpdate` does not fire - so the serialised `html` below
        // has to be invalidated by hand. Without this it would still hold the
        // empty string the editor mounted with, which is the exact value that
        // used to get written back over the document.
        setDocVersion((n) => n + 1);
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

  /** How long the signed URLs below stay valid. */
  const PHOTO_URL_TTL_SECONDS = 3600;
  /** When `photos` was last resolved, so stale signatures can be spotted. */
  const photosLoadedAtRef = useRef(0);

  async function loadPhotos() {
    const { data } = await (supabase as any)
      .from("photos")
      .select("id, image_url, storage_path, caption")
      .eq("project_id", projectId)
      // Excludes trashed photos, which nothing filters at the database level.
      // `SelectPhotosForPageDialog` - the other picker on this same screen -
      // already does this, so the two disagreed about which photos exist.
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    const rows = (data as any[]) ?? [];
    // Batch signing, not one awaited request per row - at the 200-row limit
    // above that was 200 sequential round trips before the picker showed
    // anything. `ProjectChecklists.signPhotos` is the model.
    const toSign = rows
      .filter((r) => !r.image_url && r.storage_path)
      .map((r) => r.storage_path as string);
    const signedByPath: Record<string, string> = {};
    if (toSign.length) {
      const { data: signed } = await supabase.storage
        .from("site-photos")
        .createSignedUrls(toSign, PHOTO_URL_TTL_SECONDS);
      signed?.forEach((s, i) => {
        if (s.signedUrl) signedByPath[toSign[i]] = s.signedUrl;
      });
    }
    const resolved: ProjectPhoto[] = [];
    for (const r of rows) {
      const url = (r.image_url as string | null) ?? signedByPath[r.storage_path] ?? null;
      if (url) resolved.push({ id: r.id, url, caption: r.caption });
    }
    setPhotos(resolved);
    photosLoadedAtRef.current = Date.now();
  }

  useEffect(() => {
    void loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /*
   * Re-sign before showing the picker if the URLs have gone stale.
   *
   * These are signed URLs with a one-hour life, resolved once when the editor
   * mounted. Documents get left open far longer than that - and past the hour
   * every thumbnail in the picker 403s, and picking one writes a dead `src`
   * into the document. (It heals on the next load, because `data-photo-id`
   * makes the server re-resolve it, but the photo you just placed shows broken
   * until then.) Refreshing on open keeps the common case instant and only
   * pays for a round trip when the session has actually run long.
   */
  useEffect(() => {
    if (!picker.open) return;
    const age = Date.now() - photosLoadedAtRef.current;
    if (age > (PHOTO_URL_TTL_SECONDS - 600) * 1000) void loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker.open]);

  /**
   * The document as HTML, re-serialised only when the document changes.
   *
   * `getHTML()` walks and serialises the entire document, and this used to run
   * on every render - while `onTransaction` re-renders the page on every
   * keystroke and every caret movement. A long report was therefore fully
   * serialised several times per character typed, for a string that only ever
   * changes on `onUpdate`.
   */
  // `docVersion` looks unused to the linter because the editor's content is
  // mutable state it cannot see through - it is precisely what makes this
  // re-serialise, so it has to stay.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => editor?.getHTML() ?? "", [editor, docVersion]);
  const debouncedTitle = useDebouncedValue(title, 800);
  const debouncedHtml = useDebouncedValue(html, 1200);
  const debouncedHeaderHtml = useDebouncedValue(headerHtml, 1200);
  const debouncedFooterHtml = useDebouncedValue(footerHtml, 1200);
  /**
   * What a save writes, read at the moment it actually runs.
   *
   * The debounced values above decide *when* to save; they must never supply
   * *what* is saved. They settle on two different clocks - 800ms for the title,
   * 1200ms for the three bodies - and each one starts life holding the value
   * from before the document loaded, so whichever fired first dragged its stale
   * companions along with it. That was enough to lose a document just by
   * opening it: roughly 800ms after load the title's tick fired a save carrying
   * `debouncedHtml`, still the empty string the editor mounted with, and the
   * stored `content_html` was blanked until the body's own tick put it back
   * 400ms later. A closed tab, a dropped connection or a 409 inside that window
   * made the blanking permanent, and a failed load - which also ends with an
   * empty editor and `loading` false - blanked it with no window at all.
   */
  const latestRef = useRef({ title, html, headerHtml, footerHtml, showHeader, showFooter });
  latestRef.current = { title, html, headerHtml, footerHtml, showHeader, showFooter };
  /** Serialises autosaves so two in-flight writes can't land out of order. */
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());

  /**
   * Write the current values, queued behind whatever is already saving.
   * Resolves true once the stored row matches what was sent.
   *
   * Queued because the four debounced values settle on two different schedules
   * (800ms for the title, 1200ms for the bodies), so two writes could be in
   * flight at once with nothing ordering them - and because each carries a full
   * snapshot, an older one landing second silently reverted the newer content.
   */
  function queueSave(): Promise<boolean> {
    const run = saveChain.current
      .catch(() => {})
      .then(async () => {
        setSaving(true);
        // Read at request time, not from the debounced snapshots - see latestRef.
        const latest = latestRef.current;
        const savedAt = editCountRef.current;
        /*
         * An empty box is a rename in progress, not a request to blank the
         * title. `title` is optional server-side and the service only patches
         * it when present, so omitting it saves the body and leaves the stored
         * title alone. Sending "" instead failed the schema's `min(1)` and took
         * the *whole* write down with it - including the content typed in the
         * same window, which was never retried because the next autosave only
         * fires on the next change.
         */
        const titleToSave = latest.title.trim();
        try {
          const res = await updateProjectPage({
            data: {
              pageId,
              title: titleToSave || undefined,
              contentHtml: latest.html,
              headerHtml: latest.showHeader ? latest.headerHtml : null,
              footerHtml: latest.showFooter ? latest.footerHtml : null,
              /*
               * The version this editor loaded (or last successfully wrote).
               * Without it, two people with this page open each write their
               * whole document over the other's on every autosave and the
               * loser's work vanishes with no error. The server rejects a
               * stale write with a 409 instead, which surfaces in the catch
               * below as a toast telling them to reload.
               */
              expectedUpdatedAt: versionRef.current ?? undefined,
            },
          });
          // Track the server's value, not a locally-generated timestamp - a
          // guessed one would never match the row and every save after the
          // first would 409.
          if (res?.updatedAt) {
            versionRef.current = res.updatedAt;
            setUpdatedAt(res.updatedAt);
          }
          if (titleToSave) savedTitleRef.current = titleToSave;
          // Only if nothing was typed while this request was in flight -
          // otherwise the leave-confirmation would stop guarding an edit this
          // save never carried.
          if (editCountRef.current === savedAt) unsavedRef.current = false;
          return true;
        } catch (e: any) {
          toast.error(e?.message ?? "Could not save");
          return false;
        } finally {
          setSaving(false);
        }
      });
    saveChain.current = run;
    return run;
  }

  /**
   * Write anything still sitting in the autosave debounce, and report whether
   * the stored row now matches the editor.
   *
   * "Export PDF" and "Save as a New Template" both work from the *stored* row,
   * not from what is on screen - so running either inside the 1.2s debounce
   * window produced a PDF, or a template, of the document as it was before the
   * last thing typed. Neither announced that; you simply got the wrong file.
   */
  async function flushPendingSave(): Promise<boolean> {
    if (unsavedRef.current) return queueSave();
    // Nothing outstanding, but a save may still be on the wire.
    await saveChain.current.catch(() => {});
    return !unsavedRef.current;
  }

  useEffect(() => {
    if (loading) return;
    /*
     * Nothing to write until the user has actually changed something.
     * Merely opening a document produces debounce ticks of its own, and acting
     * on those meant every visit rewrote the row - burning a version, moving
     * "Last updated", and writing whatever the debounced snapshots happened to
     * hold at the time. `markDirty` runs on editor updates, title edits and
     * header/footer changes, and `setContent` on load is deliberately
     * `emitUpdate: false`, so this is true exactly when there are real edits.
     */
    if (!dirtyRef.current) return;
    void queueSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    debouncedTitle,
    debouncedHtml,
    debouncedHeaderHtml,
    debouncedFooterHtml,
    showHeader,
    showFooter,
    loading,
  ]);

  useBlocker({
    shouldBlockFn: async () => {
      if (freshRef.current && !dirtyRef.current) {
        // Never-edited page created via "Create" - drop it instead of leaving an
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
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      // The Clipboard API rejects outside a secure context, and in some
      // browsers when the document isn't focused. Unhandled, that was a silent
      // no-op plus a console rejection - the link sits right there, so say to
      // copy it by hand.
      toast.error("Couldn't copy automatically - select the link and copy it");
    }
  }

  /**
   * The library, cached for this page visit.
   *
   * A failed read resolves to an empty list rather than throwing: it only costs
   * the "Update template" item and a smarter default name, neither of which is
   * worth blocking the menu on.
   */
  const ensureLibrary = useCallback(async () => {
    if (library) return library;
    const templates = await listDocumentTemplates()
      .then((res) => res.templates)
      .catch(() => [] as DocumentTemplateSummary[]);
    setLibrary(templates);
    return templates;
  }, [library]);

  /**
   * The template this page came from, when it is one this team can write to.
   *
   * Examples are excluded: they are shared with every company, RLS rejects the
   * write, and the API refuses it - so offering the item would be offering a
   * button that cannot work.
   */
  const sourceTemplate = useMemo(
    () => library?.find((t) => t.id === sourceTemplateId && !t.isExample) ?? null,
    [library, sourceTemplateId],
  );

  async function handleSaveAsTemplate() {
    /*
     * The library is read first so the prompt cannot offer a name that is
     * already taken.
     *
     * This document's title is usually the exact name of the template it was
     * created from, and that title was the default. Accepting it produced a
     * second template with the same name as the first, holding this job's
     * version of it - which is the "then another template is created" half of
     * the duplication the client reported. `nextCopyName` numbers it instead,
     * the same way the Templates page numbers a copy.
     */
    const taken = (await ensureLibrary()).map((t) => t.name);
    const clash = taken.some((n) => n.trim().toLowerCase() === title.trim().toLowerCase());
    const name = await prompt({
      title: "Save as a new template",
      description:
        "Adds a reusable copy to Templates → Documents, blanked of this job's photos and answers. This document keeps its own edits either way - you only need a template if every future job should start from this layout.",
      label: "Template name",
      defaultValue: clash ? nextCopyName(title, taken) : title,
    });
    if (!name) return;
    try {
      // The template is built from the stored row, so anything still in the
      // autosave debounce would be missing from it.
      if (!(await flushPendingSave())) {
        toast.error("Couldn't save your latest changes - template not created");
        return;
      }
      await savePageAsTemplate({ data: { pageId, name } });
      // The cached list no longer holds every name, and the next save would
      // offer this one back as a default. Dropped rather than appended so the
      // reload also picks up whatever a teammate added meanwhile.
      setLibrary(null);
      // It lands in the document library - say so, and offer the route there.
      toast.success(`Saved "${name}" to your templates`, {
        description: "Find it under Templates → Documents, or add it to a blueprint.",
        action: {
          label: "Open Templates",
          onClick: () => void navigate({ to: "/templates", search: { tab: "documents" } }),
        },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save template");
    }
  }

  /**
   * Fold this document back into the template it came from.
   *
   * Confirmed first, and named in the confirmation: this rewrites something the
   * whole team starts new jobs from, which is a different weight of action to
   * anything else in this editor.
   */
  async function handleUpdateTemplate() {
    if (!sourceTemplate) return;
    if (
      !(await confirm({
        title: `Update "${sourceTemplate.name}"?`,
        description:
          "The template picks up this document's layout and wording. This job's photos, typed-in answers and merged-in details are stripped out first, and documents already created from it are untouched.",
        confirmText: "Update template",
      }))
    )
      return;
    try {
      // Built from the stored row, so anything still in the autosave debounce
      // would be missing from it - same reason as the PDF export.
      if (!(await flushPendingSave())) {
        toast.error("Couldn't save your latest changes - template not updated");
        return;
      }
      await updateTemplateFromPage({ data: { pageId } });
      setLibrary(null);
      toast.success(`"${sourceTemplate.name}" updated`, {
        description: "Every new job that starts from it gets this version.",
        action: {
          label: "Open Templates",
          onClick: () => void navigate({ to: "/templates", search: { tab: "documents" } }),
        },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update template");
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      // The PDF is rendered from the stored row, so exporting inside the
      // autosave debounce handed the client a document missing whatever was
      // typed in the last second or so. Better to fail loudly than to export
      // a stale one.
      if (!(await flushPendingSave())) {
        toast.error("Couldn't save your latest changes - export cancelled");
        return;
      }
      const res = await generatePagePdf({ data: { pageId } });
      downloadBase64File(res.pdfBase64, res.filename);
      toast.success("Exported to PDF");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not export PDF");
    } finally {
      setExporting(false);
    }
  }

  /**
   * Focus handed back to the editor once a modal has closed.
   *
   * Radix marks everything outside an open modal `aria-hidden`, and the editor
   * lives outside these dialogs. Calling `editor.commands.focus()` from inside
   * one therefore moved focus into an aria-hidden subtree, which the browser
   * refuses: "Blocked aria-hidden on an element because its descendant retained
   * focus." So the *focus* waits for `onCloseAutoFocus`, which fires after the
   * dialog has gone and the attribute with it.
   *
   * Only the focus waits. Document edits are applied immediately, while the
   * dialog is still up: a transaction queued here is lost outright if this
   * never fires, and a photo that silently never arrives is indistinguishable
   * from one inserted in the wrong place.
   */
  const afterDialogClose = useRef<(() => void) | null>(null);
  function runAfterDialogClose(e: Event) {
    const fn = afterDialogClose.current;
    afterDialogClose.current = null;
    if (!fn) return;
    // Radix would otherwise return focus to the trigger, undoing the caret
    // placement the edit just made.
    e.preventDefault();
    fn();
  }
  /** Put the caret back in the document once the dialog has closed. */
  function queueRefocus() {
    afterDialogClose.current = () => {
      if (editor && !editor.isDestroyed) editor.commands.focus();
    };
  }

  /**
   * Swap the image at `pos` for one carrying `attrs`, as a single transaction
   * over that exact range.
   *
   * Deliberately not `chain().focus().setNodeSelection(pos).setImage(attrs)`:
   * that spelling inserts *at the current selection*, so anything that leaves
   * the selection where the caret happened to be - a stale position, the focus
   * hand-off as the picker closes, an editor re-created mid-flight - quietly
   * turns the replace into an insert, and the photo lands beside the empty slot
   * it was meant to become instead of inside it. A `replaceWith` over an
   * explicit range cannot degrade that way, and needs no focus, so it is safe
   * to run while the dialog is still up.
   */
  function replaceImageAt(pos: number, attrs: Record<string, unknown>): boolean {
    if (!editor) return false;
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "image") return false;
    // The slot's own attrs go on first so its fixed width/height carry onto the
    // photo (styles.css then crops it to fit via object-fit) and the template's
    // layout never reflows just because a real photo's aspect ratio differs.
    //
    // An unfilled slot's `alt` is the template's authored label for that box
    // ("Wide shot - whole area", "Before", "After"), so an uncaptioned photo
    // inherits it rather than blanking it: the labelling is not recoverable
    // once gone, and it is also what tells two otherwise identical images apart
    // when the slot has to be re-found by identity.
    const alt =
      attrs.alt || (isPhotoSlot(node.attrs) ? (node.attrs.alt as string | null) : null) || "";
    const filled = editor.state.schema.nodes.image.create({ ...node.attrs, ...attrs, alt });
    editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, filled));
    return true;
  }

  function insertImage(photo: ProjectPhoto) {
    const target = picker.target;
    setPicker({ open: false, target: null });
    if (!editor) return;

    const attrs: Record<string, unknown> = {
      src: photo.url,
      alt: photo.caption ?? "",
      "data-photo-id": photo.id,
    };

    // Opened by clicking a slot (or an already-filled photo): that node is the
    // only place this photo may go.
    if (target) {
      const pos = findImagePos(editor.state.doc, target);
      if (pos === null || !replaceImageAt(pos, attrs)) {
        // Never fall back to inserting at the caret. A photo landing anywhere
        // other than the box that was clicked is precisely the bug this path
        // exists to prevent - say so instead of doing it quietly.
        toast.error("That photo slot is no longer in the document");
        return;
      }
      queueRefocus();
      return;
    }

    // Opened from the toolbar: fill a touching empty slot if there is one,
    // otherwise drop the photo at the caret.
    const nearbySlot = emptySlotNearSelection(editor.state.doc, editor.state.selection);
    if (nearbySlot !== null && replaceImageAt(nearbySlot, attrs)) {
      queueRefocus();
      return;
    }
    const { from, to } = editor.state.selection;
    editor.commands.insertContentAt({ from, to }, { type: "image", attrs });
    queueRefocus();
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
    setConfirmingDelete(null);
    void loadSnippets();
  }

  const filteredSnippets = useMemo(() => {
    const q = snippetSearch.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || stripHtml(s.content_html).toLowerCase().includes(q),
    );
  }, [snippets, snippetSearch]);

  async function saveSelectionAsSnippet() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) {
      toast.error("Select some text in the document first");
      return;
    }
    // Only the selected range - `editor.getHTML()` would capture the whole document.
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
    setConfirmingDelete(null);
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
      {/* Sticks just below AppHeader (h-[82px], also sticky top-0) rather than at top-0 itself -
          otherwise both stick to the same viewport position and AppHeader's higher z-index
          paints over this toolbar as soon as the page scrolls. */}
      <div className="sticky top-[82px] z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* `flex-1` so the title box can take the room the toolbar is not
              using. Document titles now lead with the project's name
              (page-title.ts), which made a fixed `max-w-xs` box show
              "Willow Street Retrofit - HVAC" and hide what the document
              actually is. The row wraps on narrow screens, so this costs the
              buttons nothing. */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() =>
                navigate({
                  to: "/projects/$projectId",
                  params: { projectId },
                  search: { panel: "documents" },
                })
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
              onBlur={() => {
                // Leaving the box empty keeps the stored title, so put it back
                // rather than showing a blank header for a page that has a name.
                if (!title.trim()) setTitle(savedTitleRef.current);
              }}
              // The full title on hover, for the one that is still too long to
              // fit. An input clips silently, with no ellipsis to say so.
              title={title}
              className="h-8 w-full min-w-0 max-w-xl border-none bg-transparent px-1 text-base font-extrabold shadow-none focus-visible:ring-1"
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
              {exporting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
              )}
              Export PDF
            </Button>
            <Button
              size="sm"
              variant={revoked ? "outline" : "default"}
              onClick={() => setShareOpen(true)}
            >
              <Share2 className="mr-1.5 h-3.5 w-3.5" />
              {revoked ? "Share" : "Shared"}
            </Button>
            <DropdownMenu onOpenChange={(o) => o && void ensureLibrary()}>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {/*
                  Both verbs, said plainly.

                  There used to be one, "Save as a New Template", and it reads
                  like the way to save this document - which it is not, the
                  document autosaves. So a crew that improved a template while
                  filling it in had no way to keep the improvement except adding
                  a second template beside the first, and a crew that merely
                  wanted to save their work added one by accident. Both are the
                  duplication the client reported.
                */}
                {sourceTemplate && (
                  <>
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Made from {sourceTemplate.name}
                    </DropdownMenuLabel>
                    <DropdownMenuItem onClick={handleUpdateTemplate}>
                      <Layers className="mr-2 h-4 w-4 text-primary" />
                      <span>
                        <span className="block font-bold">Update that template</span>
                        <span className="block text-xs text-muted-foreground">
                          Improves the one you already have instead of adding another.
                        </span>
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={handleSaveAsTemplate}>
                  <LayoutTemplate className="mr-2 h-4 w-4" />
                  <span>
                    <span className="block font-bold">Save as a new template</span>
                    <span className="block text-xs text-muted-foreground">
                      A separate template for future jobs. This document is already saved.
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <DocumentToolbar
          editor={editor}
          onAddImage={() =>
            // Explicitly "put a photo here", not "fill that slot" - no target,
            // so this can't silently fill a box the user is no longer looking at.
            setPicker({ open: true, target: null })
          }
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
        open={picker.open}
        onOpenChange={(open) => setPicker((p) => (open ? p : { open: false, target: null }))}
      >
        <DialogContent
          className="max-h-[80vh] max-w-2xl overflow-hidden p-0"
          onCloseAutoFocus={runAfterDialogClose}
        >
          <div className="flex max-h-[80vh] flex-col">
            <DialogHeader className="border-b px-6 pb-4 pt-5">
              <DialogTitle>
                {/* Three states, not two: clicking a filled photo is a swap, not
                    a fill, and saying "Fill this photo slot" over a photo that
                    already has one read as though it would add a second. */}
                {picker.target === null
                  ? "Insert a project photo"
                  : isPhotoSlot(picker.target.node.attrs)
                    ? "Fill this photo slot"
                    : "Change this photo"}
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4">
              {photos.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No photos in this project yet.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => insertImage(p)}
                      // An uncaptioned photo left the button with no accessible
                      // name at all - `alt=""` on the only child announces as a
                      // bare "button".
                      aria-label={p.caption?.trim() || "Use this photo"}
                      className="aspect-square overflow-hidden rounded-md border border-border hover:ring-2 hover:ring-primary"
                    >
                      <img
                        src={p.url}
                        alt={p.caption ?? ""}
                        className="h-full w-full object-cover"
                      />
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
                  {revoked
                    ? "Only you can see this document"
                    : "Viewers can read and download a PDF"}
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
        <DialogContent
          className="max-h-[80vh] max-w-lg overflow-hidden p-0"
          onCloseAutoFocus={runAfterDialogClose}
        >
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
                      {confirmingDelete === s.id ? (
                        // Asked and answered in the row itself - see confirmingDelete.
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="mr-1 text-xs font-bold text-muted-foreground">
                            Delete?
                          </span>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="font-bold"
                            onClick={() => void handleDeleteSnippet(s.id)}
                          >
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmingDelete(null)}
                          >
                            Keep
                          </Button>
                        </div>
                      ) : (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            className="font-bold"
                            onClick={() => {
                              // Inserted now at the caret the editor still holds;
                              // only the focus waits for the dialog to close (see
                              // afterDialogClose).
                              const { from, to } = editor.state.selection;
                              editor.commands.insertContentAt({ from, to }, s.content_html);
                              queueRefocus();
                              setSnippetsOpen(false);
                            }}
                          >
                            Use
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => setConfirmingDelete(s.id)}
                            aria-label="Delete snippet"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
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
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Markup for an inserted merge field. It shows the *resolved* value (the actual
 * company name), never `{{company}}` - nobody wants to see template source in
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

/**
 * Appends a field into a header/footer's single `<p>`.
 *
 * The fallback appends rather than replaces. A running block is paragraphs-only
 * today (`RunningBlock` passes `singleLine`, which disables headings, lists and
 * blockquotes), so the regex always matches and the fallback is unreachable -
 * but it used to return just the new token, which would have silently thrown
 * away whatever the block already contained the moment that stopped being true.
 */
function appendToken(current: string, html: string): string {
  if (/<\/p>\s*$/.test(current)) return current.replace(/<\/p>\s*$/, ` ${html}</p>`);
  return current ? `${current}<p>${html}</p>` : `<p>${html}</p>`;
}

/**
 * A running header or footer. When absent it renders as an invisible hover strip
 * that reveals a "+ Add header/footer" button - so a document with neither stays
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
        className={cn("group/add flex h-8 items-center justify-center", isHeader ? "mb-2" : "mt-2")}
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
        isHeader
          ? "mb-4 border-b border-dashed border-border pb-3"
          : "mt-6 border-t border-dashed border-border pt-3",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <RichTextEditor
            value={value}
            onChange={onChange}
            placeholder={`${isHeader ? "Header" : "Footer"} - appears on every page`}
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
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs font-bold text-muted-foreground"
        >
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
                  {resolved && !resolved.empty ? resolved.label : "Not set - add it in Settings"}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
