import { describe, expect, it } from "vitest";
import { readFileSync as readSeed, readdirSync } from "node:fs";
import { join as joinPath, resolve as resolvePath } from "node:path";
import { sanitizePageHtml } from "../apps/api/src/domains/projects/sanitize-page-html";
import { bracketsToFillFields } from "../apps/api/src/domains/projects/pages";
import {
  applyTextEdit,
  continuation,
  diffText,
  docHtml,
  hasMark,
  inheritedMarks,
  linkAt,
  normaliseHref,
  parseDoc,
  PAGE_BREAK_HTML,
  rawBlock,
  rawLabel,
  runsText,
  serialiseDoc,
  setKind,
  setLink,
  setRuns,
  splitTypedLines,
  textBlock,
  toggleMark,
  type DocBlock,
  type TextBlock,
} from "../apps/mobile/src/api/rich-doc";

/*
 * The phone's formatted-text model, against the HTML the web's TipTap editor
 * stores in `project_pages.content_html` and `report_sections.body`.
 *
 * Two promises, and most of this file is the first one:
 *
 *   1. Nothing the phone cannot edit is ever lost. A table, an image, a task
 *      list or a merge token survives a phone save byte for byte.
 *   2. What the phone writes is the HTML the web would write, so a document
 *      edited on both goes back and forth without drifting.
 */

const roundTrip = (html: string) => serialiseDoc(parseDoc(html));

const text = (blocks: DocBlock[]): TextBlock[] =>
  blocks.filter((b): b is TextBlock => b.kind !== "raw");

describe("round trip: what the web writes comes back unchanged", () => {
  const exact = [
    "<p>Plain words</p>",
    "<h1>Title</h1><h2>Sub</h2><h3>Minor</h3>",
    "<p>Some <strong>bold</strong>, <em>italic</em>, <u>under</u>, <s>gone</s> and <code>npm i</code></p>",
    "<p><strong><em>both</em></strong></p>",
    '<p>See <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/a?b=1&amp;c=2">the spec</a> now</p>',
    '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://x.io"><strong>bold link</strong></a></p>',
    "<ul><li><p>One</p></li><li><p>Two <strong>bold</strong></p></li></ul>",
    '<ol start="3"><li><p>Third</p></li><li><p>Fourth</p></li></ol>',
    "<ul><li>Unwrapped</li><li>items</li></ul>",
    "<p>Line one<br>line two</p>",
    '<p style="text-align: center">Centred</p><h2 style="text-align: right">Right</h2>',
    "<p>Pipes &lt; 2in &amp; fittings &gt; 1in</p>",
    "<p>a&nbsp;&nbsp;b</p>",
    "<p></p>",
    '<p>Colour <span style="color: #e11d48">red</span> and <mark data-color="#fef08a" style="background-color: #fef08a; color: inherit">lit</mark></p>',
    '<p>Name: <span data-fill-field="" class="tiptap-field" data-label="Name">Jo Bloggs</span></p>',
    "<p>A</p><ul><li><p>b</p></li></ul><ul><li><p>c</p></li></ul>",
  ];
  for (const html of exact) {
    it(html.slice(0, 70), () => {
      expect(roundTrip(html)).toBe(html);
    });
  }

  it("keeps every block editable in ordinary TipTap output", () => {
    const blocks = parseDoc(exact.join(""));
    expect(blocks.filter((b) => b.kind === "raw")).toEqual([]);
  });
});

