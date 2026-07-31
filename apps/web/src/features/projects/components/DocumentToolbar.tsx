import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
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
  Undo2,
  Redo2,
  Sparkles,
  Plus,
  AlignLeft,
  AlignCenter,
  AlignRight,
  LayoutList,
  Images,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePrompt } from "@/hooks/use-prompt";
import { sectionHtml, photoRowHtml } from "@/lib/tiptap-photo-slot";

/**
 * The document formatting toolbar, shared by the project page editor and the
 * template designer.
 *
 * It used to live only inside ProjectPageEditorPage, which meant the Templates
 * designer shipped a two-button editor (bold + italic) while the seeded
 * templates it was meant to author are full of tables, photo slots, task lists,
 * alignment and colour. Anyone designing their own template could not produce
 * what the built-in ones contain. One component now backs both surfaces.
 *
 * Project-only actions (inserting a real project photo, the snippet library,
 * running header/footer) are optional — omit the handler and the control is
 * hidden, which is how the template designer drops them without losing the
 * rest of the toolbar.
 */
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

const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** "Mod" renders as ⌘ on Apple hardware and Ctrl everywhere else. */
function keys(combo: string): string {
  return IS_MAC ? combo.replace("Mod", "⌘").replace("Shift", "⇧").replace("Alt", "⌥") : combo.replace("Mod", "Ctrl");
}

function ShortcutBadge({ shortcut }: { shortcut: string }) {
  return (
    <span className="rounded bg-primary-foreground/20 px-1.5 py-0.5 font-mono text-[10px] font-bold">
      {keys(shortcut)}
    </span>
  );
}

/**
 * A toolbar control that says what it does on hover and, where one exists,
 * teaches its keyboard shortcut. Previously these were bare icons with only an
 * aria-label, so the shortcuts were invisible unless you already knew them.
 */
function ToolbarButton({
  label,
  shortcut,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className={className} {...props}>
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2 font-bold">
        {label}
        {shortcut && <ShortcutBadge shortcut={shortcut} />}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Same hover explanation as ToolbarButton, but for controls that already
 * render their own element (a labelled Button, a dropdown trigger) instead of
 * a bare icon — so it wraps rather than renders the trigger.
 */
function ToolbarHint({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2 font-bold">
        {label}
        {shortcut && <ShortcutBadge shortcut={shortcut} />}
      </TooltipContent>
    </Tooltip>
  );
}

/** Continues the document's existing "Photo N" / "Section N" numbering. */
function countNodes(editor: Editor, match: (node: ProseMirrorNode) => boolean): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (match(node)) n += 1;
  });
  return n;
}

