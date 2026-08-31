import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterSnippets,
  insertPlan,
  librarySummary,
  MAX_SNIPPET_LENGTH,
  MAX_TITLE_LENGTH,
  snippetBodyError,
  snippetPreview,
  snippetTitleError,
  suggestedTitle,
  type TextSnippet,
} from "../apps/mobile/src/api/snippets-view";
import { appendHtml, parsePage, serialiseBlocks } from "../apps/mobile/src/api/doc-blocks";

/*
 * The snippet library on the phone.
 *
 * Saved blocks of reusable text: a standing safety note, the wording for a
 * handover. Four ops have existed for them all along and the phone called none,
 * which is backwards - retyping a paragraph costs far more on a phone keyboard
 * than on a desk.
 *
 * The rule worth testing is `insertPlan`. A snippet is arbitrary HTML and the
 * phone's editor only rebuilds headings, paragraphs and bullets, so inserting
 * one either preserves it exactly or quietly destroys a table. There is
 * deliberately no third case, and that is what most of this file checks.
 */

const snippet = (over: Partial<TextSnippet>): TextSnippet => ({
  id: "s1",
  title: "Standard note",
  content_html: "<p>Scaffold signed off.</p>",
  created_at: "2026-08-31T09:00:00Z",
  ...over,
});

describe("insertPlan", () => {
  it("loads a plain snippet into the composer, so it can be edited first", () => {
    // Most of the value of a snippet is that it is a starting point, not a
    // stamp: the date and the reading change every time.
    const plan = insertPlan(snippet({ content_html: "<p>Arrived on site.</p>" }));
    expect(plan.mode).toBe("blocks");
    expect(plan.blocks.map((b) => b.text)).toEqual(["Arrived on site."]);
    expect(plan.caveat).toBeNull();
  });

  it("handles headings and bullets, which is most of what a snippet is", () => {
    const plan = insertPlan(
      snippet({
        content_html: "<h2>Handover</h2><ul><li>Keys returned</li><li>Alarm set</li></ul>",
      }),
    );
    expect(plan.mode).toBe("blocks");
    expect(plan.blocks).toHaveLength(3);
  });

  it("appends rich markup verbatim rather than flattening it", () => {
    /*
     * The judgement this module exists for. Parsing a table into the block
     * model drops it, and the person who inserted the snippet would not find
     * out until somebody read the document. Appending the HTML preserves it
     * exactly, and appending is safe for the same reason it always was: it
     * never reads what is already on the page.
     */
    const plan = insertPlan(
      snippet({ content_html: "<table><tr><td>Circuit</td><td>Reading</td></tr></table>" }),
    );
    expect(plan.mode).toBe("html");
    expect(plan.blocks).toEqual([]);
    expect(plan.caveat).toBeTruthy();
  });

  it("says what the consequence is, not just that there is one", () => {
    // The page stops being editable on the phone afterwards. Somebody deserves
    // to know that before they tap, not to discover it after.
    const plan = insertPlan(snippet({ content_html: '<p style="color:red">Danger</p>' }));
    expect(plan.mode).toBe("html");
    expect(plan.caveat).toContain("not be able to change it here");
  });

  it("takes the html path for a single bold word, which is the common case", () => {
    /*
     * Worth pinning because it is counter-intuitive. `parsePage` refuses `<em>`
     * and `<a>` as well as tables, so a snippet written in the web's rich
     * editor almost always arrives here rather than in the composer. That is
     * the right outcome - it goes in intact - but it means the verbatim branch
     * is the normal one, not the exception.
     */
    expect(insertPlan(snippet({ content_html: "<p>Live <em>and</em> neutral</p>" })).mode).toBe(
      "html",
    );
    expect(insertPlan(snippet({ content_html: '<p>See <a href="x">this</a></p>' })).mode).toBe(
      "html",
    );
  });

  it("never sees blocks alongside a refusal", () => {
    /*
     * The contract `insertPlan` leans on. Today `parsePage` returns no blocks
     * whenever it refuses, so its two conditions are redundant; if that ever
     * changed, a partially-parsed table would start being flattened into the
     * composer instead of appended intact. This is the alarm for that.
     */
    for (const html of [
      "<table><tr><td>a</td></tr></table>",
      "<p>Plain line</p><table><tr><td>a</td></tr></table>",
      '<p style="color:red">Danger</p>',
      '<p>ok</p><img src="a.png">',
    ]) {
      const parsed = parsePage(html);
      if (parsed.refusal !== null) expect(parsed.blocks, html).toHaveLength(0);
    }
  });

  it("treats an empty snippet as html rather than inserting nothing", () => {
    // Zero blocks would insert silently and look like the tap did not register.
    expect(insertPlan(snippet({ content_html: "" })).mode).toBe("html");
    expect(insertPlan(snippet({ content_html: "   " })).mode).toBe("html");
  });
});

