/**
 * Markdown to the rich-block model in report-rich.ts.
 *
 * Our AI prompts emit a small, fully controlled subset of Markdown: `##`
 * headings, `-`/`1.` bullets, `**bold**`, `*italic*`, and plain paragraphs.
 * This turns that subset into HTML, and `markdownToRich` takes the extra step
 * into `RichBlock[]` so a PDF renderer can lay it out with real headings and
 * real bullet markers instead of flattening it to a wall of prose.
 *
 * Deliberately not a general Markdown parser. Adding one would mean a new
 * runtime dependency for a handful of block types we already dictate in the
 * system prompt.
 */
import { parseRich, type RichBlock } from "./report-rich";

export function markdownToHtml(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+?)\*/g, "$1<em>$2</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>");

  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li><p>${inline(bullet[1])}</p></li>`);
      continue;
    }

    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li><p>${inline(numbered[1])}</p></li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line.trim())}</p>`);
  }
  closeList();
  return out.join("");
}

/** Markdown straight to the blocks the PDF and preview renderers both consume. */
export function markdownToRich(md: string | null | undefined): RichBlock[] {
  if (!md || !md.trim()) return [];
  return parseRich(markdownToHtml(md));
}