describe("what the phone cannot edit is kept byte for byte", () => {
  const table =
    '<table style="min-width: 50px"><colgroup><col></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>Item</p></th></tr><tr><td colspan="1" rowspan="1"><p>Cell</p></td></tr></tbody></table>';
  const image = '<img src="https://cdn/x.jpg" alt="Roof" data-photo-id="p1">';
  const tasks =
    '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Done</p></div></li></ul>';
  const panel = '<div data-panel="meta"><p>Job 42</p></div>';
  const pageBreak = '<div data-page-break="true"></div>';
  const token =
    '<p>Client: <span data-token="client_name" class="tiptap-token" data-label="Acme">Acme</span></p>';
  const nested = "<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>";
  const comment = "<!-- kept -->";
  const loose = "stray text";

  for (const [name, html] of Object.entries({
    table,
    image,
    tasks,
    panel,
    pageBreak,
    token,
    nested,
    comment,
    loose,
  })) {
    it(`keeps a ${name} raw and unchanged`, () => {
      const doc = `<h2>Before</h2>${html}<p>After</p>`;
      const blocks = parseDoc(doc);
      expect(blocks.map((b) => b.kind)).toEqual(["heading", "raw", "paragraph"]);
      expect((blocks[1] as { html: string }).html).toBe(html);
      expect(serialiseDoc(blocks)).toBe(doc);
    });
  }

  it("keeps raw blocks intact when the text around them is edited", () => {
    const doc = `<p>Intro</p>${table}<p>Outro</p>`;
    const blocks = parseDoc(doc);
    const intro = blocks[0] as TextBlock;
    const edited = setRuns(blocks, intro.id, applyTextEdit(intro.runs, "Intro, revised").runs);
    expect(serialiseDoc(edited)).toBe(`<p>Intro, revised</p>${table}<p>Outro</p>`);
  });

  it("never throws on broken markup, and keeps it", () => {
    for (const html of [
      "<p>unclosed",
      "<div><p>x</div>",
      "</p>stray close",
      "<p>a &bogus; b</p>",
      "<<>>",
    ]) {
      expect(() => parseDoc(html)).not.toThrow();
      expect(roundTrip(html)).toBe(html);
    }
  });

  it("labels what it cannot edit, so the read-only card says what it is", () => {
    expect(rawLabel(table)).toBe("Table");
    expect(rawLabel(image)).toBe("Photo");
    expect(rawLabel(tasks)).toBe("Checklist");
    expect(rawLabel(pageBreak)).toBe("Page break");
    expect(rawLabel(PAGE_BREAK_HTML)).toBe("Page break");
    expect(rawLabel(panel)).toBe("Info panel");
    expect(rawLabel('<p><img src="data:image/svg+xml;utf8,x"></p>')).toBe("Photo");
  });
});

describe("normalising: equivalent input comes out the way the web writes it", () => {
  it("folds whitespace the way ProseMirror does on load", () => {
    expect(roundTrip("<p>  a   lot\n of   space  </p>")).toBe("<p>a lot of space</p>");
    expect(roundTrip("<ul>\n  <li><p>x</p></li>\n</ul>")).toBe("<ul><li><p>x</p></li></ul>");
  });

  it("writes b and i as strong and em, marks nested in schema order", () => {
    expect(roundTrip("<p><b>x</b><i>y</i></p>")).toBe("<p><strong>x</strong><em>y</em></p>");
    expect(roundTrip("<p><em><strong>x</strong></em></p>")).toBe(
      "<p><strong><em>x</em></strong></p>",
    );
  });

  it("decodes entities the web writes literally", () => {
    const [block] = text(parseDoc("<p>it&#39;s &quot;fine&quot; &hellip; ok</p>"));
    expect(runsText(block.runs)).toBe('it\'s "fine" \u2026 ok');
  });
});

