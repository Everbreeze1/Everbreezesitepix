import { pagePreview, parsePage, type Block } from "./doc-blocks";

/**
 * The snippet library.
 *
 * Saved blocks of text a crew reuses: a standing safety note, the wording for a
 * handover, the four lines that go at the top of every commissioning sheet.
 * They exist so nobody retypes them, which makes them worth more on a phone
 * than on a desktop, and the phone was the client that did not have them.
 *
 * Import-free of React Native, so the one genuinely awkward rule can be tested:
 * deciding what happens when a snippet contains formatting the phone's block
 * editor cannot represent.
 */

/** Mirrors the row `listTextSnippets` returns. Field names are the server's. */
export type TextSnippet = {
  id: string;
  title: string;
  content_html: string;
  created_at: string;
};

/** The server's own bounds, mirrored so the composer can refuse first. */
export const MAX_TITLE_LENGTH = 120;
export const MAX_SNIPPET_LENGTH = 20_000;

/**
 * How a snippet can be added to a page.
 *
 * Two ways, and which one applies is decided by the snippet rather than by the
 * person:
 *
 * `blocks` - the snippet parses cleanly into the phone's block model, so it can
 * be loaded into the composer and edited before it is added. This is the case
 * for anything written on the phone and for most plain snippets.
 *
 * `html` - it holds markup the block model cannot rebuild: a table, an image,
 * styled text. Parsing it into blocks would silently drop that, so it is
 * appended verbatim instead. Lossless, and honest about the consequence: the
 * page afterwards contains markup the phone cannot edit, so the phone drops to
 * append-only on it.
 *
 * There is no third case where formatting is quietly lost, which is the whole
 * point of splitting them.
 *
 * Worth knowing which way most snippets fall: `parsePage` refuses `<em>`,
 * `<a>` and `<span style>` as well as tables and images, so anything written in
 * the web's rich editor with a single bold word in it takes the `html` path.
 * That is the right outcome - it arrives intact - but it does mean the
 * append-verbatim branch is the common one rather than the exception.
 */
export type InsertMode = "blocks" | "html";

export type SnippetInsert = {
  mode: InsertMode;
  /** Present only for `blocks`. */
  blocks: Block[];
  /** What to tell somebody before they add it, or null when there is nothing to say. */
  caveat: string | null;
};

export function insertPlan(snippet: { content_html: string }): SnippetInsert {
  const parsed = parsePage(snippet.content_html ?? "");
  /*
   * Both halves, though `parsePage` today returns no blocks whenever it
   * refuses, so either alone would do. Kept because they answer different
   * questions - "is this safe to rebuild" and "is there anything here" - and a
   * future parser that returned partial blocks alongside a refusal would
   * otherwise start silently flattening tables. A test pins that contract.
   */
  if (parsed.refusal === null && parsed.blocks.length > 0) {
    return { mode: "blocks", blocks: parsed.blocks, caveat: null };
  }
  return {
    mode: "html",
    blocks: [],
    caveat:
      "This snippet has formatting the phone cannot edit, so it will be added to the end exactly as it is. You will not be able to change it here afterwards.",
  };
}

/** One line of the snippet, for the list row and for searching. */
export function snippetPreview(snippet: TextSnippet, max = 100): string {
  const preview = pagePreview(snippet.content_html ?? "", max);
  // `pagePreview` says "Empty page" for nothing at all, which is the wrong noun
  // here and would also be searchable text nobody typed.
  return preview === "Empty page" ? "" : preview;
}

/**
 * Filter by title or body.
 *
 * Body as well as title, because a crew names snippets things like "Standard 3"
 * and then looks for them by the words inside. Matching on title alone means
 * scrolling, which on a phone is the thing the library exists to avoid.
 */
export function filterSnippets(snippets: TextSnippet[], search: string): TextSnippet[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return snippets;
  return snippets.filter((snippet) => {
    if ((snippet.title ?? "").toLowerCase().includes(needle)) return true;
    return snippetPreview(snippet, MAX_SNIPPET_LENGTH).toLowerCase().includes(needle);
  });
}

/** Why this snippet cannot be saved, or null. Mirrors the server's schema. */
export function snippetTitleError(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return "Give it a name so you can find it again.";
  if (trimmed.length > MAX_TITLE_LENGTH) {
    return `That name is ${trimmed.length - MAX_TITLE_LENGTH} characters too long.`;
  }
  return null;
}

export function snippetBodyError(contentHtml: string): string | null {
  if (!contentHtml.trim()) return "There is nothing to save yet.";
  if (contentHtml.length > MAX_SNIPPET_LENGTH) {
    return "That is too long to save as a snippet.";
  }
  return null;
}

/**
 * A name suggested from the text itself.
 *
 * Offered rather than imposed, because the alternative is a library full of
 * "Untitled". The first few words of the first line is what somebody would have
 * typed anyway.
 */
export function suggestedTitle(contentHtml: string, max = 40): string {
  const text = snippetPreview(
    { id: "", title: "", content_html: contentHtml, created_at: "" },
    200,
  );
  if (!text) return "";
  const firstLine = text.split(/[.!?\n]/)[0].trim() || text;
  if (firstLine.length <= max) return firstLine;
  // Cut on a word boundary rather than mid-word, which reads as a truncation
  // bug rather than a suggestion.
  const cut = firstLine.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}

/** The subtitle over the list. */
export function librarySummary(total: number, shown: number): string {
  if (total === 0) return "No snippets saved yet";
  if (shown === total) return `${total} snippet${total === 1 ? "" : "s"}`;
  return `${shown} of ${total}`;
}
