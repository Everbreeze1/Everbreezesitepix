/**
 * Formatted text in the web's own storage format, editable on a phone.
 *
 * Import-free so all of it is tested, because this is the module that can lose
 * somebody's work.
 *
 * THE FORMAT
 *
 * `project_pages.content_html` and `report_sections.body` are the HTML that the
 * web's TipTap editor produces with `editor.getHTML()`: `<p>`, `<h1>`-`<h3>`,
 * `<ul>`/`<ol>` whose items wrap a `<p>`, and inline `<strong>`, `<em>`, `<u>`,
 * `<s>`, `<code>`, `<a target rel href>` and `<br>`. Pages also carry tables,
 * images, task lists, info panels, page breaks and fill-in fields.
 *
 * THE MODEL
 *
 * The document is a list of top-level blocks. A paragraph, heading or list item
 * whose content this module fully understands becomes a **text block**: runs of
 * text, each with a set of marks. Everything else - a table, an image, a task
 * list, a paragraph holding a merge token - becomes a **raw block** that keeps
 * its original HTML byte for byte. The phone shows raw blocks read-only and
 * writes them back untouched, so saving a page can never drop a table the phone
 * cannot draw.
 *
 * Inline markup the phone has no button for (a coloured `<span>`, a highlight,
 * a fill-in field) is kept as an opaque mark: the text inside can be edited,
 * and the element around it is written back with its attributes as they were.
 *
 * THE PROMISE
 *
 * Every text block is checked before it is offered for editing: serialise it,
 * parse the result, and it must come back identical, with the same visible
 * text as the source. A block that fails either check stays raw. Being unable
 * to edit a paragraph is an annoyance; a lossy save is not recoverable.
 */

/* ------------------------------------------------------------ types ---- */

export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "strike" }
  | { type: "code" }
  /** `attrs` is the raw attribute string of the `<a>`, kept verbatim. */
  | { type: "link"; href: string; attrs: string }
  /** Anything else inline, kept as it was: a coloured span, a highlight, a fill-in field. */
  | { type: "other"; tag: string; attrs: string };

export type MarkType = Mark["type"];

export type Run = { text: string; marks: Mark[] };

export type TextKind = "paragraph" | "heading" | "bullet" | "number";

export type TextBlock = {
  id: string;
  kind: TextKind;
  /** Heading level, 1 to 6. Kept on other kinds so switching back restores it. */
  level: number;
  runs: Run[];
  /**
   * Raw attributes of the `<p>`/`<hN>` (for a list item, of its inner `<p>`),
   * written back verbatim. This is how text alignment survives a phone edit.
   */
  attrs: string;
  /** List items: consecutive items with the same id are one list. */
  listId: string;
  /** Raw attributes of the `<ul>`/`<ol>`: `start="3"` on a numbered list. */
  listAttrs: string;
  /** The item wraps its text in `<p>`, which is what TipTap writes. */
  wrap: boolean;
};

export type RawBlock = { id: string; kind: "raw"; html: string };

export type DocBlock = TextBlock | RawBlock;

export function isTextBlock(block: DocBlock): block is TextBlock {
  return block.kind !== "raw";
}

/* --------------------------------------------------------- entities ---- */

/** Named entities worth decoding. An unknown one makes its block raw rather than guessed. */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  laquo: "\u00ab",
  raquo: "\u00bb",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  deg: "\u00b0",
  times: "\u00d7",
  divide: "\u00f7",
  plusmn: "\u00b1",
  bull: "\u2022",
  middot: "\u00b7",
  euro: "\u20ac",
  pound: "\u00a3",
  cent: "\u00a2",
  yen: "\u00a5",
  sect: "\u00a7",
  para: "\u00b6",
  micro: "\u00b5",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  sup2: "\u00b2",
  sup3: "\u00b3",
  shy: "\u00ad",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
};

/** HTML text to plain text, or null when it holds an entity this does not know. */
export function decodeHtmlText(html: string): string | null {
  let failed = false;
  const out = html.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
        failed = true;
        return whole;
      }
      return String.fromCodePoint(code);
    }
    const named = NAMED[body];
    if (named === undefined) {
      failed = true;
      return whole;
    }
    return named;
  });
  return failed ? null : out;
}

/** Plain text to HTML text, the way a browser's `innerHTML` writes it. */
export function encodeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

/** A value for inside a double-quoted attribute. */
export function encodeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\u00a0/g, "&nbsp;");
}

/* -------------------------------------------------------- tokeniser ---- */

