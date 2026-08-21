import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PageBreak } from "@/lib/tiptap-page-break";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/*
 * The page-break node's contract with the PDF renderer.
 *
 * These are two files that never import each other and must agree exactly: the
 * editor writes an attribute into stored HTML, and the renderer looks for that
 * attribute months later. Nothing about a mismatch is a type error - the break
 * would simply stop breaking, silently, and the author would find out from a
 * client's PDF.
 */

describe("PageBreak node", () => {
  it("is an atom in the block flow", () => {
    // Not a container: a break is a position, and anything typed "into" it
    // would be invisible in the export.
    expect(PageBreak.name).toBe("pageBreak");
    expect(PageBreak.config.group).toBe("block");
    expect(PageBreak.config.atom).toBe(true);
  });

  it("parses the element it writes", () => {
    // The round trip: stored HTML is re-parsed every time the document opens,
    // so a node that renders one shape and parses another loses every break on
    // the first save.
    const rules = (PageBreak.config.parseHTML as () => Array<{ tag: string }>).call(PageBreak);
    expect(rules.some((r) => r.tag === "div[data-page-break]")).toBe(true);
  });

  it("renders the attribute the PDF renderer looks for", () => {
    const out = (PageBreak.config.renderHTML as (p: never) => unknown[]).call(PageBreak, {
      HTMLAttributes: {},
    } as never);
    expect(out[0]).toBe("div");
    expect(out[1]).toMatchObject({ "data-page-break": "true" });
  });

  it("agrees with page-pdf.ts about the attribute name", () => {
    /*
     * The whole coupling, asserted in one place. If either side is renamed
     * without the other, this fails here rather than in a customer's export.
     */
    const node = read("apps/web/src/lib/tiptap-page-break.ts");
    const pdf = read("apps/api/src/domains/projects/page-pdf.ts");
    const attr = "data-page-break";
    expect(node).toContain(attr);
    expect(pdf).toContain(`node.attrs["${attr}"]`);
  });

  it("does not claim the horizontal rule's tag", () => {
    // `<hr>` is the decorative rule the PDF draws as a line, and generated
    // cover pages use two of them.
    const rules = (PageBreak.config.parseHTML as () => Array<{ tag: string }>).call(PageBreak);
    expect(rules.every((r) => !/^hr\b/.test(r.tag))).toBe(true);
  });
});
