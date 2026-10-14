import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Check, Heading2, Italic, List, ListOrdered, Loader2, Pencil } from "lucide-react";
import { markdownToHtml } from "@everlumen/shared";
import { cn } from "@/lib/utils";
import { tiptapToMarkdown } from "@/lib/tiptap-markdown";

/**
 * The summary's text, edited where it is read.
 *
 * "the summary should be editable on the spot. right now when i click to edit
 * summary i get that ugly window." The old Edit button swapped the page for a
 * monospace box of raw Markdown. Now the text itself is the editor: click into
 * it and type, a small toolbar appears while it has focus, and the change saves
 * on its own a moment after typing stops and again when you click away.
 *
 * The summary is still stored as Markdown (reports and the PDF read it that
 * way), so the editor loads it through `markdownToHtml` and writes it back with
 * `tiptapToMarkdown`.
 */

type SaveState = "idle" | "saving" | "saved" | "error";

/** How long typing has to pause before the change is saved. */
const AUTOSAVE_MS = 1200;

export function EditableSummaryText({
  markdown,
  onSave,
  className,
}: {
  markdown: string;
  onSave: (markdown: string) => Promise<void>;
  className?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  /** The text as last saved, so a click in and out without typing saves nothing. */
  const savedRef = useRef(markdown);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const flush = async (editor: Editor) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = tiptapToMarkdown(editor.getJSON());
    if (next === savedRef.current) return;
    setState("saving");
    try {
      await onSaveRef.current(next);
      savedRef.current = next;
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        // Markdown has no underline, and a pasted link would lose its address
        // on the way back, so neither is offered.
        link: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder: "Write the summary…" }),
    ],
    content: markdownToHtml(markdown),
    editorProps: {
      attributes: {
        class: "wt-markdown min-h-[6rem] focus:outline-none",
        "aria-label": "Summary text",
      },
    },
    onUpdate: ({ editor }) => {
      setState("idle");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(editor), AUTOSAVE_MS);
    },
    onFocus: () => setFocused(true),
    onBlur: ({ editor }) => {
      setFocused(false);
      void flush(editor);
    },
  });

  // A pending save still goes through if the page is left mid-sentence.
  useEffect(
    () => () => {
      if (timerRef.current && editor) void flush(editor);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );

  return (
    <div
      className={cn(
        "group relative rounded-xl border bg-muted/20 transition-colors",
        focused
          ? "border-primary/50 bg-background shadow-sm"
          : "border-border hover:border-primary/30",
        className,
      )}
    >
      <div className="flex min-h-9 items-center justify-between gap-2 border-b border-transparent px-3 pt-2">
        {focused && editor ? (
          <SummaryToolbar editor={editor} />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground opacity-0 transition group-hover:opacity-100">
            <Pencil className="h-3 w-3" />
            Click the text to edit
          </span>
        )}
        <SaveIndicator state={state} />
      </div>
      <div className="px-5 pb-5 pt-1 md:px-6">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    );
  if (state === "saved")
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  if (state === "error")
    return (
      <span className="shrink-0 text-[11px] text-destructive">
        Not saved. Click into the text and out again to retry.
      </span>
    );
  return null;
}

/** See RichTextEditor's ToolButton: preventing mousedown keeps focus in the text. */
function ToolButton({
  active,
  onRun,
  label,
  children,
}: {
  active?: boolean;
  onRun: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
      data-active={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      aria-label={label}
      aria-pressed={active}
      title={label}
    >
      {children}
    </button>
  );
}

function SummaryToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex items-center gap-0.5">
      <ToolButton
        active={editor.isActive("heading", { level: 2 })}
        onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Heading"
      >
        <Heading2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={editor.isActive("bold")}
        onRun={() => editor.chain().focus().toggleBold().run()}
        label="Bold"
      >
        <Bold className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={editor.isActive("italic")}
        onRun={() => editor.chain().focus().toggleItalic().run()}
        label="Italic"
      >
        <Italic className="h-4 w-4" />
      </ToolButton>
      <span className="mx-1 h-4 w-px bg-border" />
      <ToolButton
        active={editor.isActive("bulletList")}
        onRun={() => editor.chain().focus().toggleBulletList().run()}
        label="Bullet list"
      >
        <List className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={editor.isActive("orderedList")}
        onRun={() => editor.chain().focus().toggleOrderedList().run()}
        label="Numbered list"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolButton>
    </div>
  );
}