type Token =
  | { t: "text"; raw: string; start: number; end: number }
  | { t: "comment"; raw: string; start: number; end: number }
  | {
      t: "open";
      name: string;
      attrs: string;
      selfClose: boolean;
      raw: string;
      start: number;
      end: number;
    }
  | { t: "close"; name: string; raw: string; start: number; end: number };

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/* An attribute is a name, optionally `=` and a quoted or bare value. */
const ATTRS = `((?:\\s+[^\\s"'>/=]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>\`]+))?)*)`;
const OPEN_TAG = new RegExp(`<([a-zA-Z][a-zA-Z0-9:-]*)${ATTRS}\\s*(/?)>`, "y");
const CLOSE_TAG = /<\/([a-zA-Z][a-zA-Z0-9:-]*)\s*>/y;

function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let textStart = 0;
  const flushText = (until: number) => {
    if (until > textStart) {
      tokens.push({ t: "text", raw: source.slice(textStart, until), start: textStart, end: until });
    }
  };
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) break;
    if (source.startsWith("<!--", lt)) {
      const close = source.indexOf("-->", lt + 4);
      const end = close === -1 ? source.length : close + 3;
      flushText(lt);
      tokens.push({ t: "comment", raw: source.slice(lt, end), start: lt, end });
      i = textStart = end;
      continue;
    }
    OPEN_TAG.lastIndex = lt;
    const open = OPEN_TAG.exec(source);
    if (open) {
      flushText(lt);
      const end = lt + open[0].length;
      tokens.push({
        t: "open",
        name: open[1].toLowerCase(),
        attrs: open[2] ?? "",
        selfClose: open[3] === "/",
        raw: open[0],
        start: lt,
        end,
      });
      i = textStart = end;
      continue;
    }
    CLOSE_TAG.lastIndex = lt;
    const close = CLOSE_TAG.exec(source);
    if (close) {
      flushText(lt);
      const end = lt + close[0].length;
      tokens.push({ t: "close", name: close[1].toLowerCase(), raw: close[0], start: lt, end });
      i = textStart = end;
      continue;
    }
    // A `<` that starts no tag is text, as it is to a browser.
    i = lt + 1;
  }
  flushText(source.length);
  return tokens;
}

function isEmptyElement(token: Token): boolean {
  return token.t === "open" && (token.selfClose || VOID.has(token.name));
}

/** Top-level chunks: one element (with everything inside it), loose text, or a comment. */
type Chunk = { start: number; end: number; tokens: Token[]; element: boolean };

function topLevelChunks(source: string, tokens: Token[]): Chunk[] {
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.t === "text") {
      if (token.raw.trim())
        chunks.push({ start: token.start, end: token.end, tokens: [token], element: false });
      i += 1;
      continue;
    }
    if (token.t === "comment" || token.t === "close") {
      // A stray closing tag at the top level is kept as it was, like a comment.
      chunks.push({ start: token.start, end: token.end, tokens: [token], element: false });
      i += 1;
      continue;
    }
    if (isEmptyElement(token)) {
      chunks.push({ start: token.start, end: token.end, tokens: [token], element: true });
      i += 1;
      continue;
    }
    // Walk to the matching close. Anything malformed takes the rest of the document raw.
    const stack: string[] = [token.name];
    let j = i + 1;
    let ok = false;
    for (; j < tokens.length; j += 1) {
      const inner = tokens[j];
      if (inner.t === "open" && !isEmptyElement(inner)) stack.push(inner.name);
      else if (inner.t === "close") {
        const at = stack.lastIndexOf(inner.name);
        if (at === -1) break;
        stack.length = at;
        if (stack.length === 0) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) {
      chunks.push({
        start: token.start,
        end: source.length,
        tokens: tokens.slice(i),
        element: false,
      });
      break;
    }
    chunks.push({
      start: token.start,
      end: tokens[j].end,
      tokens: tokens.slice(i, j + 1),
      element: true,
    });
    i = j + 1;
  }
  return chunks;
}

/* ------------------------------------------------------------ marks ---- */

/*
 * The order ProseMirror nests marks in, which is their order in the web
 * editor's schema: Link has priority 1000 so it is outermost, then StarterKit's
 * bold, code and italic, strike, and the separately registered underline;
 * text-style spans and highlights come after. Writing marks in the same order
 * is what makes the phone's HTML the same HTML the web would write.
 */
const RANK: Record<MarkType, number> = {
  link: 0,
  bold: 1,
  code: 2,
  italic: 3,
  strike: 4,
  underline: 5,
  other: 6,
};

export function sameMark(a: Mark, b: Mark): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "link" && b.type === "link") return a.href === b.href && a.attrs === b.attrs;
  if (a.type === "other" && b.type === "other") return a.tag === b.tag && a.attrs === b.attrs;
  return true;
}

/** Sorted into nesting order. Stable, so opaque marks keep the order they were found in. */
export function sortMarks(marks: readonly Mark[]): Mark[] {
  return marks
    .map((mark, index) => ({ mark, index }))
    .sort((a, b) => RANK[a.mark.type] - RANK[b.mark.type] || a.index - b.index)
    .map((entry) => entry.mark);
}