describe("editing text", () => {
  it("inserts at the caret with the formatting of the text before it", () => {
    const [block] = text(parseDoc("<p><strong>Bold</strong> plain</p>"));
    const { runs } = applyTextEdit(block.runs, "Bolder plain", { hint: { start: 4, end: 4 } });
    expect(serialiseDoc([{ ...block, runs }])).toBe("<p><strong>Bolder</strong> plain</p>");
  });

  it("uses the toolbar's pending marks when there are some", () => {
    const [block] = text(parseDoc("<p>Plain</p>"));
    const { runs } = applyTextEdit(block.runs, "Plain loud", {
      hint: { start: 5, end: 5 },
      pending: [{ type: "bold" }],
    });
    expect(serialiseDoc([{ ...block, runs }])).toBe("<p>Plain<strong> loud</strong></p>");
  });

  it("does not extend a link by typing at its end", () => {
    const html =
      '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://x.io">site</a></p>';
    const [block] = text(parseDoc(html));
    expect(inheritedMarks(block.runs, 4)).toEqual([]);
    const { runs } = applyTextEdit(block.runs, "site here", { hint: { start: 4, end: 4 } });
    expect(serialiseDoc([{ ...block, runs }])).toBe(
      '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://x.io">site</a> here</p>',
    );
  });

  it("deletes across formatting", () => {
    const [block] = text(parseDoc("<p>ab<strong>cd</strong>ef</p>"));
    const { runs } = applyTextEdit(block.runs, "abef");
    expect(serialiseDoc([{ ...block, runs }])).toBe("<p>abef</p>");
  });

  it("places a repeated letter where the caret was", () => {
    expect(diffText("aa", "aaa", { start: 0, end: 0 })).toEqual({
      start: 0,
      removed: 0,
      inserted: "a",
    });
    expect(diffText("aa", "aaa")).toEqual({ start: 2, removed: 0, inserted: "a" });
  });

  it("fills an emptied fill-in field rather than typing beside it", () => {
    const html =
      '<p>Name: <span data-fill-field="" class="tiptap-field" data-label="Name">x</span></p>';
    const [block] = text(parseDoc(html));
    const cleared = applyTextEdit(block.runs, "Name: ").runs;
    expect(serialiseDoc([{ ...block, runs: cleared }])).toBe(
      '<p>Name: <span data-fill-field="" class="tiptap-field" data-label="Name"></span></p>',
    );
    const filled = applyTextEdit(cleared, "Name: Jo", { hint: { start: 6, end: 6 } }).runs;
    expect(serialiseDoc([{ ...block, runs: filled }])).toBe(
      '<p>Name: <span data-fill-field="" class="tiptap-field" data-label="Name">Jo</span></p>',
    );
  });
});

describe("the toolbar", () => {
  it("toggles bold on and off over a selection", () => {
    const [block] = text(parseDoc("<p>one two three</p>"));
    const on = toggleMark(block.runs, 4, 7, { type: "bold" });
    expect(serialiseDoc([{ ...block, runs: on }])).toBe("<p>one <strong>two</strong> three</p>");
    expect(hasMark(on, 4, 7, "bold")).toBe(true);
    const off = toggleMark(on, 4, 7, { type: "bold" });
    expect(serialiseDoc([{ ...block, runs: off }])).toBe("<p>one two three</p>");
  });

  it("makes a partly bold selection all bold first", () => {
    const [block] = text(parseDoc("<p>ab<strong>cd</strong></p>"));
    const runs = toggleMark(block.runs, 0, 4, { type: "bold" });
    expect(serialiseDoc([{ ...block, runs }])).toBe("<p><strong>abcd</strong></p>");
  });

  it("adds, finds and removes a link the way the web writes it", () => {
    const [block] = text(parseDoc("<p>call us today</p>"));
    const linked = setLink(block.runs, 0, 7, "tel:+441234");
    expect(serialiseDoc([{ ...block, runs: linked }])).toBe(
      '<p><a target="_blank" rel="noopener noreferrer nofollow" href="tel:+441234">call us</a> today</p>',
    );
    expect(linkAt(linked, 3)).toEqual({ start: 0, end: 7, href: "tel:+441234" });
    expect(serialiseDoc([{ ...block, runs: setLink(linked, 0, 7, null) }])).toBe(
      "<p>call us today</p>",
    );
  });

  it("escapes a link's address", () => {
    const [block] = text(parseDoc("<p>x</p>"));
    const runs = setLink(block.runs, 0, 1, 'https://a.b/?q="1"&r=2');
    const html = serialiseDoc([{ ...block, runs }]);
    expect(html).toContain('href="https://a.b/?q=&quot;1&quot;&amp;r=2"');
    expect(linkAt(text(parseDoc(html))[0].runs, 0)?.href).toBe('https://a.b/?q="1"&r=2');
  });

  it("adds a scheme to a bare address", () => {
    expect(normaliseHref("acme.com")).toBe("https://acme.com");
    expect(normaliseHref("jo@acme.com")).toBe("mailto:jo@acme.com");
    expect(normaliseHref("https://acme.com")).toBe("https://acme.com");
    expect(normaliseHref("+44 1234 567890")).toBe("tel:+441234567890");
  });
});