describe("appendHtml", () => {
  it("is lossless for markup the block model cannot rebuild", () => {
    const page = "<h1>Site log</h1>";
    const table = "<table><tr><td>7A</td></tr></table>";
    expect(appendHtml(page, table)).toContain(table);
    expect(appendHtml(page, table)).toContain(page);
  });

  it("never reads the page it appends to", () => {
    /*
     * The property the whole append mode rests on. A page whose header is a
     * table and whose logo is an image survives intact, because string
     * concatenation cannot lose what it does not look at.
     */
    const untouchable = '<table><tr><td><img src="logo.png"></td></tr></table>';
    expect(appendHtml(untouchable, "<p>Arrived 07:40</p>")).toContain(untouchable);
  });

  it("returns the page unchanged when there is nothing to add", () => {
    expect(appendHtml("<p>a</p>", "")).toBe("<p>a</p>");
    expect(appendHtml("<p>a</p>", "   ")).toBe("<p>a</p>");
  });

  it("returns just the addition when the page is empty", () => {
    expect(appendHtml("", "<p>a</p>")).toBe("<p>a</p>");
  });

  it("round-trips what the composer serialises", () => {
    // A snippet saved from the composer and inserted again should come back the
    // same, which is only true if both ends agree on the serialisation.
    const html = serialiseBlocks([{ id: "1", kind: "paragraph", text: "Scaffold signed off." }]);
    expect(insertPlan({ content_html: html }).blocks[0].text).toBe("Scaffold signed off.");
  });
});

describe("filterSnippets", () => {
  const all = [
    snippet({ id: "1", title: "Standard 3", content_html: "<p>Isolation confirmed at board</p>" }),
    snippet({ id: "2", title: "Handover", content_html: "<p>Keys returned to site office</p>" }),
  ];

  it("returns everything for an empty search", () => {
    expect(filterSnippets(all, "")).toHaveLength(2);
    expect(filterSnippets(all, "   ")).toHaveLength(2);
  });

  it("matches the title", () => {
    expect(filterSnippets(all, "handover").map((s) => s.id)).toEqual(["2"]);
  });

  it("matches the body, which is how people actually look for these", () => {
    /*
     * Crews name snippets things like "Standard 3" and then search for the
     * words inside them. Title-only matching means scrolling, which is the
     * thing the library exists to avoid.
     */
    expect(filterSnippets(all, "isolation").map((s) => s.id)).toEqual(["1"]);
  });

  it("ignores the markup when matching", () => {
    // Searching "p" should not match every snippet via its <p> tags.
    expect(filterSnippets(all, "<p>")).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    expect(filterSnippets(all, "KEYS")).toHaveLength(1);
  });
});

describe("snippetPreview", () => {
  it("strips tags down to readable text", () => {
    expect(snippetPreview(snippet({ content_html: "<h2>Note</h2><p>Body</p>" }))).toBe("Note Body");
  });

  it("decodes entities rather than showing them", () => {
    expect(snippetPreview(snippet({ content_html: "<p>Live &amp; neutral</p>" }))).toContain(
      "Live & neutral",
    );
  });

  it("is empty rather than saying Empty page", () => {
    // `pagePreview`'s wording is right for a page and wrong here, and it would
    // also be searchable text that nobody typed.
    expect(snippetPreview(snippet({ content_html: "" }))).toBe("");
  });
});