export function sameMarkSet(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  const left = sortMarks(a);
  const right = sortMarks(b);
  return left.every((mark, i) => sameMark(mark, right[i]));
}

/** Tags an opaque mark may be. Anything else inline (an image, an input) makes the block raw. */
const OTHER_INLINE = new Set([
  "span",
  "mark",
  "sub",
  "sup",
  "small",
  "font",
  "abbr",
  "cite",
  "q",
  "kbd",
  "var",
  "samp",
  "time",
  "ins",
  "big",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "strike",
  "code",
]);

const SIMPLE: Record<string, MarkType> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  u: "underline",
  s: "strike",
  del: "strike",
  strike: "strike",
  code: "code",
};

function readAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i").exec(
    attrs,
  );
  if (!match) return null;
  return decodeHtmlText(match[1] ?? match[2] ?? match[3] ?? "") ?? null;
}

/** An inline element as a mark, or null when the block cannot hold it. */
function markFor(name: string, attrs: string): Mark | null {
  if (name === "a") {
    const href = readAttr(attrs, "href");
    return href === null ? null : { type: "link", href, attrs };
  }
  // A merge token is an atom on the web: its text is drawn from an attribute,
  // so typing inside it would change nothing there. Leave its block raw.
  if (/\sdata-token\b/i.test(attrs)) return null;
  const simple = SIMPLE[name];
  if (simple && !attrs.trim()) return { type: simple } as Mark;
  if (OTHER_INLINE.has(name)) return { type: "other", tag: name, attrs };
  return null;
}

/** Opaque marks that are a place to type into, kept even when emptied: a fill-in field. */
function keepsWhenEmpty(mark: Mark): boolean {
  return mark.type === "other" && /\sdata-fill-field\b/i.test(mark.attrs);
}

function openTag(mark: Mark): string {
  switch (mark.type) {
    case "bold":
      return "<strong>";
    case "italic":
      return "<em>";
    case "underline":
      return "<u>";
    case "strike":
      return "<s>";
    case "code":
      return "<code>";
    case "link":
      return `<a${mark.attrs}>`;
    case "other":
      return `<${mark.tag}${mark.attrs}>`;
  }
}

function closeTag(mark: Mark): string {
  switch (mark.type) {
    case "bold":
      return "</strong>";
    case "italic":
      return "</em>";
    case "underline":
      return "</u>";
    case "strike":
      return "</s>";
    case "code":
      return "</code>";
    case "link":
      return "</a>";
    case "other":
      return `</${mark.tag}>`;
  }
}

/**
 * A new link, written the way the web's Link extension writes one: its default
 * `target` and `rel` first, then `href`.
 */
export function linkMark(href: string): Mark {
  return {
    type: "link",
    href,
    attrs: ` target="_blank" rel="noopener noreferrer nofollow" href="${encodeAttribute(href)}"`,
  };
}

/** Adds a scheme to a bare address, so `acme.com` is a link and not a relative path. */
export function normaliseHref(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (/^\+?[0-9 ()-]{6,}$/.test(value)) return `tel:${value.replace(/[^0-9+]/g, "")}`;
  return `https://${value}`;
}

/* ---------------------------------------------------------- inline ---- */

/**
 * Inline tokens to runs, or null when something in them cannot be held.
 *
 * Whitespace is folded the way ProseMirror folds it when the web editor loads
 * the same HTML: runs of spaces and newlines become one space, and a space at
 * the start of the block, after a line break or after another space is dropped.
 */
function parseInline(tokens: Token[]): Run[] | null {
  const runs: Run[] = [];
  const stack: Mark[] = [];
  const names: string[] = [];
  let last = ""; // The last character written, "" at the start of the block.

  for (const token of tokens) {
    if (token.t === "comment") return null;
    if (token.t === "text") {
      const decoded = decodeHtmlText(token.raw);
      if (decoded === null) return null;
      let text = decoded.replace(/[ \t\r\n\f]+/g, " ");
      if (text.startsWith(" ") && (last === "" || last === " " || last === "\n"))
        text = text.slice(1);
      if (!text) continue;
      runs.push({ text, marks: [...stack] });
      last = text[text.length - 1];
      continue;
    }
    if (token.t === "open") {
      if (token.name === "br") {
        if (token.attrs.trim()) return null;
        runs.push({ text: "\n", marks: [...stack] });
        last = "\n";
        continue;
      }
      if (isEmptyElement(token)) return null;
      const mark = markFor(token.name, token.attrs);
      if (!mark) return null;
      stack.push(mark);
      names.push(token.name);
      // An element that holds nothing still has to survive if it is a field.
      if (keepsWhenEmpty(mark)) runs.push({ text: "", marks: [...stack] });
      continue;
    }
    // Closing: it must close the innermost open element.
    if (names[names.length - 1] !== token.name) return null;
    names.pop();
    stack.pop();
  }
  if (names.length) return null;

  // Trailing whitespace at the end of a block is dropped, as ProseMirror does.
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    if (!runs[i].text) continue;
    runs[i] = { ...runs[i], text: runs[i].text.replace(/ +$/, "") };
    if (runs[i].text) break;
  }
  return normaliseRuns(runs);
}

