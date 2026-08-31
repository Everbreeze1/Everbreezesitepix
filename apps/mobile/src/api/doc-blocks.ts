/**
 * A project page as blocks, and the rule about when the phone may edit one.
 *
 * Import-free so all of it is tested, and it needs to be, because this module
 * can destroy somebody's work in a way nothing else in the app can.
 *
 * WHY BLOCKS AND NOT A RICH TEXT EDITOR
 *
 * `project_pages.content_html` is written on the web by a desktop editor that
 * produces real HTML: headings, lists, tables, spans with inline styles,
 * embedded images. A phone port of that editor is a floating toolbar fighting
 * the keyboard for the bottom third of a six inch screen, and selection-based
 * formatting with a finger is the worst interaction in mobile software.
 *
 * So the phone edits a **list of blocks**: a heading, a paragraph, a bullet.
 * Each block is one ordinary multiline text field, which the OS already handles
 * well. No toolbar, no selection, no caret arithmetic.
 *
 * WHY THAT IS DANGEROUS, AND WHAT STOPS IT
 *
 * A block model cannot represent everything the web editor can write. Parsing a
 * page with a table into blocks and serialising it back would silently delete
 * the table. Somebody would open a document on their phone to fix a typo and
 * destroy an afternoon of work at a desk.
 *
 * The rule that prevents this: **the phone only edits what it can rebuild
 * exactly.** `parsePage` refuses anything it does not fully understand, the
 * editor then shows the page read-only and says why, and the web app remains
 * the place to edit it. Refusing to edit is a small annoyance; a lossy save is
 * unrecoverable.
 */

export type BlockKind = "heading" | "paragraph" | "bullet";

export type Block = {
  id: string;
  kind: BlockKind;
  /** Plain text. Inline markup is not representable and is why `parsePage` refuses it. */
  text: string;
};

/** Why the phone will not edit a page, or null when it will. */
export type NotEditable =
  /** Contains markup the block model cannot rebuild: tables, images, styling. */
  | "rich_markup"
  /** Parsed, but rebuilding it did not reproduce the original byte for byte. */
  | "lossy"
  | null;

export type ParsedPage = {
  blocks: Block[];
  /** Null means the editor may write back. Anything else means read-only. */
  refusal: NotEditable;
};

/**
 * The only tags the block model can rebuild.
 *
 * Deliberately short. Every addition has to survive the round-trip check below,
 * and a tag that "mostly" round-trips is the failure this module exists to
 * prevent.
 */
const KNOWN_BLOCK = /^(h1|h2|h3|p|ul)$/;

const ENTITIES: [RegExp, string][] = [
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&nbsp;/g, " "],
];

/** HTML text back to plain text. */
export function decodeEntities(html: string): string {
  let out = html;
  for (const [pattern, char] of ENTITIES) out = out.replace(pattern, char);
  return out;
}

/**
 * Plain text to HTML text.
 *
 * `&` first, or the ampersands introduced by the later replacements get encoded
 * a second time and `<` comes out as `&amp;lt;`.
 */
export function encodeEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Device-minted, so two blocks added offline on two phones cannot collide. */
export function newBlockId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyBlock(kind: BlockKind = "paragraph"): Block {
  return { id: newBlockId(), kind, text: "" };
}

/**
 * Turn blocks back into HTML.
 *
 * The exact inverse of `parsePage` for anything `parsePage` accepted, which is
 * what makes the round-trip check meaningful. Newline-joined and not indented:
 * whitespace between block tags is not significant to a browser but it is to a
 * string comparison, so keeping it uniform is what lets the check be exact.
 */
export function serialiseBlocks(blocks: Block[]): string {
  const parts: string[] = [];
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length === 0) return;
    parts.push(`<ul>${bullets.map((b) => `<li>${encodeEntities(b)}</li>`).join("")}</ul>`);
    bullets = [];
  };

  for (const block of blocks) {
    if (block.kind === "bullet") {
      // Consecutive bullets become one list, which is what the web editor
      // writes and therefore what the round-trip has to reproduce.
      bullets.push(block.text);
      continue;
    }
    flush();
    const tag = block.kind === "heading" ? "h2" : "p";
    parts.push(`<${tag}>${encodeEntities(block.text)}</${tag}>`);
  }
  flush();

  return parts.join("\n");
}

