/**
 * What "the summary" means, for every surface that shows one.
 *
 * A walkthrough's `summary_markdown` is the AI draft plus a trailing `## Photos`
 * section of `photo:<id>` refs, which exists so raw-markdown consumers can find
 * the images. Nothing that lays out its own gallery should print that section:
 * the detail page, the share page and the PDF all render the photos themselves.
 *
 * Both halves used to be judged separately. The web pages called
 * `cleanWalkthroughMarkdown` and rendered real headings and bullets; the PDF
 * ran its own extractor that deleted every heading, flattened the bullets into
 * running text, swept the photo captions in behind them and cut the result at
 * 900 characters. Same summary, two different documents, and the printable one
 * was the worse of the two. One function now decides for both.
 */
import { markdownToRich } from "./markdown-rich";
import type { RichBlock } from "./report-rich";

/**
 * The body of the summary: no title (every surface renders its own), no photo
 * section, no inline `photo:` refs.
 */
export function cleanWalkthroughMarkdown(markdown: string | null | undefined): string {
  return (
    (markdown ?? "")
      .replace(/\n## (?:Additional Photos|Photos)\n[\s\S]*$/i, "")
      .replace(/!\[[^\]]*\]\(photo:[^)\s]+\)/g, "")
      // The title is rendered in the page's own header card, so a leading H1 here
      // would print it twice.
      .replace(/^\s*#\s+.+\n+/, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * The same body, as blocks, with anything that should not appear in a
 * client-facing document scrubbed out.
 *
 * A URL is not prose, and neither is `IMG_4417.jpg`. Both reach the model
 * through photo captions, and both used to be printed as sentences on the cover
 * page of a PDF sent to a customer.
 */
export function walkthroughSummaryBlocks(markdown: string | null | undefined): RichBlock[] {
  const cleaned = cleanWalkthroughMarkdown(markdown)
    // Any image ref the photo-section strip did not catch (http, or a bare path).
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Links: keep the label, drop the URL.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    // Stray image filenames the model sometimes inlines as prose.
    .replace(/\b[\w\-./]+\.(?:jpe?g|png|webp|gif|heic|heif|avif)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return markdownToRich(cleaned);
}