/** Merge neighbours with the same marks and drop empty runs (except empty fields). */
export function normaliseRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const keep = run.text.length > 0 || run.marks.some(keepsWhenEmpty);
    if (!keep) continue;
    const prev = out[out.length - 1];
    if (prev && prev.text && run.text && sameMarkSet(prev.marks, run.marks)) {
      out[out.length - 1] = { text: prev.text + run.text, marks: prev.marks };
    } else {
      out.push({ text: run.text, marks: sortMarks(run.marks) });
    }
  }
  return out;
}

/** Runs to inline HTML, nesting marks the way ProseMirror's serialiser does. */
export function serialiseRuns(runs: readonly Run[]): string {
  let out = "";
  let open: Mark[] = [];
  for (const run of normaliseRuns(runs)) {
    const marks = sortMarks(run.marks);
    let keep = 0;
    while (keep < open.length && keep < marks.length && sameMark(open[keep], marks[keep]))
      keep += 1;
    for (let i = open.length - 1; i >= keep; i -= 1) out += closeTag(open[i]);
    for (let i = keep; i < marks.length; i += 1) out += openTag(marks[i]);
    open = marks;
    out += run.text
      .split("\n")
      .map((part) => encodeHtmlText(part))
      .join("<br>");
  }
  for (let i = open.length - 1; i >= 0; i -= 1) out += closeTag(open[i]);
  return out;
}

/* ----------------------------------------------------------- blocks ---- */

let counter = 0;
/** Device-minted, so blocks made on two phones cannot collide. */
export function newId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function textBlock(
  kind: TextKind = "paragraph",
  runs: Run[] = [],
  extra: Partial<TextBlock> = {},
): TextBlock {
  return {
    id: newId(),
    kind,
    level: 2,
    runs,
    attrs: "",
    listId: kind === "bullet" || kind === "number" ? newId() : "",
    listAttrs: "",
    wrap: true,
    ...extra,
  };
}

export function rawBlock(html: string): RawBlock {
  return { id: newId(), kind: "raw", html };
}

/** The web's page break inside a report section is a horizontal rule. */
export const PAGE_BREAK_HTML = "<hr>";

/** Tokens between an element's open and close. */
function innerTokens(tokens: Token[]): Token[] {
  return tokens.slice(1, -1);
}

/** Splits a list's inner tokens into its `<li>` elements, or null when there is anything else. */
function listItems(tokens: Token[]): Token[][] | null {
  const items: Token[][] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.t === "text" && !token.raw.trim()) {
      i += 1;
      continue;
    }
    if (token.t !== "open" || token.name !== "li" || token.attrs.trim()) return null;
    let depth = 1;
    let j = i + 1;
    for (; j < tokens.length; j += 1) {
      const inner = tokens[j];
      if (inner.t === "open" && inner.name === "li") depth += 1;
      if (inner.t === "close" && inner.name === "li") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (j >= tokens.length) return null;
    items.push(tokens.slice(i + 1, j));
    i = j + 1;
  }
  return items.length ? items : null;
}

/** An element chunk as text blocks, or null when it has to stay raw. */
function chunkToBlocks(chunk: Chunk): TextBlock[] | null {
  const open = chunk.tokens[0];
  if (open.t !== "open" || isEmptyElement(open)) return null;
  const inner = innerTokens(chunk.tokens);

  if (open.name === "p") {
    const runs = parseInline(inner);
    return runs ? [textBlock("paragraph", runs, { attrs: open.attrs })] : null;
  }
  const heading = /^h([1-6])$/.exec(open.name);
  if (heading) {
    const runs = parseInline(inner);
    return runs
      ? [textBlock("heading", runs, { attrs: open.attrs, level: Number(heading[1]) })]
      : null;
  }
  if (open.name === "ul" || open.name === "ol") {
    // A task list is a list of checkboxes, which the phone does not draw.
    if (/data-type/i.test(open.attrs)) return null;
    const items = listItems(inner);
    if (!items) return null;
    const kind: TextKind = open.name === "ul" ? "bullet" : "number";
    const listId = newId();
    const blocks: TextBlock[] = [];
    for (const item of items) {
      const content = item.filter((t) => !(t.t === "text" && !t.raw.trim()));
      const first = content[0];
      const last = content[content.length - 1];
      const wrapped =
        first?.t === "open" &&
        first.name === "p" &&
        last?.t === "close" &&
        last.name === "p" &&
        // Exactly one paragraph: a second one, or a nested list, is not a single item.
        content.filter((t) => t.t === "open" && t.name === "p").length === 1;
      if (wrapped) {
        const runs = parseInline(content.slice(1, -1));
        if (!runs) return null;
        blocks.push(
          textBlock(kind, runs, { attrs: first.attrs, listId, listAttrs: open.attrs, wrap: true }),
        );
      } else {
        const runs = parseInline(item);
        if (!runs) return null;
        blocks.push(textBlock(kind, runs, { listId, listAttrs: open.attrs, wrap: false }));
      }
    }
    return blocks;
  }
  return null;
}

