import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendBlocks,
  decodeEntities,
  encodeEntities,
  insertBlock,
  meaningfulBlocks,
  moveBlock,
  pagePreview,
  parsePage,
  refusalMessage,
  removeBlock,
  serialiseBlocks,
  setBlockKind,
  setBlockText,
  type Block,
} from "../apps/mobile/src/api/doc-blocks";

/*
 * The project page block model.
 *
 * This module can destroy somebody's work in a way nothing else in the app can.
 * `project_pages.content_html` is written on the web by a desktop editor that
 * produces real HTML, and a block model cannot represent all of it. Parsing a
 * page with a table into blocks and serialising it back would silently delete
 * the table: somebody opens a document on their phone to fix a typo and loses
 * an afternoon of work done at a desk.
 *
 * So the promise is narrow and absolute: **the phone only edits what it can
 * rebuild exactly.** Everything below exists to prove the refusals fire, since
 * a refusal that does not fire is data loss.
 */

const block = (kind: Block["kind"], text: string, id = "b1"): Block => ({ id, kind, text });

describe("the refusal is the feature", () => {
  it("refuses a table", () => {
    // The canonical case. A block model has no table, so parsing and saving
    // would delete it.
    expect(parsePage("<p>Notes</p><table><tr><td>a</td></tr></table>").refusal).toBe("rich_markup");
  });

  it("refuses images, links, and anything inline", () => {
    for (const html of [
      '<p>See <img src="x.png"></p>',
      '<p>See <a href="https://x">the spec</a></p>',
      "<p>This is <strong>important</strong></p>",
      "<p>This is <em>emphasised</em></p>",
      "<p>Use <code>npm</code></p>",
    ]) {
      expect(parsePage(html).refusal, html).toBe("rich_markup");
    }
  });

  it("refuses styling, even on a tag it otherwise understands", () => {
    /*
     * `<p style="color:red">` parses as a paragraph if you are not careful, and
     * rebuilding it drops the colour. Silent, and exactly the kind of small loss
     * somebody does not notice until a client sees the document.
     */
    expect(parsePage('<p style="color:red">Danger</p>').refusal).toBe("rich_markup");
    expect(parsePage('<p class="lead">Intro</p>').refusal).toBe("rich_markup");
  });

  it("refuses an ordered list, which is not the same as a bullet list", () => {
    // Numbering is meaningful in a method statement. Rebuilding `ol` as `ul`
    // would quietly renumber somebody's procedure into bullets.
    expect(parsePage("<ol><li>First</li></ol>").refusal).toBe("rich_markup");
  });

  it("refuses loose text sitting between blocks", () => {
    // The scan would skip it, and skipping is the loss.
    expect(parsePage("<p>One</p>stray text<p>Two</p>").refusal).toBe("rich_markup");
  });

  it("refuses text after the last block", () => {
    expect(parsePage("<p>One</p>trailing").refusal).toBe("rich_markup");
  });

  it("refuses a list containing anything but plain list items", () => {
    expect(parsePage("<ul><li>Fine</li><p>Not fine</p></ul>").refusal).toBe("rich_markup");
    expect(parsePage("<ul><li>With <b>bold</b></li></ul>").refusal).toBe("rich_markup");
  });

  it("refuses a page it cannot find any block in", () => {
    expect(parsePage("just words, no tags").refusal).toBe("rich_markup");
  });

  it("gives every refusal something to say", () => {
    expect(refusalMessage("rich_markup")).toContain("read-only");
    expect(refusalMessage("lossy")).toContain("web");
    expect(refusalMessage(null)).toBeNull();
  });
});

describe("what it does accept", () => {
  it("accepts an empty page", () => {
    // A page created from the blank template. Editing it is the whole point.
    expect(parsePage("")).toEqual({ blocks: [], refusal: null });
    expect(parsePage("   ")).toEqual({ blocks: [], refusal: null });
  });

  it("accepts headings, paragraphs and bullets", () => {
    const parsed = parsePage(
      "<h2>Site visit</h2>\n<p>All clear.</p>\n<ul><li>One</li><li>Two</li></ul>",
    );
    expect(parsed.refusal).toBeNull();
    expect(parsed.blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "bullet", "bullet"]);
    expect(parsed.blocks.map((b) => b.text)).toEqual(["Site visit", "All clear.", "One", "Two"]);
  });

  it("accepts h1 and h3, levelling them to h2", () => {
    /*
     * A real change to the document, and an acceptable one: the phone offers
     * one heading level, and flattening three into one is a visible edit rather
     * than a silent loss. The round-trip check knows to allow exactly this.
     */
    expect(parsePage("<h1>Title</h1>").refusal).toBeNull();
    expect(parsePage("<h3>Sub</h3>").refusal).toBeNull();
  });

  it("decodes entities into the text somebody typed", () => {
    const parsed = parsePage("<p>Smith &amp; Sons &lt;job&gt;</p>");
    expect(parsed.blocks[0].text).toBe("Smith & Sons <job>");
  });
});

