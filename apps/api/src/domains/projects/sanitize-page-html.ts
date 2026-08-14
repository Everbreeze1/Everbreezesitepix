import sanitizeHtml from "sanitize-html";

/**
 * Allow-list sanitiser for page HTML that will be rendered to anonymous
 * visitors.
 *
 * `project_pages.content_html` is author-controlled and only length-validated
 * on write (`updateProjectPageInputSchema` caps it at 2MB and nothing more), so
 * anything an authenticated user can PUT lands in the database verbatim. The
 * public share route injects it with `dangerouslySetInnerHTML`, which made this
 * stored XSS against whoever opens the shared link - typically the customer,
 * not the author. Sanitising on read closes it for every existing row at once,
 * without a migration and without trusting that every future write path
 * remembers to clean its input.
 *
 * The tag list is the TipTap editor's output surface. Anything outside it is
 * dropped rather than escaped, so unknown markup disappears instead of showing
 * up as literal angle brackets in the customer's document.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "div",
    "span",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "strike",
    "del",
    "ins",
    "mark",
    "sub",
    "sup",
    "blockquote",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "caption",
    "colgroup",
    "col",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    td: ["colspan", "rowspan", "colwidth"],
    th: ["colspan", "rowspan", "colwidth"],
    col: ["span", "width"],
    /*
     * TipTap's task list is `<ul data-type="taskList">` /
     * `<li data-type="taskItem" data-checked>`, and that markup IS the
     * checkbox: the extension keys off it, and styles.css only draws a tick
     * box for `ul[data-type="taskList"]`. Stripping it turned every checklist
     * in a seeded template into plain bullets - silently, and permanently,
     * because createPageFromTemplateService writes the sanitised HTML into
     * project_pages. A trade checklist that cannot be ticked is most of why
     * those templates exist, so these two names are allowed through.
     *
     * They are inert data attributes on list tags with fixed names - no URL,
     * no handler, nothing the renderer executes - so this does not widen the
     * XSS surface the allow-list is here to close.
     */
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    // `class` carries the editor's own formatting (the `tiptap prose` styles);
    // `style` is separately restricted by `allowedStyles` below. No other
    // attribute survives, which is what removes every `on*` handler.
    "*": ["class", "style"],
  },
  allowedStyles: {
    "*": {
      "text-align": [/^(left|right|center|justify)$/],
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/],
      "background-color": [/^#[0-9a-fA-F]{3,8}$/, /^rgba?\([\d\s.,%]+\)$/],
      width: [/^\d+(?:\.\d+)?(?:px|%|em|rem)$/],
      height: [/^\d+(?:\.\d+)?(?:px|%|em|rem)$/],
    },
  },
  // Blocks `javascript:` and every other exotic scheme on links.
  allowedSchemes: ["http", "https", "mailto", "tel"],
  // Inline images are legitimate here (photos are resolved to signed URLs, and
  // generated documents can embed data URIs). An SVG delivered through <img>
  // cannot execute script, so this does not reopen the hole.
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  allowProtocolRelative: false,
  // Drop the contents of anything disallowed rather than leaving stray text -
  // a stripped <script> should take its body with it.
  nonTextTags: ["style", "script", "textarea", "option", "noscript", "iframe", "object", "embed"],
  transformTags: {
    // Any link that opens a new tab must not hand the opener over with it.
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target
        ? { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" }
        : { ...attribs, rel: "noopener noreferrer nofollow" },
    }),
  },
};

export function sanitizePageHtml(html: string): string;
export function sanitizePageHtml(html: string | null): string | null;
export function sanitizePageHtml(html: string | null): string | null {
  if (html == null) return html;
  return sanitizeHtml(html, OPTIONS);
}
