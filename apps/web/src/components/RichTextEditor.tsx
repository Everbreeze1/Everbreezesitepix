import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered, Heading1, Heading2, Heading3 } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

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
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 80,
  className,
  compact = false,
  singleLine = false,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: singleLine ? false : { levels: [1, 2, 3] },
        bulletList: singleLine ? false : {},
        orderedList: singleLine ? false : {},
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
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
  });

  // Sync external value changes (e.g. initial load)
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || "";
    if (current === next || (current === "<p></p>" && !next)) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [value, editor]);

  return (
    <div className={cn("rounded-md border border-input bg-background", className)}>
      <Toolbar editor={editor} compact={compact} singleLine={singleLine} />
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({
  editor,
  compact,
  singleLine,
}: {
  editor: Editor | null;
  compact: boolean;
  singleLine: boolean;
}) {
  if (!editor) return null;
  const btnCls =
    "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground";
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1 text-xs">
      <button
        type="button"
        className={btnCls}
        data-active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-label="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={btnCls}
        data-active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-label="Italic"
      >
        <Italic className="h-3.5 w-3.5" />
      </button>
      {!singleLine && !compact && (
        <>
          <span className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            className={btnCls}
            data-active={editor.isActive("heading", { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            aria-label="Heading 1"
          >
            <Heading1 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={btnCls}
            data-active={editor.isActive("heading", { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            aria-label="Heading 2"
          >
            <Heading2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={btnCls}
            data-active={editor.isActive("heading", { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            aria-label="Heading 3"
          >
            <Heading3 className="h-3.5 w-3.5" />
          </button>
          <span className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            className={btnCls}
            data-active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            aria-label="Bullet list"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={btnCls}
            data-active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            aria-label="Numbered list"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
