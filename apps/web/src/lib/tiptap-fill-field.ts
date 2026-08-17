import { Node, mergeAttributes, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * Two kinds of placeholder, both of which used to surface as raw bracket text
 * the user had to select and delete before typing:
 *
 *  - `FillField`  - a hand-filled blank (`[Client Name]`, `[Qty]`, `[####]` in
 *    the CLEANING / ADJUSTING templates). Renders as a click-into box that
 *    shows its field name as ghost text while empty.
 *  - `MergeToken` - a `{{project_name}}` merge field that resolves from live
 *    project/company data. Renders as a read-only pill so the document never
 *    shows template source; the API converts it back to `{{token}}` on save so
 *    the merge stays live and renaming the project still updates the page.
 */

export const FILL_FIELD_ATTR = "data-fill-field";
export const MERGE_TOKEN_ATTR = "data-token";
export const FILL_FIELD_NAME = "fillField";

/**
 * The content range of the fill field one step before or after the one the
 * caret currently sits in. `null` when the caret is not inside a field, or
 * when there is no field left in that direction.
 *
 * Document order, deliberately, not table order: a filled-in form runs its
 * blanks down the page, and the run crosses out of the Customer table, through
 * the Equipment table and on into the prose underneath without the person
 * filling it in thinking of those as three separate things.
 *
 * Exported so it can be exercised without a DOM. See tests/fill-field-tab.test.ts.
 */
export function adjacentFillFieldRange(
  doc: ProseMirrorNode,
  pos: number,
  direction: 1 | -1,
): { from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  let here = -1;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === FILL_FIELD_NAME) {
      here = $pos.before(depth);
      break;
    }
  }
  // Not in a field, so Tab is not this extension's business. The caret sitting
  // beside a field rather than in it counts as "not in a field": Tab there is
  // still ordinary table or list navigation.
  if (here < 0) return null;

  const starts: number[] = [];
  doc.descendants((node, start) => {
    if (node.type.name !== FILL_FIELD_NAME) return true;
    starts.push(start);
    // A field's children are text. Nothing to find below it.
    return false;
  });

  const index = starts.indexOf(here);
  if (index < 0) return null;
  // No wrap-around at either end. Tabbing off the last blank would otherwise
  // land back on the first one and, because the move selects the field's
  // contents, the next keystroke would overwrite a value the person had
  // already entered.
  const target = starts[index + direction];
  if (target === undefined) return null;

  const node = doc.nodeAt(target);
  if (!node) return null;
  return { from: target + 1, to: target + 1 + node.content.size };
}

/**
 * Selects the whole of the destination field rather than dropping a collapsed
 * caret in it, which is what tabbing between the inputs of an ordinary form
 * does: the next thing typed replaces what was there instead of appending to
 * it. On an empty field, which is most of them while a form is being filled,
 * the two are the same thing.
 */
function moveToAdjacentFillField(editor: Editor, direction: 1 | -1): boolean {
  const { state, view } = editor;
  const range = adjacentFillFieldRange(state.doc, state.selection.from, direction);
  if (!range) return false;
  view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to)).scrollIntoView(),
  );
  return true;
}

export const FillField = Node.create({
  name: FILL_FIELD_NAME,
  /*
   * Above the Table extension, which is 100 like nearly everything else.
   *
   * Tiptap orders the keymap plugins by descending extension priority and
   * ProseMirror stops at the first handler that returns true, so this is what
   * decides whether Tab means "next blank" or Table's `goToNextCell`. At 100 it
   * would have lost, and losing is not merely "the jump does not happen":
   * `goToNextCell` selects the whole of the next cell, so a cell holding a
   * blank came back selected node and all, and the next keystroke replaced the
   * dashed box with plain text. Off the last cell it is worse still, because
   * Table's Tab falls back to `addRowAfter` and grows the form by a row.
   */
  priority: 1000,
  inline: true,
  group: "inline",
  // Editable text lives inside the node, so clicking in and typing is just
  // ordinary editing - no delete-the-brackets step.
  content: "text*",

  /*
   * A filled-in blank is not a focusable element. It is an inline node inside
   * one contenteditable covering the whole document, so the browser has exactly
   * one tab stop for the entire page of blanks and Tab inside it belonged to
   * whichever extension claimed the key. Nothing walked from blank to blank,
   * which is why the only way to reach the next one was the mouse.
   *
   * Returning false when the caret is not in a field, or when the field is the
   * last one in that direction, leaves Tab exactly as it was everywhere else:
   * cell to cell inside a table, indent inside a list, and out of the editor in
   * plain prose.
   */
  addKeyboardShortcuts() {
    return {
      Tab: () => moveToAdjacentFillField(this.editor, 1),
      "Shift-Tab": () => moveToAdjacentFillField(this.editor, -1),
    };
  },

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
 * Only bracket runs inside text are converted - never inside a tag - so
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
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