function listTag(kind: TextKind): "ul" | "ol" {
  return kind === "number" ? "ol" : "ul";
}

function isListItem(block: DocBlock): block is TextBlock & { kind: "bullet" | "number" } {
  return block.kind === "bullet" || block.kind === "number";
}

/** Blocks back to HTML, joined with nothing between them, as `getHTML()` does. */
export function serialiseDoc(blocks: readonly DocBlock[]): string {
  let out = "";
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.kind === "raw") {
      out += block.html;
      i += 1;
      continue;
    }
    if (isListItem(block)) {
      const tag = listTag(block.kind);
      let items = "";
      let j = i;
      while (j < blocks.length) {
        const item = blocks[j];
        if (!isListItem(item) || item.kind !== block.kind || item.listId !== block.listId) break;
        const body = serialiseRuns(item.runs);
        items += item.wrap ? `<li><p${item.attrs}>${body}</p></li>` : `<li>${body}</li>`;
        j += 1;
      }
      out += `<${tag}${block.listAttrs}>${items}</${tag}>`;
      i = j;
      continue;
    }
    const tag = block.kind === "heading" ? `h${clampLevel(block.level)}` : "p";
    out += `<${tag}${block.attrs}>${serialiseRuns(block.runs)}</${tag}>`;
    i += 1;
  }
  return out;
}

function clampLevel(level: number): number {
  return Math.min(6, Math.max(1, Math.round(level) || 2));
}

/** Visible text of some HTML, for comparing a rebuild with its source. */
export function visibleText(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|li|div|tr|td|th)>/gi, " ")
    .replace(/<[^>]*>/g, "");
  return (decodeHtmlText(text) ?? text).replace(/[ \t\r\n\f]+/g, " ").trim();
}

function sameContent(a: TextBlock, b: TextBlock): boolean {
  if (a.kind !== b.kind || a.attrs !== b.attrs || a.listAttrs !== b.listAttrs) return false;
  if (a.kind === "heading" && a.level !== b.level) return false;
  if ((a.kind === "bullet" || a.kind === "number") && a.wrap !== b.wrap) return false;
  const left = normaliseRuns(a.runs);
  const right = normaliseRuns(b.runs);
  if (left.length !== right.length) return false;
  return left.every(
    (run, i) => run.text === right[i].text && sameMarkSet(run.marks, right[i].marks),
  );
}

/**
 * Read stored HTML into blocks.
 *
 * Never fails and never drops anything: whatever cannot be read becomes a raw
 * block holding its original markup.
 */
export function parseDoc(html: string | null | undefined): DocBlock[] {
  const source = html ?? "";
  if (!source.trim()) return [];
  const tokens = tokenise(source);
  const blocks: DocBlock[] = [];
  for (const chunk of topLevelChunks(source, tokens)) {
    const raw = source.slice(chunk.start, chunk.end);
    const parsed = chunk.element ? chunkToBlocks(chunk) : null;
    if (parsed && verified(raw, parsed)) blocks.push(...parsed);
    else blocks.push(rawBlock(raw));
  }
  return blocks;
}

/**
 * The check that makes the promise real: rebuild the blocks, read the rebuild
 * back, and demand the same blocks and the same visible text as the source.
 */
function verified(raw: string, blocks: TextBlock[]): boolean {
  const rebuilt = serialiseDoc(blocks);
  if (visibleText(rebuilt) !== visibleText(raw)) return false;
  const tokens = tokenise(rebuilt);
  const again: TextBlock[] = [];
  for (const chunk of topLevelChunks(rebuilt, tokens)) {
    const parsed = chunk.element ? chunkToBlocks(chunk) : null;
    if (!parsed) return false;
    again.push(...parsed);
  }
  return again.length === blocks.length && again.every((block, i) => sameContent(block, blocks[i]));
}

/* --------------------------------------------------- text editing ---- */

export function runsText(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join("");
}

type Piece = { run: Run; from: number };

/**
 * The runs cut so that every position in `cuts` is a run boundary. Empty runs
 * (an emptied fill-in field) stay where they were, at their position.
 */
