import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Two kinds of placeholder, both of which used to surface as raw bracket text
 * the user had to select and delete before typing:
 *
 *  - `FillField`  — a hand-filled blank (`[Client Name]`, `[Qty]`, `[####]` in
 *    the CLEANING / ADJUSTING templates). Renders as a click-into box that
 *    shows its field name as ghost text while empty.
 *  - `MergeToken` — a `{{project_name}}` merge field that resolves from live
 *    project/company data. Renders as a read-only pill so the document never
 *    shows template source; the API converts it back to `{{token}}` on save so
 *    the merge stays live and renaming the project still updates the page.
 */

export const FILL_FIELD_ATTR = "data-fill-field";
export const MERGE_TOKEN_ATTR = "data-token";

export const FillField = Node.create({
  name: "fillField",
  inline: true,
  group: "inline",
  // Editable text lives inside the node, so clicking in and typing is just
  // ordinary editing — no delete-the-brackets step.
  content: "text*",

  addAttributes() {
    return {
      label: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-label") ?? "",
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.label ? { "data-label": attrs.label } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${FILL_FIELD_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { [FILL_FIELD_ATTR]: "", class: "tiptap-field" }),
      0,
    ];
  },
});

export const MergeToken = Node.create({
  name: "mergeToken",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      token: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute(MERGE_TOKEN_ATTR) ?? "",
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.token ? { [MERGE_TOKEN_ATTR]: attrs.token } : {},
      },
      /** Resolved value, or the human field name when there's no data yet. */
      label: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-label") ?? el.textContent ?? "",
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.label ? { "data-label": attrs.label } : {},
      },
      /** True when the token has no data behind it, so it can be styled as unfilled. */
      empty: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-empty") === "true",
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.empty ? { "data-empty": "true" } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${MERGE_TOKEN_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "tiptap-token" }),
      String(node.attrs.label || node.attrs.token || ""),
    ];
  },
});

/**
 * Rewrites literal `[Placeholder]` runs in template HTML into `FillField`
 * nodes, so the seeded SQL templates gain click-to-type fields without every
 * migration being rewritten.
 *
 * Only bracket runs inside text are converted — never inside a tag — so
 * attribute values (`alt="Photo slot 1"`, style rules, URLs) are untouched.
 */
export function bracketsToFillFields(html: string): string {
  if (!html || !html.includes("[")) return html;
  return html.replace(/>([^<]+)</g, (whole, text: string) => {
    if (!text.includes("[")) return whole;
    // `[` needs no escape inside a character class.
    const replaced = text.replace(/\[([^[\]<>]{1,60})\]/g, (_m, label: string) => {
      const clean = label.trim();
      if (!clean) return _m;
      return `<span ${FILL_FIELD_ATTR} data-label="${escapeAttr(clean)}"></span>`;
    });
    return `>${replaced}<`;
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
