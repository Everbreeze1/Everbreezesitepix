import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { documentHeading, layoutPages, type Block } from "../apps/web/src/lib/tiptap-pagination";
import { TemplateToken } from "../apps/web/src/lib/tiptap-template-token";

/*
 * "the page break should be there nicely formatted and not distort document and
 * show in the middle of a form and break that form into another page."
 *
 * The editor lays the template out as sheets. These pin the rules: a block
 * that would cross the foot of a page moves to the next page whole, a heading
 * goes with the form under it, and only a block taller than a page is cut.
 */

const OPTS = { pageContentPx: 1000, headerPx: 40, marginPx: 72, gapPx: 28, headerText: () => "" };

const node = (type: string) => ({ type: { name: type } }) as unknown as ProseMirrorNode;

/** Stack blocks top to bottom with the given heights. */
function stack(...items: Array<[string, number]>): Block[] {
  let top = 0;
  return items.map(([type, height], i) => {
    const b = { pos: i * 10, node: node(type), top, height };
    top += height;
    return b;
  });
}

describe("automatic page breaks in the template editor", () => {
  it("leaves a document that fits on one page alone", () => {
    const r = layoutPages(stack(["paragraph", 300], ["table", 400]), OPTS);
    expect(r).toEqual({ breaks: [], cuts: [], pages: 1 });
  });

  it("moves a form that would cross the page foot to the next page whole", () => {
    const r = layoutPages(stack(["paragraph", 800], ["table", 400]), OPTS);
    expect(r.cuts).toEqual([]);
    expect(r.breaks).toEqual([{ pos: 10, fill: 200, page: 2 }]);
    expect(r.pages).toBe(2);
  });

  it("takes the form's heading with it", () => {
    const r = layoutPages(stack(["paragraph", 760], ["heading", 40], ["table", 400]), OPTS);
    expect(r.breaks).toEqual([{ pos: 10, fill: 240, page: 2 }]);
  });

  it("only cuts a block taller than a whole page", () => {
    const r = layoutPages(stack(["paragraph", 100], ["table", 2000]), OPTS);
    expect(r.breaks).toEqual([]);
    expect(r.cuts.map((c) => c.page)).toEqual([2, 3]);
    expect(r.cuts[0].offset).toBe(900);
  });

  it("gives later pages less room, for their header", () => {
    // 1000 on page one, 960 after: a 970px block fits page one but not two.
    const r = layoutPages(stack(["paragraph", 900], ["table", 950], ["table", 20]), OPTS);
    expect(r.breaks.map((b) => b.pos)).toEqual([10, 20]);
    expect(r.pages).toBe(3);
  });

  it("heads each new page with the document's own title", () => {
    const schema = getSchema([StarterKit, TemplateToken]);
    const doc = (content: unknown[]) => schema.nodeFromJSON({ type: "doc", content });
    const text = (t: string) => ({ type: "text", text: t });
    const heading = (level: number, ...content: unknown[]) => ({
      type: "heading",
      attrs: { level },
      content,
    });
    const para = { type: "paragraph", content: [text("Intro")] };

    expect(
      documentHeading(doc([para, heading(2, text("Scope")), heading(1, text("Survey"))])),
    ).toBe("Survey");
    expect(documentHeading(doc([para, heading(2, text("Scope"))]))).toBe("Scope");
    expect(documentHeading(doc([para]))).toBe("");
    // A placeholder in the title reads by its label.
    expect(
      documentHeading(
        doc([
          heading(
            1,
            { type: "templateToken", attrs: { token: "project_name", label: "Project name" } },
            text(" survey"),
          ),
        ]),
      ),
    ).toBe("Project name survey");
  });

  it("adds sections between blocks, never inside one", () => {
    const src = readFileSync(
      "apps/web/src/features/settings/components/DocumentTemplatesManager.tsx",
      "utf8",
    );
    const inserter = src.slice(src.indexOf("function BlockInserter("));
    expect(inserter).toContain("insertContentAt(at,");
    expect(inserter).toContain("after: offset + node.nodeSize");
    expect(src).toContain("<BlockInserter");
  });

  it("is wired into the template editor in place of the old dashed guides", () => {
    const src = readFileSync(
      "apps/web/src/features/settings/components/DocumentTemplatesManager.tsx",
      "utf8",
    );
    expect(src).toContain("Pagination.configure(");
    expect(src).toContain("refreshPagination(tiptap.view)");
    expect(src).toContain("documentHeading(doc) || nameRef.current");
    expect(src).not.toContain("paperRef");
    expect(src).toContain("sidePanelTokens(relevantPlaceholders, detected)");
  });
});

describe("blue fields explain themselves", () => {
  /*
   * "The blue tablets are not very intuitive for entering company name etc. ...
   * I didn't know I could delete that and write company name."
   */
  const src = readFileSync(
    "apps/web/src/features/settings/components/DocumentTemplatesManager.tsx",
    "utf8",
  );

  it("shows a card saying where a clicked field's value comes from", () => {
    const card = src.slice(src.indexOf("function FieldCard("), src.indexOf("function FieldsHint("));
    expect(card).toContain('sel.node.type.name !== "templateToken"');
    expect(card).toContain("fills in by itself");
    expect(card).toContain("Type my own text");
    expect(src).toContain("<FieldCard editor={tiptap} containerRef={pageBoxRef} />");
    expect(src).toContain(
      'return { from: "your company name in Settings › Company", now: profile?.company };',
    );
  });

  it("tells a first-time author what the blue fields are", () => {
    expect(src).toContain("<FieldsHint />");
    expect(src).toContain("Blue fields fill in by themselves");
  });
});
