import { Extension } from "@tiptap/core";

/**
 * Lets a paragraph carry an explicit `style="height: 500px"` for deliberate
 * blank vertical space (e.g. a title-page cover meant to occupy roughly a
 * full page) — Tiptap's Paragraph node doesn't preserve a bare `style`
 * attribute by default, so without this it gets silently stripped on parse
 * (the same issue text-align had before TextAlign was added).
 *
 * `page-pdf.ts`'s `case "p"` reads this same height and advances the layout
 * cursor by the equivalent point value instead of drawing a normal blank
 * line, so the spacer is the same size in the exported PDF, not just on
 * screen.
 */
export const Spacer = Extension.create({
  name: "spacer",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          spacerHeight: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const h = el.style.height;
              return h && h.endsWith("px") ? h : null;
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.spacerHeight ? { style: `height: ${attrs.spacerHeight}` } : {},
          },
        },
      },
    ];
  },
});
