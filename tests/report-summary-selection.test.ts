import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * The Report, generated. Not asserted about: generated.
 *
 * "when a Report is generated, it's pulling in and printing the full body text
 * of every Summary ever generated for the project (...) that's why the 194
 * Daniels Drive report shows four near-identical 'Summary' blocks in its body
 * instead of one."
 *
 * The selection rule has its own unit tests in walkthrough-summary-split.test.ts
 * and those prove the rule. They do not prove the Report uses it, that the row
 * the rule needs is actually selected out of the table, or that what lands in
 * `project_pages.content_html` carries one block rather than four - which is
 * the thing the client counted. So this drives the real service against a fake
 * database and reads the HTML that comes out.
 */

/** The state each test arranges. Rows come back from the fake in table order. */
const DB = {
  summaries: [] as any[],
  /** The recordings behind those summaries, which is where a visit date lives. */
  walkthroughs: [] as any[],
  pages: [] as Array<{ title: string }>,
  /** What the service inserted, which is the document under test. */
  inserted: null as any,
  /** The prompt the drafter was handed, to check what the model was told. */
  prompt: "",
};

const project = {
  id: "p1",
  name: "194 Daniels Drive",
  street: "194 Daniels Drive",
  city: "Auburn",
  state: "CA",
  zip: "95603",
  client_name: "Mrs Daniels",
  client_contact: "(555) 010-2030",
  project_number: "JOB-4471",
};

const photos = [
  {
    id: "ph1",
    caption: "Attic unit before service",
    phase: "before",
    tags: ["attic"],
    taken_at: "2026-08-01T09:00:00Z",
    created_at: "2026-08-01T09:00:00Z",
  },
  {
    id: "ph2",
    caption: "Condenser after replacement",
    phase: "after",
    tags: ["condenser"],
    taken_at: "2026-08-09T15:00:00Z",
    created_at: "2026-08-09T15:00:00Z",
  },
];

/**
 * Just enough of a PostgREST query builder to run one service.
 *
 * Thenable rather than promise-returning per method, because the service ends
 * some chains on `.limit()` and others on `.maybeSingle()`, and awaits both.
 */