describe("the round trip is exact", () => {
  const cases = [
    "<h2>Site visit</h2>\n<p>All clear.</p>",
    "<ul><li>One</li><li>Two</li></ul>",
    "<p>Before</p>\n<ul><li>A</li></ul>\n<p>After</p>",
    "<p>Smith &amp; Sons</p>",
    "<h2>Heading</h2>",
  ];

  it("re-serialises to what it read", () => {
    /*
     * The promise, checked directly. `parsePage` already performs this
     * comparison internally and refuses on mismatch, so this test is really
     * asserting that the accepted cases are accepted for the right reason
     * rather than by a hole in the check.
     */
    for (const html of cases) {
      const parsed = parsePage(html);
      expect(parsed.refusal, html).toBeNull();
      const rebuilt = serialiseBlocks(parsed.blocks);
      expect(rebuilt.replace(/>\s+</g, "><"), html).toBe(html.replace(/>\s+</g, "><"));
    }
  });

  it("survives a second pass unchanged", () => {
    // Parse, serialise, parse again. A model that drifts on the second pass
    // corrupts a document a little more every time somebody opens it.
    for (const html of cases) {
      const once = serialiseBlocks(parsePage(html).blocks);
      const twice = serialiseBlocks(parsePage(once).blocks);
      expect(twice, html).toBe(once);
    }
  });

  it("merges consecutive bullets into one list, as the web writes them", () => {
    const blocks = [
      block("bullet", "One", "1"),
      block("bullet", "Two", "2"),
      block("paragraph", "Then", "3"),
      block("bullet", "Three", "4"),
    ];
    expect(serialiseBlocks(blocks)).toBe(
      "<ul><li>One</li><li>Two</li></ul>\n<p>Then</p>\n<ul><li>Three</li></ul>",
    );
  });

  it("escapes on the way out so typed angle brackets cannot become tags", () => {
    /*
     * Somebody typing "use <span> here" in a paragraph must not have it written
     * as markup, which would then make the page unparseable and lock them out
     * of their own document.
     */
    const html = serialiseBlocks([block("paragraph", "use <span> & stuff")]);
    expect(html).toBe("<p>use &lt;span&gt; &amp; stuff</p>");
    expect(parsePage(html).blocks[0].text).toBe("use <span> & stuff");
  });
});

describe("entity encoding", () => {
  it("encodes the ampersand first", () => {
    // Otherwise the ampersands introduced by the later replacements get encoded
    // a second time and `<` comes out as `&amp;lt;`.
    expect(encodeEntities("<")).toBe("&lt;");
    expect(encodeEntities("&lt;")).toBe("&amp;lt;");
  });

  it("round-trips", () => {
    for (const text of ["a & b", "<tag>", 'say "hi"', "5 > 3"]) {
      expect(decodeEntities(encodeEntities(text))).toBe(text);
    }
  });
});

describe("editing blocks", () => {
  const blocks = [
    block("heading", "A", "1"),
    block("paragraph", "B", "2"),
    block("bullet", "C", "3"),
  ];

  it("moves, and is inert at the ends", () => {
    expect(moveBlock(blocks, "2", -1).map((b) => b.id)).toEqual(["2", "1", "3"]);
    expect(moveBlock(blocks, "1", -1)).toBe(blocks);
    expect(moveBlock(blocks, "3", 1)).toBe(blocks);
    expect(moveBlock(blocks, "nope", 1)).toBe(blocks);
  });

  it("sets text and kind without touching the rest", () => {
    expect(setBlockText(blocks, "2", "new")[1].text).toBe("new");
    expect(setBlockKind(blocks, "2", "heading")[1].kind).toBe("heading");
    expect(setBlockText(blocks, "2", "new")[0]).toBe(blocks[0]);
  });

  it("removes", () => {
    expect(removeBlock(blocks, "2").map((b) => b.id)).toEqual(["1", "3"]);
  });

  it("inserts after a block, or at the end", () => {
    expect(
      insertBlock(blocks, "1", "paragraph")
        .map((b) => b.id)
        .slice(0, 2),
    ).toEqual(["1", expect.any(String)]);
    expect(insertBlock(blocks, "1", "paragraph")).toHaveLength(4);
    expect(insertBlock(blocks, null, "paragraph")[3].text).toBe("");
    // An unknown anchor appends rather than dropping the block on the floor.
    expect(insertBlock(blocks, "nope", "paragraph")).toHaveLength(4);
  });

  it("gives every new block a distinct id", () => {
    const ids = new Set(Array.from({ length: 50 }, () => insertBlock([], null, "paragraph")[0].id));
    expect(ids.size).toBe(50);
  });

  it("does not mutate", () => {
    setBlockText(blocks, "2", "x");
    removeBlock(blocks, "2");
    expect(blocks).toHaveLength(3);
    expect(blocks[1].text).toBe("B");
  });
});

