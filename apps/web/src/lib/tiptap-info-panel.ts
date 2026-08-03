import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A shaded, rounded container for a group of blocks — the "card" treatment
 * used by generated photo reports for the document masthead and for each
 * photo + its caption.
 *
 * This has to be a real node, not just styled markup: Tiptap's schema drops
 * any element it doesn't recognise on parse, so a bare `<div>` wrapper would
 * survive the initial render and then silently vanish the first time the user
 * edited the page.
 *
 * `variant` only selects styling (see `.tiptap [data-panel]` in styles.css and
 * the matching `case "div"` in apps/api/src/domains/projects/page-pdf.ts);
 * the content model is identical either way.
 */
export type PanelVariant = "meta" | "photo";

export const InfoPanel = Node.create({
  name: "infoPanel",
  group: "block",
  // Any block content, so a user can keep typing inside a generated card.
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: "meta" as PanelVariant,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-panel") || "meta",
        renderHTML: (attrs: Record<string, unknown>) => ({
          "data-panel": (attrs.variant as string) || "meta",
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-panel]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },
});

/** Server-side/string equivalent, for HTML assembled outside the editor. */
export function panelHtml(variant: PanelVariant, inner: string): string {
  return `<div data-panel="${variant}">${inner}</div>`;
}
