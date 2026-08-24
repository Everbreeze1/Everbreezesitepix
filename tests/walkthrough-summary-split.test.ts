import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePhotoNotes, stripPhotoGallery } from "../apps/api/src/domains/walkthroughs/summaries";
import {
  digestPhotos,
  summaryProse,
  demoteHeadings,
  flattenHeadings,
  currentSummaries,
} from "../apps/api/src/domains/projects/comprehensive-report";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/*
 * Splitting the Walkthrough and the AI Summary into two object types.
 *
 * "opening an 'AI Summary' from Reports loads at a /walkthroughs/{id} URL with
 * the tab title 'Walkthrough,' even when there's no video. These need to be
 * separate object types before anything else on this list will hold together."
 */

describe("stripPhotoGallery", () => {
  /*
   * The written summary is text. The old composer appended a `## Photos`
   * gallery of `![](photo:id)` refs to it, which every reader then had to strip
   * back out before rendering so the real gallery could own the photos - and
   * which put the pictures above their own notes when one forgot.
   */
  it("removes a trailing photo gallery", () => {
    const md =
      "## Overview\n\nWalked the roof.\n\n## Photos\n\n### Photo 1\n\n![Photo 1](photo:abc)\n";
    const out = stripPhotoGallery(md);
    expect(out).toContain("Walked the roof.");
    expect(out).not.toContain("photo:abc");
    expect(out).not.toMatch(/##\s*Photos/);
  });

  it("removes a stray inline photo ref wherever it sits", () => {
    const out = stripPhotoGallery("## Overview\n\nBefore ![x](photo:abc) after.\n");
    expect(out).not.toContain("photo:abc");
    expect(out).toContain("Before");
    expect(out).toContain("after.");
  });

  it("removes a title the page already provides", () => {
    expect(stripPhotoGallery("# Willow Street\n\n## Overview\n\nText.")).not.toContain(
      "# Willow Street",
    );
  });

  it("keeps sections that are not a gallery", () => {
    const md = "## Overview\n\nA.\n\n## Findings\n\n- B\n\n## Follow-ups\n\n- C\n";
    const out = stripPhotoGallery(md);
    expect(out).toContain("Findings");
    expect(out).toContain("Follow-ups");
    expect(out).toContain("- C");
  });

  it("survives empty and null-ish input", () => {
    expect(stripPhotoGallery("")).toBe("");
    expect(stripPhotoGallery(undefined as never)).toBe("");
  });
});

describe("parsePhotoNotes", () => {
  /* The column is jsonb, so anything at all can come back out of it. */
  it("rejects non-arrays", () => {
    expect(parsePhotoNotes(null)).toEqual([]);
    expect(parsePhotoNotes({})).toEqual([]);
    expect(parsePhotoNotes("[]")).toEqual([]);
  });

  it("drops entries with no photo id, which could never render", () => {
    expect(parsePhotoNotes([{ note: "orphan" }, { photoId: "", note: "x" }])).toEqual([]);
  });

  it("keeps a note beside its photo", () => {
    const out = parsePhotoNotes([
      { photoId: "p1", offsetSeconds: 12, note: "Flashing", spoken: "checking the flashing" },
    ]);
    expect(out).toEqual([
      { photoId: "p1", offsetSeconds: 12, note: "Flashing", spoken: "checking the flashing" },
    ]);
  });

  it("normalises a blank spoken value to null", () => {
    // null is what the UI checks to decide whether to draw the quote block at
    // all, so an empty string would draw an empty quote.
    expect(parsePhotoNotes([{ photoId: "p1", spoken: "   " }])[0].spoken).toBeNull();
    expect(parsePhotoNotes([{ photoId: "p1" }])[0].spoken).toBeNull();
  });

  it("defaults a missing offset to zero rather than NaN", () => {
    expect(parsePhotoNotes([{ photoId: "p1", offsetSeconds: "nope" }])[0].offsetSeconds).toBe(0);
  });
});

describe("digestPhotos", () => {
  /*
   * The comprehensive report's figures are computed, not asked of the model: a
   * count is a fact, and a model asked for one will sometimes produce a
   * plausible different number on a client-facing document.
   */
  const photo = (over: Record<string, unknown> = {}) => ({
    id: "p",
    caption: null,
    phase: null,
    takenAt: null,
    tags: [] as string[],
    ...over,
  });

  it("counts photos, days and the span they cover", () => {
    const d = digestPhotos([
      photo({ id: "a", takenAt: "2026-08-01T10:00:00Z" }),
      photo({ id: "b", takenAt: "2026-08-01T15:00:00Z" }),
      photo({ id: "c", takenAt: "2026-08-04T09:00:00Z" }),
    ]);
    expect(d.total).toBe(3);
    expect(d.days).toBe(2);
    expect(d.firstAt).toBe("2026-08-01T10:00:00Z");
    expect(d.lastAt).toBe("2026-08-04T09:00:00Z");
  });

  it("tallies labels and phases, most used first", () => {
    const d = digestPhotos([
      photo({ id: "a", phase: "before", tags: ["roof", "hvac"] }),
      photo({ id: "b", phase: "after", tags: ["roof"] }),
      photo({ id: "c", phase: "before", tags: ["roof"] }),
    ]);
    expect(d.phases[0]).toEqual(["before", 2]);
    expect(d.tags[0]).toEqual(["roof", 3]);
  });

  it("does not pass a filename off as a written note", () => {
    // Uploads default the caption to the source filename, and this text goes
    // into a prompt for a client-facing report.
    const d = digestPhotos([photo({ id: "a", caption: "IMG_1234.JPG" })]);
    expect(d.captions).toEqual([]);
    expect(d.captioned).toBe(0);
  });

  it("survives a job whose photos have no dates at all", () => {
    const d = digestPhotos([photo({ id: "a" }), photo({ id: "b" })]);
    expect(d.total).toBe(2);
    expect(d.days).toBe(0);
    expect(d.firstAt).toBeNull();
  });
});

describe("the split, as wiring", () => {
  const SUMMARY_PAGE = "apps/web/src/features/walkthroughs/pages/SummaryDetailPage.tsx";
  const SUMMARY_ROUTE = "apps/web/src/routes/_app.summaries.$summaryId.tsx";
  const NOTES = "apps/web/src/features/walkthroughs/components/SummaryPhotoNotes.tsx";
  const PROJECT_PAGE = "apps/web/src/features/projects/pages/ProjectDetailPage.tsx";
  const MIGRATION = "supabase/migrations/20261003000000_walkthrough_summaries_split.sql";

  it("gives a summary its own route and its own browser title", () => {
    // The literal complaint: a summary opening at a walkthrough's URL under a
    // tab titled "Walkthrough".
    const route = read(SUMMARY_ROUTE);
    expect(route).toContain("/_app/summaries/$summaryId");
    expect(route).toContain("Summary - SitePix");
    expect(route).not.toContain("Walkthrough - SitePix");
  });

  it("renders the text before the photos", () => {
    /*
     * "the text is on the bottom and the pictures are on top, it should be
     * backward. Please make that text show first for summery and the pictures
     * after."
     */
    const src = read(SUMMARY_PAGE);
    const textAt = src.indexOf('<h2 className="text-xl font-semibold tracking-tight">Summary</h2>');
    const photosAt = src.indexOf("<SummaryPhotoNotes");
    expect(textAt).toBeGreaterThan(-1);
    expect(photosAt).toBeGreaterThan(-1);
    expect(textAt).toBeLessThan(photosAt);
  });

  it("puts each note beside its own photo, in one list", () => {
    // "not narration and photos in two separate lists like the current build."
    const src = read(NOTES);
    expect(src).toContain("photos.map");
    expect(src).toContain("photo.note");
    expect(src).toContain("photo.spoken");
    // One <ol>, not a rail plus a gallery.
    expect(src.match(/<ol/g) ?? []).toHaveLength(1);
  });

  it("splits the Walkthroughs tab into Videos and Summaries", () => {
    const src = read(PROJECT_PAGE);
    expect(src).toContain('walkSection === "summaries"');
    expect(src).toContain("<ProjectSummaries");
    expect(src).toMatch(/\["videos", "Videos"/);
    expect(src).toMatch(/\["summaries", "Summaries"/);
  });

  it("keeps a summary's share link separate from the video's", () => {
    // "the video can be shared and the summery can be generated and shared."
    expect(read(SUMMARY_PAGE)).toContain("/share/summaries/");
  });

  it("revokes anon on the new table, which carries a share token", () => {
    // The same leak walkthroughs had. tests/invariants.test.ts enforces this
    // across every migration; asserted here too because this table is the one
    // that would leak share tokens again.
    const sql = read(MIGRATION);
    expect(sql).toMatch(/REVOKE ALL ON public\.walkthrough_summaries FROM anon/);
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("carries share tokens across so links already sent keep working", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain("w.share_token");
    expect(read("apps/api/src/domains/walkthroughs/service.ts")).toContain("redirectToSummary");
  });
});

/*
 * The migration has to survive a live database.
 *
 * The first attempt deadlocked against the running app. Both halves of the fix
 * are asserted here because both are invisible at review time: a lock taken in
 * the wrong order looks identical to one taken in the right order, and a
 * statement that changes nothing looks identical to one that does.
 */
describe("the split migration is safe to run against a live database", () => {
  const MIGRATION = "supabase/migrations/20261003000000_walkthrough_summaries_split.sql";
  /** Statements only: a rule about SQL must not be satisfied by a comment. */
  const statements = () =>
    read(MIGRATION)
      .split("\n")
      .filter((l) => !/^\s*--/.test(l))
      .join("\n");

  it("takes every lock before it does any work", () => {
    // Postgres cannot deadlock on locks acquired in the same order by every
    // session, so all of them are taken up front.
    const sql = statements();
    const lockAt = sql.indexOf("LOCK TABLE public.walkthroughs IN ACCESS EXCLUSIVE MODE");
    const createAt = sql.indexOf("create table if not exists public.walkthrough_summaries");
    expect(lockAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(createAt);
  });

  it("fails fast rather than queueing behind a live read", () => {
    // A lock timeout leaves nothing applied, and everything here is idempotent,
    // so re-running is the recovery.
    expect(statements()).toMatch(/SET lock_timeout\s*=/);
  });

  it("does not re-set a default that is already set", () => {
    /*
     * `ALTER COLUMN source SET DEFAULT 'recorded'` was in the first draft and
     * was the statement that deadlocked - for nothing, because
     * 20260814000000_walkthrough_source.sql had already set that exact default.
     * It changed no value and took an ACCESS EXCLUSIVE lock on the busiest
     * table in the schema to do it.
     */
    expect(statements()).not.toContain("ALTER COLUMN source SET DEFAULT");
  });

  it("tells PostgREST about the new table", () => {
    // The schema cache answers /rest/v1/walkthrough_summaries and is only
    // rebuilt when told. Without this the app 404s on every summary call and it
    // reads as the migration not having worked.
    expect(statements()).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it("can be run twice", () => {
    const sql = statements();
    expect(sql).toContain("create table if not exists");
    expect(sql).toContain("DROP POLICY IF EXISTS");
    // The move skips rows already carried across.
    expect(sql).toContain("AND NOT EXISTS (");
  });
});

/*
 * What the split leaves behind, and what has to be repaired on read.
 *
 * The migration moved 11 real summaries across, and every one of them carries
 * the format they were written in. Both of these were found by running the read
 * path over the migrated rows, not by writing a test first.
 */
describe("summaries written before the split still render", () => {
  const SUMMARIES = "apps/api/src/domains/walkthroughs/summaries.ts";

  it("cleans the prose on the way out, not only on the way in", () => {
    /*
     * Every pre-split summary embeds a `# Title` and a `## Photos` gallery of
     * `![](photo:id)` refs. Those refs only ever resolved through a bespoke
     * image component; the summary page renders plain Markdown, so unstripped
     * they are broken images - and the same photos appear again below in their
     * own list. Stripping in `toSummary` fixes all of them at once, on read,
     * with no second migration rewriting rows a user may have edited.
     */
    const src = read(SUMMARIES);
    expect(src).toMatch(/function toSummary[\s\S]*?stripPhotoGallery\(row\.markdown\)/);
  });

  it("falls a blank note back to the photo's caption", () => {
    /*
     * The move filled `note` from `spoken_note`, which is null for a summary
     * nobody walked - so all 113 migrated notes are empty while their photos
     * carry real captions. Without the fallback every card reads "Nothing was
     * recorded against this photo" next to a photo that plainly says what it is.
     */
    const src = read(SUMMARIES);
    expect(src).toContain('note: n.note?.trim() || caption || ""');
  });

  it("does not print the caption twice when it became the note", () => {
    // The card shows the caption line only when it differs from the note, which
    // is what keeps the fallback from duplicating itself.
    const notes = read("apps/web/src/features/walkthroughs/components/SummaryPhotoNotes.tsx");
    expect(notes).toContain("photo.caption !== photo.note");
  });
});

/*
 * The video and the summary are two sections, not one card.
 *
 * "Under walkthrough Tab we should have Section for Videos of the walkthrough
 * independent of the summery and a section for the Summery in a document
 * format... Right now the summery produces the photo summery and the video in
 * the same card."
 */
describe("the video page carries no summary", () => {
  const WT_PAGE = "apps/web/src/features/walkthroughs/pages/WalkthroughDetailPage.tsx";

  it("renders no photo list and no written summary", () => {
    const src = read(WT_PAGE);
    expect(src).not.toContain("<AiNarratedPhotoSteps");
    expect(src).not.toContain("<WalkthroughPhotoSteps");
    expect(src).not.toContain("<WalkthroughMarkdown");
  });

  it("still plays the recording", () => {
    // The chapter rail stays: that is navigation within the footage, not a
    // second copy of the write-up.
    expect(read(WT_PAGE)).toContain("<WalkthroughNarratedPlayer");
  });

  it("links across to the summary, and can create one", () => {
    const src = read(WT_PAGE);
    expect(src).toContain("/summaries/$summaryId");
    expect(src).toContain("generateSummaryForWalkthrough");
    expect(src).toContain("Generate summary");
  });
});

/*
 * The comprehensive Report reads the walkthrough write-ups too.
 *
 * "The comprehensive longer Report that contains all meta data including all
 * walkthrough summery data". Those summaries are the only place on a job where
 * somebody said what was actually happening.
 */
describe("the comprehensive Report includes walkthrough summary data", () => {
  const REPORT = "apps/api/src/domains/projects/comprehensive-report.ts";

  it("reads the summaries for the project", () => {
    const src = read(REPORT);
    expect(src).toContain('.from("walkthrough_summaries")');
    expect(src).toContain("MAX_SUMMARIES_INCLUDED");
  });

  it("quotes them into the document, not just into the prompt", () => {
    // "see the walkthrough summary" is not something a client receiving a PDF
    // can act on.
    const src = read(REPORT);
    // Fed the filtered, visit-dated set; proven end to end in
    // tests/report-summary-selection.test.ts.
    expect(src).toContain("walkthroughSummariesHtml(dated)");
    expect(src).toContain("<h2>Walkthrough Summaries</h2>");
  });

  it("flattens their headings before using them as prompt context", () => {
    // A model handed a document containing "## Conclusion" echoes it back.
    expect(read(REPORT)).toContain("function flattenHeadings");
  });

  it("omits a narrative section it has no text for", () => {
    // An empty <h2> is a blank promise on a document handed to a client.
    const src = read(REPORT);
    expect(src).toContain(
      '(summary ? `<h2>Executive Summary</h2>` + markdownToHtml(summary) : "")',
    );
    expect(src).not.toContain("`<p></p>`");
  });
});

/*
 * A page break the author places while editing.
 */
describe("page break", () => {
  const NODE = "apps/web/src/lib/tiptap-page-break.ts";
  const PDF = "apps/api/src/domains/projects/page-pdf.ts";

  it("is its own node, not an overloaded horizontal rule", () => {
    /*
     * `<hr>` is spent: the PDF draws it as a visible line and the generated
     * cover pages use two of them. Overloading it would give every cover page
     * two silent page breaks.
     */
    const node = read(NODE);
    expect(node).toContain('name: "pageBreak"');
    expect(node).toContain("data-page-break");
    expect(node).not.toContain('tag: "hr"');
  });

  it("is registered in the editor and offered in the Insert menu", () => {
    expect(read("apps/web/src/features/projects/pages/ProjectPageEditorPage.tsx")).toContain(
      "PageBreak,",
    );
    const toolbar = read("apps/web/src/features/projects/components/DocumentToolbar.tsx");
    expect(toolbar).toContain('insertContent({ type: "pageBreak" })');
    expect(toolbar).toContain("Page break");
  });

  it("actually breaks the page in the PDF", () => {
    const pdf = read(PDF);
    expect(pdf).toContain('node.attrs["data-page-break"] !== undefined');
    expect(pdf).toContain("layout.newPage()");
  });

  it("defers the break until there is something to put on the next page", () => {
    /*
     * Taking the break where it is found appends a sheet with nothing on it
     * whenever the break ends the document - which is exactly where an author
     * leaves one after splitting a section off. Proven end to end against the
     * real renderer in tests/page-break-pdf.test.ts.
     */
    const pdf = read(PDF);
    expect(pdf).toContain("layout.pendingBreak = true;");
    expect(pdf).toMatch(/ensureSpace[\s\S]{0,400}pendingBreak/);
  });

  it("is visible while editing", () => {
    // The node has no content of its own, so with no styling it would be an
    // invisible blank line and the author could not tell it had landed.
    const css = read("apps/web/src/styles.css");
    expect(css).toContain(".tiptap [data-page-break]");
    expect(css).toContain('content: "Page break"');
  });
});

/*
 * The comprehensive Report reuses summary prose, and that reuse has a shape.
 *
 * Every one of these was found by generating the report against real data and
 * reading the HTML that came out, not by reasoning about the code.
 */
describe("summary prose reused inside the Report", () => {
  const REPORT = "apps/api/src/domains/projects/comprehensive-report.ts";

  it("cleans the prose it reads straight from the table", () => {
    /*
     * The report queries `walkthrough_summaries.markdown` directly, which skips
     * the repair `toSummary` does on every other read. Without this, a summary
     * written before the split contributed its old `# Title` and its
     * `![](photo:id)` gallery - and since `markdownToHtml` has no image
     * support, those came out as literal "![Photo 1](photo:76edc...)" text in a
     * document meant for a client.
     */
    const src = read(REPORT);
    expect(src).toContain("stripPhotoGallery");
    expect(src).toContain("function summaryProse");
  });

  it("does not emit a heading level the converter cannot render", () => {
    /*
     * `markdownToHtml` matches `#{1,3}` and nothing deeper
     * (packages/shared/src/markdown-rich.ts), so a `####` is not a heading -
     * it renders as the literal text "#### Overview". Bold lead-ins instead,
     * which also avoids colliding with the <h3> each summary already gets.
     */
    const src = read(REPORT);
    expect(src).not.toContain('"#### "');
    expect(src).toContain('"**$1**"');
  });

  it("keeps the converter's limit visible where it matters", () => {
    // The coupling is invisible from the call site, so it is written down next
    // to the code that depends on it.
    expect(read("packages/shared/src/markdown-rich.ts")).toContain("#{1,3}");
  });
});

/*
 * Reusing a summary's prose inside the Report.
 *
 * Four separate defects came out of this one small transformation, every one of
 * them found by generating the report against real data and reading the HTML.
 * They are pinned as behaviour here so the next change to it has to keep them.
 */
describe("summaryProse / demoteHeadings / flattenHeadings", () => {
  const LEGACY = [
    "# Summary - Aug 14, 2026",
    "",
    "## Overview",
    "",
    "A site visit was conducted.",
    "",
    "## Key Points",
    "",
    "- One thing",
    "",
    "## Photos",
    "",
    "### Photo 1",
    "",
    "![Photo 1](photo:76edc6de-0000-0000-0000-000000000000)",
    "",
    "*Condenser unit*",
  ].join("\n");

  it("drops the title the report already prints above it", () => {
    // It was rendering as a paragraph directly under the <h3> repeating it.
    expect(summaryProse(LEGACY)).not.toContain("# Summary - Aug 14, 2026");
  });

  it("drops the photo gallery, refs and all", () => {
    /*
     * `markdownToHtml` has no image support, so a surviving ref came out as the
     * literal text "![Photo 1](photo:76edc...)" in a document meant for a
     * client, under an orphan "Photos" line.
     */
    const out = summaryProse(LEGACY);
    expect(out).not.toContain("photo:");
    expect(out).not.toMatch(/##\s*Photos/);
    expect(out).not.toContain("Photo 1");
  });

  it("keeps the prose that matters", () => {
    const out = summaryProse(LEGACY);
    expect(out).toContain("A site visit was conducted.");
    expect(out).toContain("One thing");
  });

  it("survives a null or empty markdown", () => {
    expect(summaryProse(null)).toBe("");
    expect(summaryProse("")).toBe("");
  });

  it("caps one long write-up so it cannot crowd out the rest", () => {
    const huge = "## Overview\n\n" + "word ".repeat(5000);
    expect(summaryProse(huge).length).toBeLessThanOrEqual(4000);
  });

  it("turns headings into bold, never into a level the converter drops", () => {
    /*
     * `markdownToHtml` matches `#{1,3}` and nothing deeper, so `####` is not a
     * heading - it renders as the literal text "#### Overview". That shipped
     * once.
     */
    const out = demoteHeadings(summaryProse(LEGACY));
    expect(out).not.toMatch(/^#/m);
    expect(out).toContain("**Overview**");
    expect(out).toContain("**Key Points**");
  });

  it("leaves body text alone when demoting", () => {
    expect(demoteHeadings("## Overview\n\nPlain text.")).toContain("Plain text.");
  });

  it("removes headings entirely for prompt context", () => {
    // A model handed source text containing "## Conclusion" echoes that
    // structure back instead of writing the sections it was asked for.
    const out = flattenHeadings(summaryProse(LEGACY));
    expect(out).not.toMatch(/^#/m);
    expect(out).not.toContain("**");
    expect(out).toContain("Overview");
  });
});

/*
 * A Report draws on Summaries. It does not swallow them.
 *
 * "when a Report is generated, it's pulling in and printing the full body text
 * of every Summary ever generated for the project (...) that's why the 194
 * Daniels Drive report shows four near-identical 'Summary' blocks in its body
 * instead of one."
 *
 * `walkthrough_summaries` gains a row per generation: regenerating a
 * walkthrough's summary inserts a second one, and a summary written from photos
 * inserts one every time somebody asks. Reading the table by project therefore
 * returns the job's whole history of write-ups, and the Report printed all of
 * it. The Summary stays its own document either way; this is only about which
 * of them a Report may take as input.
 */
describe("currentSummaries", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    walkthrough_id: null as string | null,
    photo_notes: [] as unknown,
    markdown: "## Overview\n\nWalked the roof." as string | null,
    created_at: "2026-08-01T10:00:00Z" as string | null,
    ...over,
  });

  it("keeps the current summary of a walkthrough, not every generation of it", () => {
    const kept = currentSummaries([
      row({ id: "d", walkthrough_id: "w1", created_at: "2026-08-04T10:00:00Z", markdown: "4th" }),
      row({ id: "c", walkthrough_id: "w1", created_at: "2026-08-03T10:00:00Z", markdown: "3rd" }),
      row({ id: "b", walkthrough_id: "w1", created_at: "2026-08-02T10:00:00Z", markdown: "2nd" }),
      row({ id: "a", walkthrough_id: "w1", created_at: "2026-08-01T10:00:00Z", markdown: "1st" }),
    ]);
    expect(kept.map((r) => r.id)).toEqual(["d"]);
  });

  it("keeps one per walkthrough when the job has several", () => {
    // The Report covers the whole job, so every walk on it contributes - once.
    const kept = currentSummaries([
      row({
        id: "a1",
        walkthrough_id: "w1",
        created_at: "2026-08-01T10:00:00Z",
        markdown: "w1 v1",
      }),
      row({
        id: "a2",
        walkthrough_id: "w1",
        created_at: "2026-08-05T10:00:00Z",
        markdown: "w1 v2",
      }),
      row({
        id: "b1",
        walkthrough_id: "w2",
        created_at: "2026-08-06T10:00:00Z",
        markdown: "w2 v1",
      }),
    ]);
    expect(kept.map((r) => r.id)).toEqual(["a2", "b1"]);
  });

  it("reads oldest first, so the report walks forward through the job", () => {
    const kept = currentSummaries([
      row({ id: "late", walkthrough_id: "w2", created_at: "2026-08-09T10:00:00Z", markdown: "b" }),
      row({ id: "early", walkthrough_id: "w1", created_at: "2026-08-02T10:00:00Z", markdown: "a" }),
    ]);
    expect(kept.map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("collapses repeat runs over the same photo selection", () => {
    /*
     * A summary written from photos has no walkthrough to key on, so the photo
     * set is the key. Two runs over the same selection are one write-up drafted
     * twice, which is the other way four blocks land in a report and the way a
     * walkthrough_id-only fix would have missed.
     */
    const kept = currentSummaries([
      row({
        id: "new",
        photo_notes: [{ photoId: "p2" }, { photoId: "p1" }],
        created_at: "2026-08-07T10:00:00Z",
        markdown: "take 2",
      }),
      row({
        id: "old",
        photo_notes: [{ photoId: "p1" }, { photoId: "p2" }],
        created_at: "2026-08-06T10:00:00Z",
        markdown: "take 1",
      }),
    ]);
    expect(kept.map((r) => r.id)).toEqual(["new"]);
  });

  it("keeps summaries of genuinely different photo selections", () => {
    const kept = currentSummaries([
      row({ id: "roof", photo_notes: [{ photoId: "p1" }], markdown: "roof" }),
      row({
        id: "basement",
        photo_notes: [{ photoId: "p9" }],
        created_at: "2026-08-02T10:00:00Z",
        markdown: "basement",
      }),
    ]);
    expect(kept.map((r) => r.id).sort()).toEqual(["basement", "roof"]);
  });

  it("drops a duplicate body however it was keyed", () => {
    // The walk summarised, then its photos summarised again on their own: two
    // keys, one piece of prose. The client counted blocks, not rows.
    const kept = currentSummaries([
      row({
        id: "viaPhotos",
        photo_notes: [{ photoId: "p1" }],
        created_at: "2026-08-08T10:00:00Z",
        markdown: "## Overview\n\nWalked the roof.",
      }),
      row({
        id: "viaWalk",
        walkthrough_id: "w1",
        created_at: "2026-08-07T10:00:00Z",
        markdown: "## Overview\n\nWalked   the roof!",
      }),
    ]);
    expect(kept.map((r) => r.id)).toEqual(["viaPhotos"]);
  });

  it("keeps a row that has nothing to key on rather than guessing", () => {
    const kept = currentSummaries([
      row({ id: "x", markdown: "## Overview\n\nOne job." }),
      row({
        id: "y",
        markdown: "## Overview\n\nAnother job.",
        created_at: "2026-08-03T10:00:00Z",
      }),
    ]);
    expect(kept.map((r) => r.id).sort()).toEqual(["x", "y"]);
  });

  it("survives rows with no date on them", () => {
    const kept = currentSummaries([
      row({ id: "a", walkthrough_id: "w1", created_at: null, markdown: "a" }),
      row({ id: "b", walkthrough_id: "w1", created_at: null, markdown: "b" }),
    ]);
    expect(kept).toHaveLength(1);
  });
});

describe("the Report takes only the current summary per walkthrough", () => {
  const REPORT = "apps/api/src/domains/projects/comprehensive-report.ts";

  it("filters the rows before the prompt or the document sees them", () => {
    const src = read(REPORT);
    expect(src).toContain("currentSummaries(");
    // Nothing between the query and the render may use the raw rows.
    expect(src).not.toMatch(/const summaries = \(\(summaryRows/);
  });

  it("reads the newest rows, then drops the superseded ones", () => {
    /*
     * Order matters both ways round. Newest first out of the table, because
     * what has to be dropped is the superseded copies; oldest first out of
     * `currentSummaries`, because the report reads forward through the work.
     */
    const src = read(REPORT);
    expect(src).toContain('.order("created_at", { ascending: false })');
    expect(src).toContain("MAX_SUMMARY_ROWS_SCANNED");
    expect(src).toContain("current.slice(-MAX_SUMMARIES_INCLUDED)");
  });

  it("selects the column the photo-only case is keyed on", () => {
    // Without `photo_notes`, a summary with no walkthrough_id has nothing to
    // group on and four runs over one selection stay four blocks.
    expect(read(REPORT)).toContain(
      '.select("id, title, markdown, created_at, walkthrough_id, photo_notes")',
    );
  });

  it("says on the page that it is one per walkthrough", () => {
    const src = read(REPORT);
    expect(src).toContain("The current summary for each walkthrough documented on this job");
    expect(src).toContain("its own report");
  });

  it("leaves the Summary a document of its own", () => {
    /*
     * "Summary should also remain independently viewable and generatable as its
     * own report, separate from being embedded in a Report's body." Quoting one
     * into a Report must not become the only way to reach it: it keeps its own
     * route and its own generate calls.
     */
    expect(read("apps/web/src/routeTree.gen.ts")).toContain("/summaries/$summaryId");
    const wt = read("apps/web/src/features/walkthroughs/pages/WalkthroughDetailPage.tsx");
    expect(wt).toContain("generateSummaryForWalkthrough");
    const menu = read("apps/web/src/features/projects/components/GenerateDocumentMenu.tsx");
    expect(menu).toContain("generateSummaryFromPhotos");
  });
});

/*
 * Every client-facing draft asks for the work, not for the documenting of it.
 *
 * "The report keeps emphasizing this was documented that was documented. It
 * should say more huminized output like Contactor replaced, Control Board
 * replaced on this date."
 *
 * Four prompts fed that complaint, and only one of them was the Report's own.
 * The live rows on 194 Daniels Drive open with "This photo set documents", which
 * is the SUMMARY prompt's phrasing arriving inside the Report's body by way of
 * the block the Report quotes. Fixing the Report alone would have left the
 * client reading the same sentence in the same document.
 */
describe("the voice the client-facing drafts are asked for", () => {
  const SERVICE = "apps/api/src/domains/ai/service.ts";
  const SUMMARIES = "apps/api/src/domains/walkthroughs/summaries.ts";
  const REPORT = "apps/api/src/domains/projects/comprehensive-report.ts";

  it("is one shared rule, not a copy per prompt", () => {
    // Three uses in the service (the declaration, REPORT_SYSTEM, SUMMARY_SYSTEM)
    // and the Report importing it. A prompt carrying its own paraphrase is how
    // three of these drifted apart in the first place.
    const src = read(SERVICE);
    expect(src).toContain("export const WORK_VOICE_RULES");
    expect((src.match(/WORK_VOICE_RULES/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(read(REPORT)).toContain("WORK_VOICE_RULES");
  });

  it("fixes the Summary as well, because a Report quotes it verbatim", () => {
    const src = read(SERVICE);
    expect(src).not.toContain("describing what was documented and when");
    expect(src).toContain("saying what work was carried out and when");
  });

  it("leaves the internal Site Log alone, which already had the voice", () => {
    // "- Replaced condensate pump, unit 4B" is what the client is asking the
    // client-facing documents to sound like. It was here all along.
    expect(read(SERVICE)).toContain("Replaced condensate pump, unit 4B");
  });

  it("keeps the walkthrough findings tied to what was actually said", () => {
    // A recording constrains harder than captions do: the technician's words are
    // the only source, so the voice change must not become licence to assert
    // work nobody mentioned.
    const src = read(SUMMARIES);
    expect(src).toContain("Use ONLY what the transcript and the per-photo notes state");
    expect(src).toContain("never 'this documents'");
  });
});