function fakeSupabase() {
  const builder = (table: string, columns = "") => {
    const state = { table, columns, insert: null as any };
    const result = () => {
      if (state.insert) return { data: { ...state.insert, id: "page1" }, error: null };
      switch (state.table) {
        case "projects":
          return { data: project, error: null };
        case "photos":
          return { data: photos, error: null };
        case "photo_tags":
          return { data: [], error: null };
        case "walkthrough_summaries":
          return { data: DB.summaries, error: null };
        case "walkthroughs":
          return { data: DB.walkthroughs, error: null };
        case "project_pages":
          return { data: DB.pages, error: null };
        case "profiles":
          return { data: { full_name: "Mike", report_photos_per_page: 2 }, error: null };
        default:
          return { data: [], error: null };
      }
    };
    const chain: any = {
      select: (c: string) => {
        state.columns = c;
        return chain;
      },
      eq: () => chain,
      is: () => chain,
      in: () => chain,
      order: (_col: string, opts: any) => {
        chain.orderedDescending = opts?.ascending === false;
        return chain;
      },
      limit: (n: number) => {
        chain.limited = n;
        return chain;
      },
      insert: (payload: any) => {
        state.insert = payload;
        DB.inserted = payload;
        return chain;
      },
      maybeSingle: async () => result(),
      single: async () => result(),
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    /** What the summary query asked the database for, so the test can check it. */
    chain.selectedColumns = () => state.columns;
    return chain;
  };
  const calls: any[] = [];
  return {
    calls,
    from: (table: string) => {
      const chain = builder(table);
      calls.push({ table, chain });
      return chain;
    },
  };
}

let supabase = fakeSupabase();

vi.mock("../apps/api/src/domains/ai/service", () => ({
  chatComplete: async (_system: string, prompt: string) => {
    DB.prompt = prompt;
    return "## Executive Summary\n\nWork was documented over nine days.\n\n## Work Documented\n\n- Attic unit\n\n## Conclusion\n\nThe record is complete.";
  },
}));

const { generateComprehensiveReportService } =
  await import("../apps/api/src/domains/projects/comprehensive-report");

const summaryRow = (over: Record<string, unknown>) => ({
  id: "s?",
  title: "Walkthrough - Summary",
  markdown: "## Overview\n\nWalked the attic and the condenser pad.\n\n## Findings\n\n- Unit runs.",
  created_at: "2026-08-01T10:00:00Z",
  walkthrough_id: null,
  photo_notes: [],
  ...over,
});

async function generate() {
  supabase = fakeSupabase();
  const ctx = { supabase, userId: "u1" } as any;
  return await generateComprehensiveReportService(ctx, { projectId: "p1" });
}

/** Every `<h3>` under the Walkthrough Summaries heading. */
function summaryBlocks(html: string): string[] {
  const section = html.split("<h2>Walkthrough Summaries</h2>")[1] ?? "";
  return [...section.matchAll(/<h3>(.*?)<\/h3>/g)].map((m) => m[1]);
}

beforeEach(() => {
  DB.summaries = [];
  DB.walkthroughs = [];
  DB.pages = [];
  DB.inserted = null;
  DB.prompt = "";
});

describe("the Report, generated against four generations of one summary", () => {
  /*
   * 194 Daniels Drive, as reported: one walkthrough, summarised four times,
   * newest first out of the table because that is the order the service asks
   * for.
   */
  beforeEach(() => {
    DB.summaries = [
      summaryRow({
        id: "s4",
        walkthrough_id: "w1",
        created_at: "2026-08-04T10:00:00Z",
        markdown: "## Overview\n\nFourth pass over the same walk.",
      }),
      summaryRow({
        id: "s3",
        walkthrough_id: "w1",
        created_at: "2026-08-03T10:00:00Z",
        markdown: "## Overview\n\nThird pass over the same walk.",
      }),
      summaryRow({
        id: "s2",
        walkthrough_id: "w1",
        created_at: "2026-08-02T10:00:00Z",
        markdown: "## Overview\n\nSecond pass over the same walk.",
      }),
      summaryRow({
        id: "s1",
        walkthrough_id: "w1",
        created_at: "2026-08-01T10:00:00Z",
        markdown: "## Overview\n\nFirst pass over the same walk.",
      }),
    ];
  });

  it("prints one summary block, not four", async () => {
    const res = await generate();
    expect(res.summaryCount).toBe(1);
    expect(summaryBlocks(DB.inserted.content_html)).toHaveLength(1);
  });

  it("prints the current one, and none of the superseded text", async () => {
    await generate();
    const html: string = DB.inserted.content_html;
    expect(html).toContain("Fourth pass over the same walk.");
    expect(html).not.toContain("Third pass");
    expect(html).not.toContain("Second pass");
    expect(html).not.toContain("First pass");
  });

  it("tells the drafter about one write-up, not four", async () => {
    // The prompt is the other half of "pulling in": four copies of one walk in
    // the context is what makes the narrative describe four visits.
    await generate();
    expect(DB.prompt).toContain("Walkthrough write-ups on this job (1):");
    expect(DB.prompt).toContain("Fourth pass over the same walk.");
    expect(DB.prompt).not.toContain("First pass over the same walk.");
  });

  it("still files as a Report, with its client info and its photos", async () => {
    // The filtering must not have cost the document anything else it carries.
    const res = await generate();
    const html: string = DB.inserted.content_html;
    expect(DB.inserted.source_template).toBe("report");
    expect(html).toContain("Mrs Daniels");
    expect(html).toContain("JOB-4471");
    expect(html).toContain("<h2>Executive Summary</h2>");
    expect(html).toContain('data-photo-id="ph1"');
    expect(res.photoCount).toBe(2);
  });
});

describe("the Report, generated against the other shapes of summary history", () => {
  it("keeps one entry per walkthrough when the job has several walks", async () => {
    DB.summaries = [
      summaryRow({
        id: "b2",
        walkthrough_id: "w2",
        title: "Second visit - Summary",
        created_at: "2026-08-08T10:00:00Z",
        markdown: "## Overview\n\nSecond visit, current.",
      }),
      summaryRow({
        id: "b1",
        walkthrough_id: "w2",
        title: "Second visit - Summary",
        created_at: "2026-08-07T10:00:00Z",
        markdown: "## Overview\n\nSecond visit, superseded.",
      }),
      summaryRow({
        id: "a1",
        walkthrough_id: "w1",
        title: "First visit - Summary",
        created_at: "2026-08-01T10:00:00Z",
        markdown: "## Overview\n\nFirst visit.",
      }),
    ];
    await generate();
    const html: string = DB.inserted.content_html;
    const blocks = summaryBlocks(html);
    expect(blocks).toHaveLength(2);
    // Oldest first: the report reads forward through the job.
    expect(blocks[0]).toContain("First visit");
    expect(blocks[1]).toContain("Second visit");
    expect(html).not.toContain("superseded");
  });

  it("collapses repeat runs of a summary written from photos", async () => {
    /*
     * No `walkthrough_id` on these, so the photo set is what identifies them.
     * This is the case a walkthrough_id-only fix would still print four times,
     * and the case the report's own screenshot cannot distinguish from the
     * other one.
     */
    DB.summaries = [
      summaryRow({
        id: "p3",
        created_at: "2026-08-06T10:00:00Z",
        photo_notes: [{ photoId: "ph2" }, { photoId: "ph1" }],
        markdown: "## Overview\n\nThird run over the same two photos.",
      }),
      summaryRow({
        id: "p2",
        created_at: "2026-08-05T10:00:00Z",
        photo_notes: [{ photoId: "ph1" }, { photoId: "ph2" }],
        markdown: "## Overview\n\nSecond run over the same two photos.",
      }),
      summaryRow({
        id: "p1",
        created_at: "2026-08-04T10:00:00Z",
        photo_notes: [{ photoId: "ph1" }, { photoId: "ph2" }],
        markdown: "## Overview\n\nFirst run over the same two photos.",
      }),
    ];
    await generate();
    expect(summaryBlocks(DB.inserted.content_html)).toHaveLength(1);
    expect(DB.inserted.content_html).toContain("Third run");
  });

  it("keeps two walks whose summaries came out word for word the same", async () => {
    /*
     * A summary the model could not write falls back to fixed text, so two
     * walks documented while the provider was down have identical bodies.
     * Dropping one would take a visit off a report that lists the rest.
     */
    const placeholder = "## Overview\n\nSummary of the selected site photos.";
    DB.summaries = [
      summaryRow({
        id: "d2",
        walkthrough_id: "w2",
        title: "Tuesday - Summary",
        created_at: "2026-08-05T10:00:00Z",
        markdown: placeholder,
      }),
      summaryRow({
        id: "d1",
        walkthrough_id: "w1",
        title: "Monday - Summary",
        created_at: "2026-08-04T10:00:00Z",
        markdown: placeholder,
      }),
    ];
    await generate();
    const blocks = summaryBlocks(DB.inserted.content_html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("Monday");
    expect(blocks[1]).toContain("Tuesday");
  });

  it("says nothing about walkthroughs on a job that has none", async () => {
    // An empty heading is a blank promise on a document handed to a client.
    await generate();
    expect(DB.inserted.content_html).not.toContain("Walkthrough Summaries");
  });

  it("skips a summary that is still generating and has no prose yet", async () => {
    DB.summaries = [summaryRow({ id: "e1", walkthrough_id: "w1", markdown: null })];
    const res = await generate();
    expect(res.summaryCount).toBe(0);
    expect(DB.inserted.content_html).not.toContain("Walkthrough Summaries");
  });

  it("asks the database for the newest rows and for the column it groups on", async () => {
    /*
     * Both halves of the query matter. Newest first, because the rows to
     * discard are the superseded ones; `photo_notes`, because without it a
     * summary with no walkthrough_id has nothing to be grouped by.
     */
    DB.summaries = [summaryRow({ id: "s1", walkthrough_id: "w1" })];
    await generate();
    const call = supabase.calls.find((c: any) => c.table === "walkthrough_summaries");
    expect(call.chain.selectedColumns()).toContain("photo_notes");
    expect(call.chain.orderedDescending).toBe(true);
    // Read wide, then filter: a dozen regenerations must not fill the allowance.
    expect(call.chain.limited).toBeGreaterThan(12);
  });
});

describe("the date a summary block carries", () => {
  /*
   * Taking the newest row per walkthrough is what fixed the duplicate blocks,
   * and it is also what made this necessary: a summary regenerated three weeks
   * after the walk carries that later `created_at`, so dating the block by the
   * row prints the visit as having happened on the day somebody last pressed
   * Regenerate. In the document that is meant to be the record of when the work
   * was done.
   */
  it("dates the block by the walk, not by the regeneration", async () => {
    DB.walkthroughs = [{ id: "w1", started_at: "2026-08-01T08:30:00Z", created_at: null }];
    DB.summaries = [
      summaryRow({
        id: "s2",
        walkthrough_id: "w1",
        created_at: "2026-08-22T10:00:00Z",
        markdown: "## Overview\n\nRegenerated three weeks later.",
      }),
    ];
    await generate();
    const [block] = summaryBlocks(DB.inserted.content_html);
    expect(block).toContain("August 1, 2026");
    expect(block).not.toContain("August 22, 2026");
  });

  it("orders the blocks by when the walks happened", async () => {
    DB.walkthroughs = [
      { id: "w1", started_at: "2026-08-01T08:00:00Z", created_at: null },
      { id: "w2", started_at: "2026-08-08T08:00:00Z", created_at: null },
    ];
    // w2 was walked second but its summary was written first.
    DB.summaries = [
      summaryRow({
        id: "b",
        walkthrough_id: "w1",
        title: "First visit - Summary",
        created_at: "2026-08-20T10:00:00Z",
        markdown: "## Overview\n\nFirst visit.",
      }),
      summaryRow({
        id: "a",
        walkthrough_id: "w2",
        title: "Second visit - Summary",
        created_at: "2026-08-09T10:00:00Z",
        markdown: "## Overview\n\nSecond visit.",
      }),
    ];
    await generate();
    const blocks = summaryBlocks(DB.inserted.content_html);
    expect(blocks[0]).toContain("First visit");
    expect(blocks[1]).toContain("Second visit");
  });

  it("falls back to the summary's own date when the recording is gone", async () => {
    // `walkthrough_id` is `on delete set null`, and deleting a recording to free
    // storage must not take the date off the write-up it produced.
    DB.walkthroughs = [];
    DB.summaries = [
      summaryRow({
        id: "orphan",
        walkthrough_id: "w9",
        created_at: "2026-08-06T10:00:00Z",
        markdown: "## Overview\n\nThe footage is gone.",
      }),
    ];
    await generate();
    expect(summaryBlocks(DB.inserted.content_html)[0]).toContain("August 6, 2026");
  });

  it("asks for no visit dates at all when nothing is keyed to a walk", async () => {
    // A round trip per report, spent on a summary written from photos that
    // never had a walkthrough to date it by.
    DB.summaries = [
      summaryRow({
        id: "p1",
        photo_notes: [{ photoId: "ph1" }],
        markdown: "## Overview\n\nPhotos.",
      }),
    ];
    await generate();
    expect(supabase.calls.some((c: any) => c.table === "walkthroughs")).toBe(false);
  });
});

describe("a summary written before the split, quoted into the Report", () => {
  /*
   * Pinned here because it is the pairing that broke last time: the report
   * reads `markdown` straight from the table, which skips the repair every
   * other read performs, and a legacy row carries its own `# Title` and a
   * `## Photos` gallery of refs `markdownToHtml` cannot render.
   */
  it("carries neither the old title nor the old gallery into the document", async () => {
    DB.summaries = [
      summaryRow({
        id: "legacy",
        walkthrough_id: "w1",
        markdown:
          "# Summary - Aug 14, 2026\n\n## Overview\n\nWalked the crawlspace.\n\n## Photos\n\n### Photo 1\n\n![Photo 1](photo:76edc)\n",
      }),
    ];
    await generate();
    const html: string = DB.inserted.content_html;
    expect(html).toContain("Walked the crawlspace.");
    expect(html).not.toContain("photo:76edc");
    expect(html).not.toContain("Summary - Aug 14, 2026");
    // Its own headings survive as bold lead-ins, not as a level the converter
    // renders literally.
    expect(html).toContain("<strong>Overview</strong>");
    expect(html).not.toContain("#### ");
  });
});
