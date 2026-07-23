// Shared rich-text utilities for report rendering.
// Parses a tiny HTML subset (produced by Tiptap StarterKit) into a block list
// used by BOTH the React preview and the pdf-lib PDF generator, so the two
// outputs stay in sync.
//
// Supported tags:
//   <h1>, <h2>, <h3>        → heading blocks
//   <p>                     → paragraph block
//   <ul><li>, <ol><li>      → list block (bulleted / numbered)
//   <strong>, <b>           → bold inline
//   <em>, <i>               → italic inline
//   <br>                    → hard line break
// Everything else is treated as a paragraph wrapper.

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type RichBlock =
  | { type: "heading"; level: 1 | 2 | 3; runs: InlineRun[] }
  | { type: "paragraph"; runs: InlineRun[] }
  | { type: "list"; ordered: boolean; items: InlineRun[][] };

// ---------------- tokenizer ----------------
interface Token {
  kind: "open" | "close" | "self" | "text";
  name?: string;
  text?: string;
}

const VOID_TAGS = new Set(["br", "hr", "img"]);

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const re = /<\/?([a-zA-Z0-9]+)[^>]*\/?>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[0];
    if (m[2] !== undefined) {
      tokens.push({ kind: "text", text: decodeEntities(m[2]) });
    } else {
      const name = (m[1] || "").toLowerCase();
      const isClose = raw.startsWith("</");
      const isSelf = raw.endsWith("/>") || VOID_TAGS.has(name);
      if (isClose) tokens.push({ kind: "close", name });
      else if (isSelf) tokens.push({ kind: "self", name });
      else tokens.push({ kind: "open", name });
    }
  }
  return tokens;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---------------- parser ----------------
export function parseRich(html: string | null | undefined): RichBlock[] {
  if (!html) return [];
  // Strip HTML comments (e.g. hidden idempotency markers) so they never render.
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  if (!html.trim()) return [];
  // Tiptap returns markup; plain strings are also fine.
  const looksLikeHtml = /<\/?[a-zA-Z]/.test(html);
  if (!looksLikeHtml) {
    // Treat as plain text — split by newlines into paragraphs.
    return html
      .replace(/\r\n/g, "\n")
      .split(/\n+/)
      .map((line) => ({
        type: "paragraph" as const,
        runs: [{ text: line }],
      }))
      .filter((b) => b.runs[0].text.length > 0);
  }

  const tokens = tokenize(html);
  const blocks: RichBlock[] = [];
  const styleStack: { bold: number; italic: number } = { bold: 0, italic: 0 };

  type Ctx =
    | { type: "para"; runs: InlineRun[] }
    | { type: "heading"; level: 1 | 2 | 3; runs: InlineRun[] }
    | { type: "list"; ordered: boolean; items: InlineRun[][] }
    | { type: "li"; runs: InlineRun[] };

  const ctxStack: Ctx[] = [];

  function activeRuns(): InlineRun[] | null {
    for (let i = ctxStack.length - 1; i >= 0; i--) {
      const c = ctxStack[i];
      if (c.type === "para" || c.type === "heading" || c.type === "li") return c.runs;
    }
    return null;
  }

  function pushText(text: string) {
    if (!text) return;
    let runs = activeRuns();
    if (!runs) {
      // No active block: implicit paragraph
      const p: Ctx = { type: "para", runs: [] };
      ctxStack.push(p);
      runs = p.runs;
    }
    runs.push({
      text,
      bold: styleStack.bold > 0 ? true : undefined,
      italic: styleStack.italic > 0 ? true : undefined,
    });
  }

  function flushTopBlock() {
    const c = ctxStack.pop();
    if (!c) return;
    // If we're inside an <li>, merge inline blocks into the list item's runs
    // (Tiptap wraps each list item's text in a <p>).
    const parent = ctxStack[ctxStack.length - 1];
    if (parent && parent.type === "li" && (c.type === "para" || c.type === "heading")) {
      if (parent.runs.length && c.runs.length) parent.runs.push({ text: "\n" });
      for (const r of c.runs) parent.runs.push(r);
      return;
    }
    if (c.type === "para") {
      if (c.runs.some((r) => r.text.trim().length > 0)) {
        blocks.push({ type: "paragraph", runs: c.runs });
      }
    } else if (c.type === "heading") {
      if (c.runs.some((r) => r.text.trim().length > 0)) {
        blocks.push({ type: "heading", level: c.level, runs: c.runs });
      }
    } else if (c.type === "list") {
      if (c.items.length) blocks.push({ type: "list", ordered: c.ordered, items: c.items });
    } else if (c.type === "li") {
      // Attach to parent list
      if (parent && parent.type === "list") parent.items.push(c.runs);
    }
  }


  for (const t of tokens) {
    if (t.kind === "text") {
      // Collapse whitespace-only between block tags
      const txt = t.text ?? "";
      if (!txt.trim() && !activeRuns()) continue;
      pushText(txt.replace(/\s+/g, " "));
      continue;
    }
    const name = t.name!;
    if (t.kind === "self") {
      if (name === "br") pushText("\n");
      continue;
    }
    if (t.kind === "open") {
      switch (name) {
        case "p":
          ctxStack.push({ type: "para", runs: [] });
          break;
        case "h1":
        case "h2":
        case "h3":
          ctxStack.push({ type: "heading", level: Number(name[1]) as 1 | 2 | 3, runs: [] });
          break;
        case "ul":
          ctxStack.push({ type: "list", ordered: false, items: [] });
          break;
        case "ol":
          ctxStack.push({ type: "list", ordered: true, items: [] });
          break;
        case "li":
          ctxStack.push({ type: "li", runs: [] });
          break;
        case "strong":
        case "b":
          styleStack.bold++;
          break;
        case "em":
        case "i":
          styleStack.italic++;
          break;
        default:
          // unknown wrapper — ignored
          break;
      }
      continue;
    }
    if (t.kind === "close") {
      switch (name) {
        case "strong":
        case "b":
          styleStack.bold = Math.max(0, styleStack.bold - 1);
          break;
        case "em":
        case "i":
          styleStack.italic = Math.max(0, styleStack.italic - 1);
          break;
        case "p":
        case "h1":
        case "h2":
        case "h3":
        case "li":
        case "ul":
        case "ol":
          flushTopBlock();
          break;
        default:
          break;
      }
    }
  }
  // Flush any remaining open blocks
  while (ctxStack.length) flushTopBlock();
  return blocks;
}

// ---------------- helpers ----------------
export function richIsEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  const blocks = parseRich(html);
  return blocks.every((b) => {
    if (b.type === "list") return b.items.every((it) => it.every((r) => !r.text.trim()));
    return b.runs.every((r) => !r.text.trim());
  });
}

export function richToPlainText(html: string | null | undefined): string {
  if (!html) return "";
  const blocks = parseRich(html);
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "list") {
      for (const it of b.items) out.push(it.map((r) => r.text).join(""));
    } else {
      out.push(b.runs.map((r) => r.text).join(""));
    }
  }
  return out.join("\n").trim();
}