describe("blocks", () => {
  it("turns paragraphs into one list, and keeps heading levels", () => {
    let blocks: DocBlock[] = parseDoc("<p>a</p><p>b</p><h3>c</h3>");
    blocks = setKind(blocks, blocks[0].id, "bullet");
    blocks = setKind(blocks, blocks[1].id, "bullet");
    blocks = setKind(blocks, blocks[2].id, "heading", 1);
    expect(serialiseDoc(blocks)).toBe("<ul><li><p>a</p></li><li><p>b</p></li></ul><h1>c</h1>");
    blocks = setKind(blocks, blocks[0].id, "number");
    expect(serialiseDoc(blocks)).toBe(
      "<ol><li><p>a</p></li></ol><ul><li><p>b</p></li></ul><h1>c</h1>",
    );
  });

  it("splits on a typed new line, continuing a list", () => {
    const [item] = text(parseDoc("<ul><li><p>first</p></li></ul>"));
    const { runs, change } = applyTextEdit(item.runs, "fi\nrst", { hint: { start: 2, end: 2 } });
    const split = splitTypedLines(item, runs, change);
    expect(serialiseDoc(split)).toBe("<ul><li><p>fi</p></li><li><p>rst</p></li></ul>");
  });

  it("keeps line breaks that came from the web", () => {
    const [block] = text(parseDoc("<p>a<br>b</p>"));
    const { runs, change } = applyTextEdit(block.runs, "a\nbc", { hint: { start: 3, end: 3 } });
    expect(serialiseDoc(splitTypedLines(block, runs, change))).toBe("<p>a<br>bc</p>");
  });

  it("starts a paragraph after a heading", () => {
    const [heading] = text(parseDoc("<h2>Title</h2>"));
    expect(continuation(heading).kind).toBe("paragraph");
  });

  it("saves empty as empty and drops empty new items", () => {
    expect(docHtml([textBlock("paragraph")])).toBe("");
    expect(docHtml([textBlock("paragraph", [{ text: "x", marks: [] }]), textBlock("bullet")])).toBe(
      "<p>x</p>",
    );
    expect(
      docHtml([rawBlock(PAGE_BREAK_HTML), textBlock("paragraph", [{ text: "x", marks: [] }])]),
    ).toBe("<hr><p>x</p>");
  });

  it("parses what it writes, for any edit sequence", () => {
    let blocks: DocBlock[] = parseDoc("<p>Start</p><table><tr><td>t</td></tr></table>");
    const first = blocks[0] as TextBlock;
    blocks = setRuns(
      blocks,
      first.id,
      toggleMark(applyTextEdit(first.runs, "Start <here> & now").runs, 0, 5, { type: "italic" }),
    );
    const html = serialiseDoc(blocks);
    expect(html).toBe(
      "<p><em>Start</em> &lt;here&gt; &amp; now</p><table><tr><td>t</td></tr></table>",
    );
    expect(roundTrip(html)).toBe(html);
  });
});