function cutRuns(runs: readonly Run[], cuts: number[]): Piece[] {
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: Piece[] = [];
  let at = 0;
  for (const run of runs) {
    if (!run.text) {
      out.push({ run, from: at });
      continue;
    }
    let piece = 0;
    for (const cut of sorted) {
      const local = cut - at;
      if (local > piece && local < run.text.length) {
        out.push({
          run: { text: run.text.slice(piece, local), marks: run.marks },
          from: at + piece,
        });
        piece = local;
      }
    }
    out.push({ run: { text: run.text.slice(piece), marks: run.marks }, from: at + piece });
    at += run.text.length;
  }
  return out;
}

/** The text runs covering `[start, end)`. */
export function sliceRuns(runs: readonly Run[], start: number, end: number): Run[] {
  return cutRuns(runs, [start, end])
    .filter((p) => p.run.text && p.from >= start && p.from < end)
    .map((p) => p.run);
}

/** The marks a character carries; null past either end. */
function marksOfChar(runs: readonly Run[], index: number): Mark[] | null {
  let at = 0;
  for (const run of runs) {
    if (index >= at && index < at + run.text.length) return run.marks;
    at += run.text.length;
  }
  return null;
}

/** An emptied fill-in field sitting at this position, if there is one. */
function emptyFieldAt(runs: readonly Run[], position: number): Run | null {
  let at = 0;
  for (const run of runs) {
    if (!run.text && at === position && run.marks.some(keepsWhenEmpty)) return run;
    at += run.text.length;
  }
  return null;
}

/**
 * What newly typed text is formatted as, where no toggle says otherwise: the
 * character before it, as in every editor. A link only continues when the
 * caret is inside it, never at its end, which is also how the web behaves.
 * Typing where an emptied fill-in field sits fills the field.
 */
export function inheritedMarks(runs: readonly Run[], start: number, end = start): Mark[] {
  const field = start === end ? emptyFieldAt(runs, start) : null;
  if (field) return field.marks;
  const before = marksOfChar(runs, start - 1);
  const after = marksOfChar(runs, end);
  const base = before ?? after ?? [];
  return base.filter((mark) => {
    if (mark.type !== "link" && !keepsWhenEmpty(mark)) return true;
    return Boolean(before && after && after.some((m) => sameMark(m, mark)));
  });
}

/** Replace `[start, end)` with `text` carrying `marks`. */
export function replaceRange(
  runs: readonly Run[],
  start: number,
  end: number,
  text: string,
  marks: Mark[],
): Run[] {
  const out: Run[] = [];
  let inserted = false;
  const insert = () => {
    if (inserted) return;
    inserted = true;
    if (text) out.push({ text, marks });
  };
  for (const { run, from } of cutRuns(runs, [start, end])) {
    if (run.text) {
      if (from < start) out.push(run);
      else if (from >= end) {
        insert();
        out.push(run);
      }
      continue;
    }
    if (from < start) out.push(run);
    else if (from > end) {
      insert();
      out.push(run);
    } else if (!(text && sameMarkSet(run.marks, marks))) {
      // A field at the edit is kept, unless this very edit is what fills it.
      out.push(run);
    }
  }
  insert();
  return normaliseRuns(out);
}

export type TextChange = { start: number; removed: number; inserted: string };

/**
 * Where two strings differ, as one replacement.
 *
 * `hint` is the selection before the change. When it explains the change
 * (typing over a selection, or at the caret), it is used, which puts a
 * repeated letter in the right place; otherwise common prefix and suffix.
 */
export function diffText(
  before: string,
  after: string,
  hint?: { start: number; end: number },
): TextChange {
  if (hint) {
    const { start, end } = hint;
    const insertedLength = after.length - (before.length - (end - start));
    if (
      start <= end &&
      end <= before.length &&
      insertedLength >= 0 &&
      after.startsWith(before.slice(0, start)) &&
      after.endsWith(before.slice(end)) &&
      start + insertedLength <= after.length &&
      (start !== end || insertedLength > 0)
    ) {
      return { start, removed: end - start, inserted: after.slice(start, start + insertedLength) };
    }
  }
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    start: prefix,
    removed: before.length - prefix - suffix,
    inserted: after.slice(prefix, after.length - suffix),
  };
}

/**
 * Apply what the text field now says to the runs.
 *
 * `pending` is the formatting chosen with the toolbar at a caret (Bold on,
 * then type); without it, new text takes the marks of the text before it.
 */
export function applyTextEdit(
  runs: readonly Run[],
  nextText: string,
  options: { hint?: { start: number; end: number }; pending?: Mark[] | null } = {},
): { runs: Run[]; change: TextChange } {
  const change = diffText(runsText(runs), nextText, options.hint);
  const marks =
    options.pending ?? inheritedMarks(runs, change.start, change.start + change.removed);
  return {
    runs: replaceRange(runs, change.start, change.start + change.removed, change.inserted, marks),
    change,
  };
}

