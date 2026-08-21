import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A deliberate page break in a document.
 *
 * "with option to put a page break when we are editing the report."
 *
 * Its own node rather than reusing `<hr>`, which this product already spends on
 * something else: the PDF renderer draws a horizontal rule as a visible line
 * (page-pdf.ts, `case "hr"`), and the generated cover pages use exactly that for
 * the rules above and below the title. Overloading it would mean every cover
 * page silently gained two page breaks.
 *
 * Serialises to `<div data-page-break="true"></div>`, which:
 *   - survives the editor round trip, because it is a real node with a parser
 *     rule rather than a styled paragraph that Tiptap would flatten;
 *   - is recognised by `page-pdf.ts`, which starts a new page instead of
 *     drawing anything;
 *   - degrades to nothing visible in any other HTML consumer, which is the
 *     correct rendering for a break on a continuous-scroll page.
 */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  // Nothing inside it. A break is a position, not a container.
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-page-break": "true",
        // The editor's own styling lives in styles.css under
        // `[data-page-break]`; the attribute is the hook for both that and the
        // PDF renderer, so it must be on the element rather than in a class.
        class: "doc-page-break",
      }),
    ];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }: { commands: any }) =>
          commands.insertContent({ type: this.name }),
    } as never;
  },
});