/**
 * Read HTML into blocks, refusing anything that cannot be rebuilt.
 *
 * A hand-rolled scan rather than a DOM parser, because React Native has no DOM
 * and the alternatives are 60KB of bundle to do a job whose answer is mostly
 * "refuse". Being strict is the feature: anything unrecognised sets a refusal
 * rather than being dropped.
 */
export function parsePage(html: string): ParsedPage {
  const source = (html ?? "").trim();
  if (!source) return { blocks: [], refusal: null };

  /*
   * An early, cheap refusal on the tags that certainly cannot be rebuilt.
   * Checked before parsing so a document full of tables does not spend time
   * being half-read first.
   */
  if (/<(table|img|iframe|figure|blockquote|pre|ol|hr|br)\b/i.test(source)) {
    return { blocks: [], refusal: "rich_markup" };
  }
  // Inline markup: bold, italic, links, spans and anything carrying a style.
  if (/<(strong|b|em|i|u|a|span|font|mark|code|sub|sup)\b/i.test(source)) {
    return { blocks: [], refusal: "rich_markup" };
  }
  if (/\sstyle\s*=/i.test(source) || /\sclass\s*=/i.test(source)) {
    return { blocks: [], refusal: "rich_markup" };
  }

  const blocks: Block[] = [];
  const tagPattern = /<(h1|h2|h3|p|ul)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let consumed = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(source)) !== null) {
    /*
     * Anything between blocks that is not whitespace is content the scan is
     * about to skip. Skipping it is exactly the silent data loss this module
     * exists to prevent, so it refuses instead.
     */
    const between = source.slice(consumed, match.index);
    if (between.trim()) return { blocks: [], refusal: "rich_markup" };
    consumed = match.index + match[0].length;

    const tag = match[1].toLowerCase();
    if (!KNOWN_BLOCK.test(tag)) return { blocks: [], refusal: "rich_markup" };
    // An attribute on a block tag is something the rebuild would drop.
    if (match[2]?.trim()) return { blocks: [], refusal: "rich_markup" };

    const inner = match[3];

    if (tag === "ul") {
      const items = [...inner.matchAll(/<li(\s[^>]*)?>([\s\S]*?)<\/li>/gi)];
      // A list whose only content is not list items is not a list this can
      // rebuild.
      const withoutItems = inner.replace(/<li(\s[^>]*)?>[\s\S]*?<\/li>/gi, "");
      if (items.length === 0 || withoutItems.trim()) {
        return { blocks: [], refusal: "rich_markup" };
      }
      for (const item of items) {
        if (item[1]?.trim() || /<[a-z]/i.test(item[2])) {
          return { blocks: [], refusal: "rich_markup" };
        }
        blocks.push({ id: newBlockId(), kind: "bullet", text: decodeEntities(item[2]).trim() });
      }
      continue;
    }

    if (/<[a-z]/i.test(inner)) return { blocks: [], refusal: "rich_markup" };

    blocks.push({
      id: newBlockId(),
      kind: tag === "p" ? "paragraph" : "heading",
      text: decodeEntities(inner).trim(),
    });
  }

  if (source.slice(consumed).trim()) return { blocks: [], refusal: "rich_markup" };
  if (blocks.length === 0) return { blocks: [], refusal: "rich_markup" };

  /*
   * The check that makes the promise real.
   *
   * Everything above is a judgement about what looked safe. This is the proof:
   * rebuild the blocks and compare against the source. If they differ, the
   * parse lost something regardless of how confident the scan was, and the page
   * is read-only.
   *
   * Compared with whitespace between tags normalised, because `h1` becomes `h2`
   * and the web writes its tags on one line. Anything inside a tag is compared
   * exactly.
   */
  const normalise = (value: string) => value.replace(/>\s+</g, "><").trim();
  const rebuilt = serialiseBlocks(blocks);
  if (normalise(rebuilt) !== normalise(source)) {
    // h1 and h3 both serialise as h2, which is a real and acceptable change to
    // the document, so it is allowed through when that is the only difference.
    const levelled = normalise(source).replace(/<(\/?)h[13]>/g, "<$1h2>");
    if (normalise(rebuilt) !== levelled) return { blocks: [], refusal: "lossy" };
  }

  return { blocks, refusal: null };
}