/** Split into the text before `at` and after it. */
export function splitRuns(runs: readonly Run[], at: number): [Run[], Run[]] {
  const total = runsText(runs).length;
  const left: Run[] = [];
  const right: Run[] = [];
  for (const { run, from } of cutRuns(runs, [at])) {
    const goesLeft = run.text ? from < at : from < at || (from === at && at === total);
    (goesLeft ? left : right).push(run);
  }
  return [normaliseRuns(left), normaliseRuns(right)];
}

/** Whether every character in `[start, end)` carries a mark of this type. */
export function hasMark(runs: readonly Run[], start: number, end: number, type: MarkType): boolean {
  if (end <= start) return (marksOfChar(runs, start - 1) ?? []).some((m) => m.type === type);
  const covered = sliceRuns(runs, start, end).filter((run) => run.text.length > 0);
  return covered.length > 0 && covered.every((run) => run.marks.some((m) => m.type === type));
}

/** Toggle bold, italic and the like over a range. */
export function toggleMark(
  runs: readonly Run[],
  start: number,
  end: number,
  mark: Exclude<Mark, { type: "link" } | { type: "other" }>,
): Run[] {
  if (end <= start) return [...runs];
  const remove = hasMark(runs, start, end, mark.type);
  return mapRange(runs, start, end, (marks) =>
    remove
      ? marks.filter((m) => m.type !== mark.type)
      : [...marks.filter((m) => m.type !== mark.type), mark],
  );
}

/** Set or clear the link over a range. */
export function setLink(
  runs: readonly Run[],
  start: number,
  end: number,
  href: string | null,
): Run[] {
  if (end <= start) return [...runs];
  return mapRange(runs, start, end, (marks) => {
    const others = marks.filter((m) => m.type !== "link");
    return href ? [...others, linkMark(href)] : others;
  });
}

function mapRange(
  runs: readonly Run[],
  start: number,
  end: number,
  fn: (marks: Mark[]) => Mark[],
): Run[] {
  return normaliseRuns(
    cutRuns(runs, [start, end]).map(({ run, from }) =>
      run.text && from >= start && from < end ? { text: run.text, marks: fn(run.marks) } : run,
    ),
  );
}

/** The link around a position, as a range, or null. */
export function linkAt(
  runs: readonly Run[],
  start: number,
  end = start,
): { start: number; end: number; href: string } | null {
  const probe = end > start ? start : Math.max(0, start - 1);
  const marks = marksOfChar(runs, probe) ?? (end === start ? marksOfChar(runs, start) : null);
  const link = marks?.find((m): m is Extract<Mark, { type: "link" }> => m.type === "link");
  if (!link) return null;
  const has = (i: number) => (marksOfChar(runs, i) ?? []).some((m) => sameMark(m, link));
  let from = probe;
  while (from > 0 && has(from - 1)) from -= 1;
  let to = probe;
  const total = runsText(runs).length;
  while (to < total && has(to)) to += 1;
  return { start: from, end: to, href: link.href };
}

/* --------------------------------------------------- block editing ---- */

/**
 * Change a block's kind.
 *
 * A new list item joins the list next to it when that list is the same kind,
 * so turning three paragraphs into bullets one by one makes one list, not
 * three.
 */
export function setKind(
  blocks: readonly DocBlock[],
  id: string,
  kind: TextKind,
  level?: number,
): DocBlock[] {
  const at = blocks.findIndex((b) => b.id === id);
  if (at === -1) return [...blocks];
  const block = blocks[at];
  if (!isTextBlock(block)) return [...blocks];
  const next: TextBlock = { ...block, kind, level: level ?? block.level };
  if ((kind === "bullet" || kind === "number") && !(isListItem(block) && block.kind === kind)) {
    const prev = blocks[at - 1];
    const after = blocks[at + 1];
    const neighbour =
      prev && isListItem(prev) && prev.kind === kind
        ? prev
        : after && isListItem(after) && after.kind === kind
          ? after
          : null;
    next.listId = neighbour ? neighbour.listId : newId();
    next.listAttrs = neighbour ? neighbour.listAttrs : "";
    next.wrap = neighbour ? neighbour.wrap : true;
  }
  const out = [...blocks];
  out[at] = next;
  return out;
}

export function setRuns(blocks: readonly DocBlock[], id: string, runs: Run[]): DocBlock[] {
  return blocks.map((b) => (b.id === id && isTextBlock(b) ? { ...b, runs } : b));
}