describe("meaningfulBlocks", () => {
  it("drops the empty ones", () => {
    // Dropped on save, not as they are typed: somebody who adds a paragraph and
    // pauses to think should still have it under the cursor.
    const out = meaningfulBlocks([block("paragraph", "  ", "1"), block("paragraph", "real", "2")]);
    expect(out.map((b) => b.id)).toEqual(["2"]);
  });
});

describe("pagePreview", () => {
  it("strips tags down to a readable line", () => {
    expect(pagePreview("<h2>Site visit</h2><p>All clear.</p>")).toBe("Site visit All clear.");
  });

  it("decodes entities so the list does not show &amp;", () => {
    expect(pagePreview("<p>Smith &amp; Sons</p>")).toBe("Smith & Sons");
  });

  it("says so rather than showing nothing", () => {
    expect(pagePreview("")).toBe("Empty page");
    expect(pagePreview("<p></p>")).toBe("Empty page");
  });

  it("truncates with an ellipsis", () => {
    const out = pagePreview(`<p>${"x".repeat(300)}</p>`, 40);
    expect(out).toHaveLength(40);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("appendBlocks: the operation that makes this useful", () => {
  /*
   * `parsePage` is correct to refuse the real templates, and that refusal alone
   * would leave the phone able to edit almost nothing: the seeded document
   * templates contain `<em>`, `<span style>`, `<img>` and `<ul data-type>`.
   *
   * Appending is the answer, and it is safe for a reason no amount of parsing
   * can be: it never reads what is already there.
   */

  it("refuses to edit the real seeded templates, as it should", () => {
    // Read from the migrations rather than a copy, so this fails if the seed
    // ever changes shape and the assumption behind `appendBlocks` moves.
    const seed = readFileSync(
      join(process.cwd(), "supabase/migrations/20260803000001_document_templates_rebuild_seed.sql"),
      "utf8",
    );
    const bodies = [...seed.matchAll(/<h2>[\s\S]{0,400}?<\/p>/g)].map((m) => m[0]).slice(0, 5);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(parsePage(body).refusal, body.slice(0, 60)).not.toBeNull();
    }
  });

  it("appends to a page it would never dare parse", () => {
    // A header table, a logo and styled text: everything `parsePage` refuses.
    const rich =
      '<table><tr><td><img src="logo.png"></td></tr></table><p style="color:red">Existing</p>';
    const out = appendBlocks(rich, [block("paragraph", "Arrived 07:40")]);

    // The original survives byte for byte. That is the whole guarantee.
    expect(out.startsWith(rich)).toBe(true);
    expect(out).toBe(`${rich}\n<p>Arrived 07:40</p>`);
  });

  it("drops empty blocks rather than writing blank paragraphs into a document", () => {
    expect(appendBlocks("<p>A</p>", [block("paragraph", "   ")])).toBe("<p>A</p>");
    expect(appendBlocks("<p>A</p>", [])).toBe("<p>A</p>");
  });

  it("starts a page that had nothing in it", () => {
    expect(appendBlocks("", [block("heading", "Day one")])).toBe("<h2>Day one</h2>");
    expect(appendBlocks("   ", [block("paragraph", "x")])).toBe("<p>x</p>");
  });

  it("escapes what it adds, so an append cannot corrupt the page", () => {
    /*
     * Somebody typing "<table>" into an append box must not have it written as
     * markup: that would change the document's structure, which is exactly what
     * appending promises not to do.
     */
    const out = appendBlocks("<p>A</p>", [block("paragraph", "<table> is fine & so is 5 > 3")]);
    expect(out).toBe(`<p>A</p>\n<p>&lt;table&gt; is fine &amp; so is 5 &gt; 3</p>`);
  });

  it("never shortens the page", () => {
    // A property rather than an example: whatever goes in, the original is a
    // prefix of what comes out.
    for (const existing of ["", "<p>A</p>", "<table><tr><td>x</td></tr></table>"]) {
      const out = appendBlocks(existing, [block("bullet", "note")]);
      expect(out.length).toBeGreaterThanOrEqual(existing.trimEnd().length);
      if (existing.trim()) expect(out.startsWith(existing.trimEnd())).toBe(true);
    }
  });
});