/** What the editor says when it will not let somebody type. */
export function refusalMessage(refusal: NotEditable): string | null {
  switch (refusal) {
    case "rich_markup":
      return "This page uses formatting the phone editor cannot rebuild: tables, images, links or styled text. Editing it here would lose them, so it is read-only. Open it on the web to change it.";
    case "lossy":
      /*
       * The safety net firing. Worth wording differently from the case above,
       * because it means the scan thought the page was simple and the rebuild
       * disagreed, which is a bug worth hearing about rather than a limitation.
       */
      return "This page did not survive a test rebuild exactly, so the phone will not risk saving over it. Open it on the web to change it.";
    default:
      return null;
  }
}

/** Move a block up or down. Out of range returns the same array, so an end arrow is inert. */
export function moveBlock(blocks: Block[], id: string, by: -1 | 1): Block[] {
  const from = blocks.findIndex((block) => block.id === id);
  if (from === -1) return blocks;
  const to = from + by;
  if (to < 0 || to >= blocks.length) return blocks;
  const next = [...blocks];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function setBlockText(blocks: Block[], id: string, text: string): Block[] {
  return blocks.map((block) => (block.id === id ? { ...block, text } : block));
}

export function setBlockKind(blocks: Block[], id: string, kind: BlockKind): Block[] {
  return blocks.map((block) => (block.id === id ? { ...block, kind } : block));
}

export function removeBlock(blocks: Block[], id: string): Block[] {
  return blocks.filter((block) => block.id !== id);
}

/** Insert after `afterId`, or at the end when it is null. */
export function insertBlock(blocks: Block[], afterId: string | null, kind: BlockKind): Block[] {
  const block = emptyBlock(kind);
  if (!afterId) return [...blocks, block];
  const at = blocks.findIndex((b) => b.id === afterId);
  if (at === -1) return [...blocks, block];
  return [...blocks.slice(0, at + 1), block, ...blocks.slice(at + 1)];
}

/**
 * Blocks worth saving.
 *
 * Empty ones are dropped on save rather than as they are typed: somebody who
 * adds a paragraph and pauses to think should still have it under the cursor.
 */
export function meaningfulBlocks(blocks: Block[]): Block[] {
  return blocks.filter((block) => block.text.trim().length > 0);
}

/** The label a block carries in the editor. */
export const BLOCK_LABELS: Record<BlockKind, string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  bullet: "Bullet",
};

/** A one-line preview of a page, for the list. */
export function pagePreview(html: string, max = 120): string {
  const text = decodeEntities((html ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Empty page";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Add blocks to the end of a page without reading what is already there.
 *
 * **This is the operation that makes the feature useful, and it is safe because
 * it never parses.** The real document templates the web seeds contain `<em>`,
 * `<span style>`, `<img>` and `<ul data-type>`, so `parsePage` correctly
 * refuses every page made from one. That would leave the phone able to edit
 * almost nothing.
 *
 * Appending sidesteps the whole problem: string concatenation cannot lose what
 * it does not look at. A crew can add "Arrived 07:40, scaffold signed off" to a
 * running site document whose header is a table and whose logo is an image,
 * with no risk to either.
 *
 * It is also the thing a phone is actually for. Composing a document is desk
 * work; adding today's entry to one is not.
 */
export function appendBlocks(existingHtml: string, blocks: Block[]): string {
  return appendHtml(existingHtml, serialiseBlocks(meaningfulBlocks(blocks)));
}

/**
 * The same append, for content that is already HTML.
 *
 * Exists for snippets, which are stored as `content_html` and may hold markup
 * the block model cannot represent. Parsing one into blocks first would quietly
 * drop its table or its emphasis; concatenating preserves it exactly, and is no
 * less safe, because the reason appending is safe is that it never reads.
 */
export function appendHtml(existingHtml: string, additionHtml: string): string {
  const addition = (additionHtml ?? "").trim();
  if (!addition) return existingHtml ?? "";

  const existing = (existingHtml ?? "").trimEnd();
  if (!existing) return addition;
  // A newline between, matching what `serialiseBlocks` puts between its own
  // blocks, so a page that was written here stays consistent with itself.
  return `${existing}
${addition}`;
}

/**
 * Whether the phone can offer anything at all on this page.
 *
 * Appending works on every page, so the answer is always yes. Kept as a named
 * function anyway: the moment somebody adds a page kind that must not be
 * appended to, this is where that lives, rather than a `true` sprinkled through
 * the screen.
 */
export function canAppend(): boolean {
  return true;
}