export function moveDocBlock(blocks: readonly DocBlock[], id: string, by: -1 | 1): DocBlock[] {
  const from = blocks.findIndex((b) => b.id === id);
  const to = from + by;
  if (from === -1 || to < 0 || to >= blocks.length) return [...blocks];
  const next = [...blocks];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function removeDocBlock(blocks: readonly DocBlock[], id: string): DocBlock[] {
  return blocks.filter((b) => b.id !== id);
}

/**
 * A block after `afterId` (or at the end). After a list item, a new paragraph
 * request makes the next item of that list instead, which is what Enter does.
 */
export function insertAfter(
  blocks: readonly DocBlock[],
  afterId: string | null,
  block: DocBlock,
): DocBlock[] {
  if (!afterId) return [...blocks, block];
  const at = blocks.findIndex((b) => b.id === afterId);
  if (at === -1) return [...blocks, block];
  return [...blocks.slice(0, at + 1), block, ...blocks.slice(at + 1)];
}

/** The block Enter makes after this one: the next item of a list, or a paragraph. */
export function continuation(block: TextBlock, runs: Run[] = []): TextBlock {
  if (isListItem(block)) {
    return textBlock(block.kind, runs, {
      listId: block.listId,
      listAttrs: block.listAttrs,
      wrap: block.wrap,
      attrs: block.attrs,
    });
  }
  // After a heading, Enter starts ordinary text; a paragraph keeps its alignment.
  return textBlock("paragraph", runs, { attrs: block.kind === "paragraph" ? block.attrs : "" });
}

/**
 * Typing a new line splits the block, as Enter does on the web.
 *
 * Only line breaks the person just typed split: ones already in the text are
 * `<br>`s from the web and stay where they are.
 */
export function splitTypedLines(block: TextBlock, runs: Run[], change: TextChange): TextBlock[] {
  if (!change.inserted.includes("\n")) return [{ ...block, runs }];
  const out: TextBlock[] = [];
  let rest = runs;
  let current: TextBlock = block;
  let offset = change.start;
  const parts = change.inserted.split("\n");
  for (let p = 0; p < parts.length - 1; p += 1) {
    offset += parts[p].length;
    const [left, right] = splitRuns(rest, offset);
    out.push({ ...current, runs: left });
    // Drop the typed newline itself.
    rest = splitRuns(right, 1)[1];
    current = continuation(current);
    offset = 0;
  }
  out.push({ ...current, runs: rest });
  return out;
}

/** Replace one block with several. */
export function replaceBlock(
  blocks: readonly DocBlock[],
  id: string,
  next: DocBlock[],
): DocBlock[] {
  const at = blocks.findIndex((b) => b.id === id);
  if (at === -1) return [...blocks];
  return [...blocks.slice(0, at), ...next, ...blocks.slice(at + 1)];
}

/**
 * What gets saved: empty headings and list items the person made and left are
 * dropped, and so are empty paragraphs at the very end. Empty paragraphs in the
 * middle are spacing somebody chose and stay.
 */
export function blocksForSave(blocks: readonly DocBlock[]): DocBlock[] {
  const kept = blocks.filter(
    (b) => !(isTextBlock(b) && b.kind !== "paragraph" && b.runs.length === 0),
  );
  while (kept.length) {
    const last = kept[kept.length - 1];
    if (isTextBlock(last) && last.kind === "paragraph" && last.runs.length === 0) kept.pop();
    else break;
  }
  return kept;
}

/** The HTML to store for these blocks. Empty is "", as the web stores an empty editor. */
export function docHtml(blocks: readonly DocBlock[]): string {
  return serialiseDoc(blocksForSave(blocks));
}

/* ----------------------------------------------------------- display ---- */

/** What a raw block is, in a word, for the read-only card. */
export function rawLabel(html: string): string {
  const tag = /^\s*<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html)?.[1]?.toLowerCase() ?? "";
  if (tag === "table") return "Table";
  if (tag === "img" || tag === "figure") return "Photo";
  // A photo slot from a template is an image inside a paragraph.
  if (tag === "p" && /<img\b/i.test(html)) return "Photo";
  if (tag === "hr" || /data-page-break/i.test(html.slice(0, 200))) return "Page break";
  if ((tag === "ul" || tag === "ol") && /data-type\s*=\s*"taskList"/i.test(html))
    return "Checklist";
  if (tag === "ul" || tag === "ol") return "List";
  if (/^\s*<div[^>]*data-panel/i.test(html)) return "Info panel";
  if (/^\s*<div[^>]*data-spacer/i.test(html)) return "Spacer";
  if (tag === "blockquote") return "Quote";
  if (tag === "pre") return "Code";
  if (/^h[1-6]$/.test(tag)) return "Heading";
  if (tag === "p") return "Paragraph";
  if (/^\s*<!--/.test(html)) return "Note for the web";
  return "Web-only content";
}

/** The first of a raw block's text, so it can be recognised. */
export function rawPreview(html: string, max = 160): string {
  const text = visibleText(html);
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}