export function DocumentToolbar({
  editor,
  onAddImage,
  onOpenSnippets,
  onAddHeader,
  onAddFooter,
}: {
  editor: Editor;
  /** Insert a real project photo. Omitted in the template designer — a template
      has no project to pull photos from; it uses photo *slots* instead. */
  onAddImage?: () => void;
  onOpenSnippets?: () => void;
  onAddHeader?: () => void;
  onAddFooter?: () => void;
}) {
  // Numbering continues from what's already on the page, so a section added by
  // hand lines up with the ones a pre-built template shipped.
  const nextPhotoIndex = () => countNodes(editor, (n) => n.type.name === "image") + 1;
  const nextSectionNumber = () =>
    countNodes(editor, (n) => n.type.name === "heading" && n.attrs.level === 2) + 1;

  const onInsertSection = (photos: 0 | 2 | 3 | 4) => {
    editor
      .chain()
      .focus()
      .insertContent(sectionHtml(nextSectionNumber(), photos, nextPhotoIndex()))
      .run();
  };

  const onInsertPhotoRow = (count: 1 | 2 | 3 | 4) => {
    editor.chain().focus().insertContent(photoRowHtml(count, nextPhotoIndex())).run();
  };

  const prompt = usePrompt();
  // Darker resting colour and a heavier icon stroke: these were muted-grey 16px
  // glyphs that read as disabled. Active state now uses the accent so the
  // current formatting is obvious at a glance.
  const btnCls = (active?: boolean) =>
    cn(
      "rounded-md p-2 text-foreground/75 transition-colors hover:bg-muted hover:text-foreground",
      "[&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[2.25]",
      active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
    );
  const inTable = editor.isActive("table");

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex flex-wrap items-center gap-0.5 border-t border-border px-4 py-1.5 sm:px-6">
      <DropdownMenu>
        <ToolbarHint label="Text style">
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
        </ToolbarHint>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 className="mr-2 h-4 w-4" /> Heading 1
            <span className="ml-auto pl-4 font-mono text-[10px] text-muted-foreground">{keys("Mod+Alt+1")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className="mr-2 h-4 w-4" /> Heading 2
            <span className="ml-auto pl-4 font-mono text-[10px] text-muted-foreground">{keys("Mod+Alt+2")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 className="mr-2 h-4 w-4" /> Heading 3
            <span className="ml-auto pl-4 font-mono text-[10px] text-muted-foreground">{keys("Mod+Alt+3")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().setParagraph().run()}>
            <Pilcrow className="mr-2 h-4 w-4" /> Paragraph
            <span className="ml-auto pl-4 font-mono text-[10px] text-muted-foreground">{keys("Mod+Alt+0")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1.5 h-4 w-px bg-border" />

      <DropdownMenu>
        <ToolbarHint label="Font family">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-bold">
              {(editor.getAttributes("textStyle").fontFamily as string | undefined)?.replace(/,.*/, "") ?? "Font"}
            </Button>
          </DropdownMenuTrigger>
        </ToolbarHint>
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
        <ToolbarHint label="Font size">
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-bold">
              {(editor.getAttributes("textStyle").fontSize as string | undefined)?.replace("px", "") ?? "Size"}
            </Button>
          </DropdownMenuTrigger>
        </ToolbarHint>
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

      <ToolbarButton label="Bold" shortcut="Mod+B" className={btnCls(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </ToolbarButton>
      <ToolbarButton label="Italic" shortcut="Mod+I" className={btnCls(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </ToolbarButton>
      <ToolbarButton label="Underline" shortcut="Mod+U" className={btnCls(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon />
      </ToolbarButton>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton label="Text & highlight colour" className={btnCls()}>
            <Palette />
          </ToolbarButton>
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

      <ToolbarButton label="Checklist" shortcut="Mod+Shift+9" className={btnCls(editor.isActive("taskList"))} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks />
      </ToolbarButton>
      <ToolbarButton label="Bulleted list" shortcut="Mod+Shift+8" className={btnCls(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" shortcut="Mod+Shift+7" className={btnCls(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolbarButton>

      <span className="mx-1.5 h-4 w-px bg-border" />

      <ToolbarButton label="Align left" shortcut="Mod+Shift+L" className={btnCls(editor.isActive({ textAlign: "left" }))} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        <AlignLeft />
      </ToolbarButton>
      <ToolbarButton label="Align center" shortcut="Mod+Shift+E" className={btnCls(editor.isActive({ textAlign: "center" }))} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        <AlignCenter />
      </ToolbarButton>
      <ToolbarButton label="Align right" shortcut="Mod+Shift+R" className={btnCls(editor.isActive({ textAlign: "right" }))} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        <AlignRight />
      </ToolbarButton>

      <span className="mx-1.5 h-4 w-px bg-border" />

      <ToolbarButton
        label="Add link"
        className={btnCls(editor.isActive("link"))}
        onClick={async () => {
          const url = await prompt({ title: "Add link", label: "URL", placeholder: "https://" });
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
      >
        <LinkIcon />
      </ToolbarButton>
      {onAddImage && (
        <ToolbarButton label="Add photo" className={btnCls()} onClick={onAddImage}>
          <ImagePlus />
        </ToolbarButton>
      )}
      {/* One always-present table control — row/column actions enable once the cursor is inside a table, so the toolbar never shifts. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ToolbarButton label="Table" className={btnCls(inTable)}>
            <TableIcon />
          </ToolbarButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          >
            <Plus className="mr-2 h-4 w-4" /> Insert 3×3 table
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!inTable} onClick={() => editor.chain().focus().addRowBefore().run()}>
            Insert row above
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!inTable} onClick={() => editor.chain().focus().addRowAfter().run()}>
            Insert row below
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!inTable} onClick={() => editor.chain().focus().addColumnBefore().run()}>
            Insert column left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!inTable} onClick={() => editor.chain().focus().addColumnAfter().run()}>
            Insert column right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!inTable} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
            Toggle header row
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!inTable} onClick={() => editor.chain().focus().mergeOrSplit().run()}>
            Merge / split cells
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!inTable} onClick={() => editor.chain().focus().deleteRow().run()}>
            Delete row
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!inTable} onClick={() => editor.chain().focus().deleteColumn().run()}>
            Delete column
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!inTable}
            onClick={() => editor.chain().focus().deleteTable().run()}
            className="text-destructive focus:text-destructive"
          >
            Delete table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {onOpenSnippets && (
        <ToolbarHint label="Insert a saved snippet">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs font-bold text-primary hover:bg-primary/10 hover:text-primary"
            onClick={onOpenSnippets}
            aria-label="Text snippets"
          >
            <Sparkles className="h-4 w-4" /> Snippets
          </Button>
        </ToolbarHint>
      )}

      <DropdownMenu>
        {/* Labelled like Snippets — this is the other shortcut hub, and as a
            bare "+" nobody found what was inside it. */}
        <ToolbarHint label="Insert a section, photo row, header or footer">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs font-bold text-primary hover:bg-primary/10 hover:text-primary"
              aria-label="Insert"
            >
              <Plus className="h-4 w-4" /> Insert
            </Button>
          </DropdownMenuTrigger>
        </ToolbarHint>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Report section
          </DropdownMenuLabel>
          <DropdownMenuItem className="font-bold" onClick={() => onInsertSection(0)}>
            <LayoutList className="mr-2 h-4 w-4" /> Section (text only)
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="font-bold">
              <Images className="mr-2 h-4 w-4" /> Section with photos
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {([2, 3, 4] as const).map((n) => (
                <DropdownMenuItem key={n} className="font-bold" onClick={() => onInsertSection(n)}>
                  {n} photos per page
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Photos
          </DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="font-bold">
              <ImagePlus className="mr-2 h-4 w-4" /> Photo slot row
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {([1, 2, 3, 4] as const).map((n) => (
                <DropdownMenuItem key={n} className="font-bold" onClick={() => onInsertPhotoRow(n)}>
                  {n} {n === 1 ? "photo" : "photos"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {onAddImage && (
            <DropdownMenuItem className="font-bold" onClick={onAddImage}>
              <ImagePlus className="mr-2 h-4 w-4" /> Insert a photo now
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertContent('<h2>Notes</h2><p></p>')
                .run()
            }
          >
            <Pilcrow className="mr-2 h-4 w-4" /> <span className="font-bold">Notes section</span>
          </DropdownMenuItem>
          {(onAddHeader || onAddFooter) && <DropdownMenuSeparator />}
          {onAddHeader && (
            <DropdownMenuItem className="font-bold" onClick={onAddHeader}>
              Add header
            </DropdownMenuItem>
          )}
          {onAddFooter && (
            <DropdownMenuItem className="font-bold" onClick={onAddFooter}>
              Add footer
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1.5 h-4 w-px bg-border" />

      <ToolbarButton label="Undo" shortcut="Mod+Z" className={btnCls()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton label="Redo" shortcut="Mod+Shift+Z" className={btnCls()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 />
      </ToolbarButton>
    </div>
    </TooltipProvider>
  );

}
