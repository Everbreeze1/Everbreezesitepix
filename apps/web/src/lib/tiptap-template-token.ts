import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A `{{token}}` placeholder shown as a solid pill while a template is edited.
 *
 * Templates are stored with plain `{{token}}` text, and everything downstream
 * (the project page, the API's merge, `extractFields`) reads that form. In the
 * editor, though, the raw braces read like code and could be half-deleted into
 * `{{client_na` by a stray Backspace. So the editor swaps each token for an
 * atomic pill labelled "Client name" on the way in (`tokensToPills`) and back
 * to `{{client_name}}` on the way out (`pillsToTokens`). The stored HTML never
 * changes shape.
 */

export const TEMPLATE_FIELD_ATTR = "data-template-field";

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
const PILL_RE = new RegExp(
  `<span\\b[^>]*\\b${TEMPLATE_FIELD_ATTR}="([a-z0-9_]+)"[^>]*>[\\s\\S]*?</span>`,
  "gi",
);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Turn every `{{token}}` in text into a pill span. Only text between tags is
 * touched, never an attribute value, so a token inside an `alt` or `href`
 * stays as written.
 */
export function tokensToPills(html: string, labelFor: (token: string) => string): string {
  if (!html || !html.includes("{{")) return html;
  return html.replace(/(^|>)([^<]+)/g, (whole, open: string, text: string) => {
    if (!text.includes("{{")) return whole;
    const replaced = text.replace(TOKEN_RE, (_m, raw: string) => {
      const token = raw.toLowerCase();
      return `<span ${TEMPLATE_FIELD_ATTR}="${token}">${escapeHtml(labelFor(token))}</span>`;
    });
    return open + replaced;
  });
}

/** The inverse of `tokensToPills`: every pill back to its `{{token}}` text. */
export function pillsToTokens(html: string): string {
  if (!html || !html.includes(TEMPLATE_FIELD_ATTR)) return html;
  return html.replace(PILL_RE, (_m, token: string) => `{{${token.toLowerCase()}}}`);
}

export const TemplateToken = Node.create({
  name: "templateToken",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      token: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute(TEMPLATE_FIELD_ATTR) ?? "",
        renderHTML: (attrs: Record<string, unknown>) => ({
          [TEMPLATE_FIELD_ATTR]: attrs.token,
        }),
      },
      label: {
        default: "",
        parseHTML: (el: HTMLElement) => el.textContent ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${TEMPLATE_FIELD_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "tiptap-template-field",
        title: `${node.attrs.label || node.attrs.token} fills in by itself. Click for details.`,
      }),
      String(node.attrs.label || node.attrs.token || ""),
    ];
  },
});
