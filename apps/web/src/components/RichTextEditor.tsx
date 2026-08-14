import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  SeparatorHorizontal,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MergeToken } from "@/lib/tiptap-fill-field";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  // Hide block-level controls (used for short fields like titles/captions)
  compact?: boolean;
  // For single-line use (section titles): disable Enter creating new paragraphs visually
  singleLine?: boolean;
  // Keep the toolbar hidden until the field is focused - for editors embedded
  // inside a page's visual surface (e.g. a document header/footer), where a
  // permanently visible toolbar is distracting.
  toolbarOnFocus?: boolean;
  /**
   * Offer an "insert page break" control, and let <hr> through.
   *
   * Opt-in because this editor is shared with showcases, portfolio panels and
   * project pages, where a page is not a concept. In a report body an <hr> IS
   * the page break (see report-rich.ts).
   */
  pageBreaks?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 80,
  className,
  compact = false,
  singleLine = false,
  toolbarOnFocus = false,
  pageBreaks = false,
}: Props) {
  const [focused, setFocused] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: singleLine ? false : { levels: [1, 2, 3] },
        bulletList: singleLine ? false : {},
        orderedList: singleLine ? false : {},
        codeBlock: false,
        blockquote: false,
        horizontalRule: pageBreaks ? {} : false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      // Header/footer merge fields render as a pill showing the resolved
      // company/project value. Without this node registered, Tiptap would
      // strip the span on parse and the token would be lost on the next save.
      MergeToken,
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: cn(
          "tiptap prose prose-sm max-w-none focus:outline-none",
          "prose-headings:font-semibold prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5",
          "prose-li:my-0.5",
          singleLine && "single-line",
        ),
        style: `min-height: ${minHeight}px;`,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === "<p></p>" ? "" : html);
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  });

  // Sync external value changes (e.g. initial load)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || "";
    if (current === next || (current === "<p></p>" && !next)) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [value, editor]);

  const showToolbar = !toolbarOnFocus || focused;

  return (
    <div className={cn("rounded-md border border-input bg-background", className)}>
      {showToolbar && (
        <Toolbar
          editor={editor}
          compact={compact}
          singleLine={singleLine}
          pageBreaks={pageBreaks}
        />
      )}
      <div className={cn(toolbarOnFocus ? "px-1 py-0.5" : "px-3 py-2")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/**
 * One toolbar control.
 *
 * `onMouseDown` preventing default is the load-bearing line, not a nicety.
 * Pressing a button moves focus out of the contenteditable, which fires the
 * editor's `onBlur`. In `toolbarOnFocus` mode that sets `focused` to false and
 * React unmounts the toolbar *between mousedown and mouseup* - so no click event
 * ever lands and the command never runs. Every control in the document header,
 * the document footer and the two field-record write-ups was inert: the button
 * highlighted on hover, and did nothing.
 *
 * Found by clicking Bold in a browser and getting zero `<strong>` elements.
 * Suppressing the default mousedown keeps the selection and the focus where they
 * are, which is also why the always-visible toolbar now applies formatting to
 * the text you had selected rather than to a collapsed cursor.
 */
function ToolButton({
  active,
  onRun,
  label,
  title,
  children,
}: {
  active?: boolean;
  onRun: () => void;
  label: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
      data-active={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      aria-label={label}
      aria-pressed={active}
      title={title}
    >
      {children}
    </button>
  );
}

function Toolbar({
  editor,
  compact,
  singleLine,
  pageBreaks,
}: {
  editor: Editor | null;
  compact: boolean;
  singleLine: boolean;
  pageBreaks: boolean;
}) {
  if (!editor) return null;
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1 text-xs">
      <ToolButton
        active={editor.isActive("bold")}
        onRun={() => editor.chain().focus().toggleBold().run()}
        label="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={editor.isActive("italic")}
        onRun={() => editor.chain().focus().toggleItalic().run()}
        label="Italic"
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolButton>
      {!singleLine && !compact && (
        <>
          <span className="mx-1 h-4 w-px bg-border" />
          <ToolButton
            active={editor.isActive("heading", { level: 1 })}
            onRun={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            label="Heading 1"
          >
            <Heading1 className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("heading", { level: 2 })}
            onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            label="Heading 2"
          >
            <Heading2 className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("heading", { level: 3 })}
            onRun={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            label="Heading 3"
          >
            <Heading3 className="h-3.5 w-3.5" />
          </ToolButton>
          <span className="mx-1 h-4 w-px bg-border" />
          <ToolButton
            active={editor.isActive("bulletList")}
            onRun={() => editor.chain().focus().toggleBulletList().run()}
            label="Bullet list"
          >
            <List className="h-3.5 w-3.5" />
          </ToolButton>
          <ToolButton
            active={editor.isActive("orderedList")}
            onRun={() => editor.chain().focus().toggleOrderedList().run()}
            label="Numbered list"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolButton>
          {pageBreaks && (
            <>
              <span className="mx-1 h-4 w-px bg-border" />
              <ToolButton
                onRun={() => editor.chain().focus().setHorizontalRule().run()}
                label="Insert page break"
                title="Insert page break - the rest of this section starts on a new page"
              >
                <SeparatorHorizontal className="h-3.5 w-3.5" />
              </ToolButton>
            </>
          )}
        </>
      )}
    </div>
  );
}
