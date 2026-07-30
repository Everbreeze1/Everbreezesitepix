import { Extension } from "@tiptap/core";

/**
 * Marks an (otherwise empty) paragraph as a forced page break. It has no
 * dedicated node type on purpose — reusing `paragraph` with a `data-page-break`
 * attribute means it round-trips through the schema with zero risk of
 * colliding with another node's parse rule (a competing `<hr>`-based node,
 * for instance, would need explicit priority tie-breaking against the
 * built-in HorizontalRule node, which also matches any `<hr>`).
 *
 * `page-pdf.ts`'s `case "p"` reads this same attribute and calls
 * `layout.newPage()` instead of drawing paragraph text, so the break is
 * real in the exported PDF, not just a visual divider in the editor.
 */
export const PageBreak = Extension.create({
  name: "pageBreak",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          pageBreak: {
            default: null,
            parseHTML: (el: HTMLElement) => (el.getAttribute("data-page-break") === "true" ? "true" : null),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.pageBreak ? { "data-page-break": "true" } : {},
          },
        },
      },
    ];
  },
});
