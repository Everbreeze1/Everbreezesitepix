/**
 * Tiptap's document JSON back to the small Markdown subset our summaries use.
 *
 * The other direction is `markdownToHtml` in @everlumen/shared. Summaries are
 * stored as Markdown (`## Overview`, `- finding`, `**bold**`), and the summary
 * page edits them in place in a rich editor, so what the editor holds has to be
 * written back in the same shape. Only the nodes that subset produces are
 * handled; anything else is kept as its plain text rather than dropped.
 */

export interface TiptapNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string }>;
  content?: TiptapNode[];
}

function inline(nodes: TiptapNode[] | undefined): string {
  if (!nodes) return "";
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return " ";
      if (node.type !== "text") return inline(node.content);
      let text = node.text ?? "";
      if (!text.trim()) return text;
      const marks = new Set((node.marks ?? []).map((m) => m.type));
      // Keep surrounding spaces outside the markers: "** bold**" is not bold.
      const lead = text.match(/^\s*/)?.[0] ?? "";
      const trail = text.match(/\s*$/)?.[0] ?? "";
      text = text.trim();
      if (marks.has("code")) text = `\`${text}\``;
      if (marks.has("italic")) text = `*${text}*`;
      if (marks.has("bold")) text = `**${text}**`;
      return `${lead}${text}${trail}`;
    })
    .join("");
}

/** The text of a list item: its paragraphs joined, nested lists flattened in. */
function listItemLines(item: TiptapNode, marker: string): string[] {
  const lines: string[] = [];
  const text: string[] = [];
  for (const child of item.content ?? []) {
    if (child.type === "bulletList" || child.type === "orderedList") {
      lines.push(...listLines(child));
    } else {
      const t = inline(child.content).trim();
      if (t) text.push(t);
    }
  }
  return [`${marker} ${text.join(" ")}`.trimEnd(), ...lines];
}

function listLines(list: TiptapNode): string[] {
  const ordered = list.type === "orderedList";
  const start = Number(list.attrs?.start ?? 1) || 1;
  return (list.content ?? []).flatMap((item, i) =>
    listItemLines(item, ordered ? `${start + i}.` : "-"),
  );
}

export function tiptapToMarkdown(doc: TiptapNode | null | undefined): string {
  const blocks: string[] = [];
  for (const node of doc?.content ?? []) {
    switch (node.type) {
      case "heading": {
        const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 2) || 2));
        const text = inline(node.content).trim();
        if (text) blocks.push(`${"#".repeat(level)} ${text}`);
        break;
      }
      case "bulletList":
      case "orderedList":
        blocks.push(listLines(node).join("\n"));
        break;
      default: {
        const text = inline(node.content).trim();
        if (text) blocks.push(text);
      }
    }
  }
  return blocks.join("\n\n");
}