/*
 * The real thing: every seeded document template, put through the path
 * `createPageFromTemplateService` uses (sanitize, then bracket-to-field), which
 * is what a page made from it holds. Each must come back from a phone save with
 * nothing lost, and most of each must be editable on the phone, which is the
 * point of the editor.
 */

function seededTemplateBodies(): { slug: string; html: string }[] {
  const dir = joinPath(resolvePath(__dirname, ".."), "supabase/migrations");
  const bySlug = new Map<string, string>();
  for (const file of readdirSync(dir)
    .filter((f) => /document_templates.*seed\.sql$/.test(f))
    .sort()) {
    const sql = readSeed(joinPath(dir, file), "utf8");
    for (const block of sql.split("INSERT INTO public.document_templates").slice(1)) {
      const slug = /VALUES\s*\(\s*'((?:[^']|'')*)'/.exec(block);
      const html = /'html',\s*\$html\$([\s\S]*?)\$html\$/.exec(block);
      if (slug && html) bySlug.set(slug[1], html[1]);
    }
  }
  return [...bySlug].map(([slug, html]) => ({ slug, html }));
}

describe("pages built from the seeded templates", () => {
  const bodies = seededTemplateBodies().map(({ slug, html }) => ({
    slug,
    html: bracketsToFillFields(sanitizePageHtml(html)),
  }));

  it("finds the templates to test", () => {
    expect(bodies.length).toBeGreaterThan(5);
  });

  it("keeps every locked part byte for byte and reads its own output back the same", () => {
    for (const { slug, html } of bodies) {
      const blocks = parseDoc(html);
      for (const block of blocks) {
        if (block.kind === "raw") expect(html, slug).toContain(block.html);
      }
      const saved = serialiseDoc(blocks);
      expect(roundTrip(saved), slug).toBe(saved);
      // Nothing visible is lost by an untouched save.
      const words = (s: string) =>
        s
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      expect(words(saved), slug).toBe(words(html));
    }
  });

  it("lets the phone edit most of the text in them", () => {
    let editable = 0;
    let total = 0;
    for (const { html } of bodies) {
      for (const block of parseDoc(html)) {
        total += 1;
        if (block.kind !== "raw") editable += 1;
      }
    }
    expect(editable / total).toBeGreaterThan(0.5);
  });
});

describe("the screens use it", () => {
  const read = (path: string) => readSeed(joinPath(resolvePath(__dirname, ".."), path), "utf8");

  it("edits pages in place, saving with the version the last save returned", () => {
    const screen = read("apps/mobile/app/(app)/page/[pageId].tsx");
    expect(screen).toContain("<FormattedTextEditor");
    expect(screen).toContain("parseDoc(page.content_html)");
    expect(screen).toContain("docHtml(blocks)");
    expect(screen).toContain("version.current = result.updatedAt");
    // No whole-page read-only mode any more, and no append-only composer.
    expect(screen).not.toContain("parsePage(");
    expect(screen).not.toContain("appendBlocks(");
    expect(read("apps/mobile/src/api/pages.ts")).toContain("updatedAt: result?.updatedAt ?? null");
  });

  it("edits report section bodies with page breaks, in the same format", () => {
    const editor = read("apps/mobile/src/components/ReportEditor.tsx");
    expect(editor).toContain("<FormattedTextEditor");
    expect(editor).toContain("pageBreaks");
    expect(editor).toContain("parseDoc(section.body)");
    expect(editor).not.toContain("textToSectionBody(");
  });

  it("has the web toolbar's controls", () => {
    const toolbar = read("apps/mobile/src/components/FormattedTextEditor.tsx");
    for (const label of [
      "Bold",
      "Italic",
      "Link",
      "Bulleted list",
      "Numbered list",
      "Large heading",
      "Small heading",
      "Paragraph",
    ]) {
      expect(toolbar).toContain(`label="${label}"`);
    }
    // Removing something the phone cannot rebuild asks first.
    expect(toolbar).toContain("Alert.alert(");
  });
});