describe("suggestedTitle", () => {
  it("offers the first sentence, so the library is not full of Untitled", () => {
    expect(suggestedTitle("<p>Scaffold signed off. Second sentence.</p>")).toBe(
      "Scaffold signed off",
    );
  });

  it("cuts on a word boundary, not mid-word", () => {
    // A title ending mid-word reads as a truncation bug rather than a
    // suggestion somebody is invited to edit.
    const long = "<p>" + "alpha bravo charlie delta echo foxtrot golf hotel india</p>";
    const title = suggestedTitle(long, 30);
    expect(title.length).toBeLessThanOrEqual(30);
    expect(title).not.toMatch(/\s$/);
    expect(long).toContain(title);
  });

  it("is empty for empty content, rather than guessing", () => {
    expect(suggestedTitle("")).toBe("");
  });

  it("never suggests something the server would reject", () => {
    const title = suggestedTitle("<p>" + "x".repeat(500) + "</p>");
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(snippetTitleError(title)).toBeNull();
  });
});

describe("validation mirrors the server", () => {
  it("needs a name", () => {
    expect(snippetTitleError("")).toContain("name");
    expect(snippetTitleError("   ")).toContain("name");
    expect(snippetTitleError("Standard 3")).toBeNull();
  });

  it("holds the same title ceiling", () => {
    expect(snippetTitleError("x".repeat(MAX_TITLE_LENGTH))).toBeNull();
    expect(snippetTitleError("x".repeat(MAX_TITLE_LENGTH + 3))).toContain("3 characters");
  });

  it("refuses an empty body", () => {
    expect(snippetBodyError("")).toContain("nothing to save");
    expect(snippetBodyError("<p>a</p>")).toBeNull();
  });

  it("matches the bounds the schema actually enforces", () => {
    /*
     * Two copies on purpose: the server validates, the client explains first so
     * nobody types four hundred words into a phone and is then told no by a
     * server they cannot see. A diff should show it if they drift.
     */
    const service = readFileSync(
      join(process.cwd(), "apps/api/src/domains/projects/text-snippets.ts"),
      "utf8",
    );
    expect(service).toContain(`max(${MAX_TITLE_LENGTH})`);
    expect(service).toContain("max(20_000)");
    expect(MAX_SNIPPET_LENGTH).toBe(20_000);
  });

  it("sends the field names the schema reads", () => {
    const service = readFileSync(
      join(process.cwd(), "apps/api/src/domains/projects/text-snippets.ts"),
      "utf8",
    );
    const client = readFileSync(join(process.cwd(), "apps/mobile/src/api/snippets.ts"), "utf8");
    for (const field of ["title", "contentHtml", "snippetId"]) {
      expect(service, `server ${field}`).toContain(field);
      expect(client, `client ${field}`).toContain(field);
    }
  });

  it("omits a patch key rather than sending it undefined", () => {
    /*
     * The update service writes only the keys it is given, so sending
     * `title: undefined` from a rename that only changed the body would be
     * harmless, but sending the key at all is what decides it gets written.
     * Spreading keeps the two in step.
     */
    const client = readFileSync(join(process.cwd(), "apps/mobile/src/api/snippets.ts"), "utf8");
    expect(client).toContain("input.title === undefined ? {} :");
    expect(client).toContain("input.contentHtml === undefined ? {} :");
  });
});

describe("librarySummary", () => {
  it("says when there is nothing, counts when there is", () => {
    expect(librarySummary(0, 0)).toBe("No snippets saved yet");
    expect(librarySummary(1, 1)).toBe("1 snippet");
    expect(librarySummary(6, 6)).toBe("6 snippets");
  });

  it("says how many a search left", () => {
    expect(librarySummary(6, 2)).toBe("2 of 6");
  });
});
