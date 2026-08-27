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
 * and those prove the rule. They do not prove the Report uses it, or that the
 * row the rule needs is actually selected out of the table. So this drives the
 * real service against a fake database and reads both what came out and what
 * the drafter was told.
 *
 * The body does not quote the write-ups at all any more: "Walkthrough Summary
 * and Full Project Report are completely separate things", so a Report is
 * written FROM the Summaries rather than assembled out of them. That moves the
 * filtering assertions onto the prompt, where four accounts of one walk is what
 * makes a narrative describe four visits, and leaves the document checked for
 * their absence.
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
  /** The system prompt, which is where the voice rules live. */
  system: "",
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

/*
 * Only `chatComplete` is replaced. The rest of the module comes through real,
 * because `WORK_VOICE_RULES` lives there and the Report's system prompt is
 * built from it - a hand-copied stand-in would let the two drift and the voice
 * assertions below would then be testing the copy.
 */
vi.mock("../apps/api/src/domains/ai/service", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  chatComplete: async (system: string, prompt: string) => {
    DB.system = system;
    DB.prompt = prompt;
    return "## Executive Summary\n\nThe contactor was replaced.\n\n## Work Performed\n\n- Contactor replaced\n\n## Conclusion\n\nThe contactor was replaced and the unit was returned to service.";
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

/**
 * The write-up entries handed to the drafter, in the order it reads them.
 *
 * The prompt is where the selection shows now. Counting blocks in the HTML
 * would count zero however many superseded drafts survived the filtering.
 */
function writeUps(prompt: string): string[] {
  const block = (prompt.split("Field write-ups from the walkthroughs on this job")[1] ?? "").split(
    "Write the three Markdown sections only.",
  )[0];
  return block
    .split(/(?=Write-up \d+ of \d+)/)
    .slice(1)
    .map((s) => s.trim());
}

beforeEach(() => {
  DB.summaries = [];
  DB.walkthroughs = [];
  DB.pages = [];
  DB.inserted = null;
  DB.prompt = "";
  DB.system = "";
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

  it("hands the drafter one write-up, not four", async () => {
    // Four copies of one walk in the context is what makes the narrative
    // describe four visits.
    const res = await generate();
    expect(res.summaryCount).toBe(1);
    expect(writeUps(DB.prompt)).toHaveLength(1);
    expect(DB.prompt).toContain("Field write-ups from the walkthroughs on this job (1)");
  });

  it("gives it the current one, and none of the superseded text", async () => {
    await generate();
    expect(DB.prompt).toContain("Fourth pass over the same walk.");
    expect(DB.prompt).not.toContain("Third pass");
    expect(DB.prompt).not.toContain("Second pass");
    expect(DB.prompt).not.toContain("First pass");
  });

  it("prints none of the four, current one included", async () => {
    // The write-ups are material for the narrative, not part of the document.
    await generate();
    const html: string = DB.inserted.content_html;
    expect(html).not.toContain("Walkthrough Summaries");
    for (const pass of ["Fourth pass", "Third pass", "Second pass", "First pass"]) {
      expect(html).not.toContain(pass);
    }
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

/*
 * 194 Daniels Drive, as the production rows actually are.
 *
 * Not a reconstruction from the complaint: this is the history read off the
 * live table with scripts/sql/check-summary-photo-sets.sql. Five summary rows,
 * every one of them `walkthrough_id` NULL - no recording behind any of them -
 * and all five covering the SAME nine photos, confirmed by one shared hash of
 * their sorted photo ids.
 *
 * Two things follow, and they are why this case is pinned separately.
 *
 * A fix that grouped by `walkthrough_id` alone would not have touched this job:
 * five null keys are five groups, and the report would still print five blocks.
 * The photo set is the only thing that identifies these rows as one write-up
 * drafted five times.
 *
 * Neither would a prose fingerprint have saved it. The five bodies are 623, 579,
 * 1241, 1251 and 1228 characters and genuinely differ - the model wrote
 * something new each time - so nothing about the text collapses them.
 *
 * The counts matched too: the reports filed on 2026-08-22 and 2026-08-23 each
 * carried exactly four blocks, which is exactly how many summary rows existed
 * when each was generated.
 */
describe("194 Daniels Drive, from the live rows", () => {
  /** The nine photos every one of the five summaries covers. */
  const NINE = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"];
  /** Same set, different order - the notes are ordered by capture, not by id. */
  const shuffled = [...NINE].reverse();
  const notes = (ids: string[]) => ids.map((photoId) => ({ photoId }));

  beforeEach(() => {
    DB.summaries = [
      summaryRow({
        id: "7f3edf35",
        created_at: "2026-08-23T14:46:22.475298Z",
        photo_notes: notes(NINE),
        title: "Summary - Aug 23, 2026",
        markdown: "## Overview\n\nA site visit was conducted at 194 Daniels Drive. Fifth draft.",
      }),
      summaryRow({
        id: "c77015e0",
        created_at: "2026-08-22T04:24:32.157157Z",
        photo_notes: notes(shuffled),
        title: "Summary - Aug 22, 2026",
        markdown: "## Overview\n\nA site visit was conducted at 194 Daniels Drive. Fourth draft.",
      }),
      // The two oldest carry the pre-split format: their own `# Title` heading,
      // which the report prints an <h3> for already.
      summaryRow({
        id: "7c9b1680",
        created_at: "2026-08-21T14:43:54.109025Z",
        photo_notes: notes(NINE),
        title: "Summary - Aug 21, 2026",
        markdown:
          "# Summary - Aug 21, 2026\n\n## Overview\n\nA site visit was conducted. Third draft.",
      }),
      summaryRow({
        id: "411a7a7c",
        created_at: "2026-08-21T14:00:15.060162Z",
        photo_notes: notes(shuffled),
        title: "Summary - Aug 21, 2026",
        markdown:
          "# Summary - Aug 21, 2026\n\n## Overview\n\nA site visit was conducted. Second draft.",
      }),
      summaryRow({
        id: "0ac2c023",
        created_at: "2026-08-20T23:51:41.431079Z",
        photo_notes: notes(NINE),
        title: "Summary - Aug 20, 2026",
        markdown:
          "# Summary - Aug 20, 2026\n\n## Overview\n\nThis photo set documents. First draft.",
      }),
    ];
  });

  it("draws on one write-up where the filed reports carried four blocks", async () => {
    const res = await generate();
    expect(res.summaryCount).toBe(1);
    expect(writeUps(DB.prompt)).toHaveLength(1);
  });

  it("keeps the newest draft and none of the four superseded ones", async () => {
    await generate();
    expect(DB.prompt).toContain("Fifth draft.");
    for (const gone of ["Fourth draft", "Third draft", "Second draft", "First draft"]) {
      expect(DB.prompt).not.toContain(gone);
    }
    // And the survivor is still material rather than content.
    expect(DB.inserted.content_html).not.toContain("Fifth draft.");
  });

  it("groups them despite the notes being in different orders", async () => {
    // Two of the five list the same nine photos in reverse. Sorting the ids
    // inside the key is what makes those the same selection rather than two.
    await generate();
    expect(writeUps(DB.prompt)).toHaveLength(1);
  });

  it("strips a legacy row's own title before the drafter sees it", async () => {
    // Three of the five open with `# Summary - Aug NN, 2026`. A model handed a
    // titled, headed document writes an answer shaped like it instead of the
    // three sections it was asked for.
    DB.summaries = DB.summaries.filter((r) => r.id === "0ac2c023");
    await generate();
    expect(DB.prompt).toContain("First draft.");
    expect(DB.prompt).not.toContain("Summary - Aug 20, 2026");
    expect(DB.inserted.content_html).not.toContain("Summary - Aug 20, 2026");
  });

  it("tells the drafter about one write-up, not five", async () => {
    await generate();
    expect(DB.prompt).toContain("Field write-ups from the walkthroughs on this job (1)");
    expect(DB.prompt).not.toContain("First draft");
  });
});

describe("the Report, generated after a summary was redrafted over more photos", () => {
  /*
   * "The project full report (...) is generating the old version of summery.
   * The updated summery currently generating is good."
   *
   * Same habit as the five drafts above, one photo different: the author ticked
   * two more photos before pressing Generate again, so the new row keys on a
   * selection the old one is only part of. Grouping by the exact photo set
   * cannot collapse those, and the report printed the superseded write-up
   * first, because the section reads forward through the job - which puts the
   * old version at the top of the document being handed to a customer.
   */
  beforeEach(() => {
    DB.summaries = [
      summaryRow({
        id: "updated",
        created_at: "2026-08-23T14:46:22Z",
        title: "Summary - Aug 23, 2026",
        photo_notes: [{ photoId: "p1" }, { photoId: "p2" }, { photoId: "p3" }],
        markdown: "## Overview\n\nThe contactor was replaced. Updated draft.",
      }),
      summaryRow({
        id: "old",
        created_at: "2026-08-22T04:24:32Z",
        title: "Summary - Aug 22, 2026",
        photo_notes: [{ photoId: "p1" }, { photoId: "p2" }],
        markdown: "## Overview\n\nThis photo set documents a site visit. Old draft.",
      }),
    ];
  });

  it("feeds the updated write-up and not the one it replaced", async () => {
    // The old write-up in the context is what makes the narrative describe two
    // visits over one set of photos.
    const res = await generate();
    expect(res.summaryCount).toBe(1);
    expect(writeUps(DB.prompt)).toHaveLength(1);
    expect(DB.prompt).toContain("Updated draft.");
    expect(DB.prompt).not.toContain("Old draft.");
  });

  it("keeps both drafts off the page", async () => {
    await generate();
    const html: string = DB.inserted.content_html;
    expect(html).not.toContain("Walkthrough Summaries");
    expect(html).not.toContain("Updated draft.");
    expect(html).not.toContain("Old draft.");
  });

  it("still carries both when neither selection contains the other", async () => {
    // A brief over the condenser and a brief over the attic share a photo and
    // are still two write-ups. Only containment supersedes.
    DB.summaries[0].photo_notes = [{ photoId: "p2" }, { photoId: "p3" }];
    const res = await generate();
    expect(res.summaryCount).toBe(2);
    expect(writeUps(DB.prompt)).toHaveLength(2);
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
    const ups = writeUps(DB.prompt);
    expect(ups).toHaveLength(2);
    // Oldest first: the drafter reads the job forward.
    expect(ups[0]).toContain("First visit.");
    expect(ups[1]).toContain("Second visit, current.");
    expect(DB.prompt).not.toContain("superseded");
    expect(DB.inserted.content_html).not.toContain("Second visit");
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
    expect(writeUps(DB.prompt)).toHaveLength(1);
    expect(DB.prompt).toContain("Third run");
    expect(DB.inserted.content_html).not.toContain("Third run");
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
    const ups = writeUps(DB.prompt);
    expect(ups).toHaveLength(2);
    // Word for word the same body, so the date is the only thing telling the
    // drafter it is reading two visits.
    expect(ups[0]).toContain("August 4, 2026");
    expect(ups[1]).toContain("August 5, 2026");
  });

  it("says nothing about walkthroughs on a job that has none", async () => {
    // An empty heading is a blank promise on a document handed to a client.
    await generate();
    expect(DB.inserted.content_html).not.toContain("Walkthrough Summaries");
    expect(DB.prompt).toContain("Field write-ups from the walkthroughs on this job (0)");
  });

  it("skips a summary that is still generating and has no prose yet", async () => {
    DB.summaries = [summaryRow({ id: "e1", walkthrough_id: "w1", markdown: null })];
    const res = await generate();
    expect(res.summaryCount).toBe(0);
    expect(writeUps(DB.prompt)).toHaveLength(0);
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

describe("the date each write-up carries into the prompt", () => {
  /*
   * Taking the newest row per walkthrough is what fixed the duplicate blocks,
   * and it is also what made this necessary: a summary regenerated three weeks
   * after the walk carries that later `created_at`, so dating the write-up by
   * the row tells the drafter the visit happened on the day somebody last
   * pressed Regenerate. It repeats that date into the document that is meant
   * to be the record of when the work was done, and a date in a report is one
   * a customer checks against the invoice.
   */
  it("dates the write-up by the walk, not by the regeneration", async () => {
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
    const [up] = writeUps(DB.prompt);
    expect(up).toContain("August 1, 2026");
    expect(up).not.toContain("August 22, 2026");
  });

  it("orders the write-ups by when the walks happened", async () => {
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
    const ups = writeUps(DB.prompt);
    expect(ups[0]).toContain("First visit.");
    expect(ups[1]).toContain("Second visit.");
    expect(ups[0]).toContain("August 1, 2026");
    expect(ups[1]).toContain("August 8, 2026");
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
    expect(writeUps(DB.prompt)[0]).toContain("August 6, 2026");
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

/*
 * What the Report is asked to write about.
 *
 * "The Report that is being generated keeps saying This was photo documentation
 * for a Contactor Replacement. Instead it should say, a Contactor was replaced.
 * The report keeps emphasizing this was documented that was documented (...) The
 * conclusion is too short and it should also convey what has been done."
 *
 * The model was doing as it was told. The brief asked for "the scope of the work
 * documented" and "what the photo record covers" under a section named "Work
 * Documented", and gave the Conclusion two or three sentences with no
 * instruction to say what the job achieved. These pin the corrected brief,
 * because a prompt has no type checker and nothing else here would notice it
 * being reworded back.
 */
describe("the Report's brief asks for the work, not the photographs of it", () => {
  beforeEach(async () => {
    DB.summaries = [];
    await generate();
  });

  it("bans the documentation framing outright", () => {
    for (const banned of [
      "photo documentation",
      "this documents",
      "was documented",
      "photos were taken",
      "the record shows",
    ]) {
      expect(DB.system).toContain(`'${banned}'`);
    }
    expect(DB.system).toMatch(/NEVER write/);
  });

  it("asks for the component and the action, with an example of each", () => {
    expect(DB.system).toContain("Contactor replaced");
    expect(DB.system).toContain("Control board replaced");
  });

  it("tells it that rephrasing a note is required, and inventing still is not", () => {
    // The line between the two is the whole risk of this change: "Contactor
    // Replacement" may become "the contactor was replaced", and nothing beyond
    // what a note says may be added.
    expect(DB.system).toContain("is not an inference");
    expect(DB.system).toMatch(/invent no parts, no measurements/);
  });

  it("gives it something honest to say when the notes describe no work", () => {
    // Otherwise the fallback is exactly the sentence being complained about.
    expect(DB.system).toContain("do not describe the work");
  });

  it("asks the Conclusion to say what was done, at length", () => {
    expect(DB.system).toContain("## Conclusion");
    expect(DB.system).toMatch(/4-6 full sentences restating what was completed/);
    expect(DB.system).not.toMatch(/## Conclusion\\n<2-3/);
  });

  it("names the middle section for the work rather than the documenting", () => {
    expect(DB.system).toContain("## Work Performed");
    expect(DB.system).not.toContain("Work Documented");
  });

  it("holds the line on padding now that the Conclusion is longer", () => {
    /*
     * The original brief carried "If the material is thin, be brief rather than
     * embellishing" as a rule over the whole document. Growing the Conclusion
     * from 2-3 sentences to 4-6 dropped it, which leaves a length demand with
     * nothing holding it back - on a document that must not invent work.
     */
    expect(DB.system).toMatch(/Say less rather than padding/);
    expect(DB.system).toMatch(/never from restating the same work in more words/);
  });

  it("will not let a 'before' shot be written up as work completed", () => {
    /*
     * The one way the humanised voice could make a client-facing document say
     * something untrue: "Attic unit before service" read as the service having
     * happened. The caveat sits immediately after the rule it qualifies rather
     * than in a distant section, because separated like that the two read as a
     * contradiction to be resolved instead of a rule with an exception.
     */
    expect(DB.system).toContain("records the state found on arrival, not work completed");
    expect(DB.system).toMatch(/IS that task, completed[\s\S]{0,320}The exception is a note marked/);
  });

  it("marks each note with its own phase, so that caveat has something to bind to", () => {
    /*
     * The rule above was unactionable when it was written. Phases reached the
     * prompt only as totals - "before: 1, after: 1" - while the notes were
     * listed separately and unmarked, so nothing told the model WHICH note was
     * the before shot. Found by reading the assembled prompt, not by a test.
     */
    expect(DB.prompt).toContain("[before] Attic unit before service");
    expect(DB.prompt).toContain("[after] Condenser after replacement");
  });

  it("labels the date range as work, not as documenting", () => {
    // The instructions were only half of it: a figure labelled "Documented
    // between" invites a sentence about documenting whatever the rules say.
    expect(DB.prompt).toContain("Work carried out between");
    expect(DB.prompt).not.toContain("Documented between");
  });

  it("does not print the word on the figures panel either", async () => {
    // The client reads this panel. It said "Documented".
    const html: string = DB.inserted.content_html;
    expect(html).toContain("Work period");
    expect(html).not.toMatch(/panel-label">Documented/);
  });

  it("frames the captions as the record of what was done", () => {
    // The user prompt's own labels steer this as much as the system prompt:
    // "Notes the technicians typed on site" invites a description of notes.
    expect(DB.prompt).toContain("What the technicians recorded doing on site");
  });

  it("prints the renamed section, and can still find it in the reply", () => {
    // The heading is matched by name to pull the body out of the model's
    // Markdown, so the prompt, the extraction and the emitted HTML have to
    // agree. Renaming two of the three silently drops the section.
    const html: string = DB.inserted.content_html;
    expect(html).toContain("<h2>Work Performed</h2>");
    expect(html).toContain("Contactor replaced");
    expect(html).not.toContain("Work Documented");
  });
});

describe("a summary written before the split, read into the Report", () => {
  /*
   * Pinned here because it is the pairing that broke last time: the report
   * reads `markdown` straight from the table, which skips the repair every
   * other read performs, and a legacy row carries its own `# Title` and a
   * `## Photos` gallery of refs. Those used to reach the client as literal
   * "![Photo 1](photo:76edc...)" text; they now reach the model, where a block
   * of image refs is an invitation to write about the photographs.
   */
  beforeEach(() => {
    DB.summaries = [
      summaryRow({
        id: "legacy",
        walkthrough_id: "w1",
        markdown:
          "# Summary - Aug 14, 2026\n\n## Overview\n\nWalked the crawlspace.\n\n## Photos\n\n### Photo 1\n\n![Photo 1](photo:76edc)\n",
      }),
    ];
  });

  it("carries neither the old title nor the old gallery into the prompt", async () => {
    await generate();
    const [up] = writeUps(DB.prompt);
    expect(up).toContain("Walked the crawlspace.");
    expect(up).not.toContain("photo:76edc");
    expect(up).not.toContain("Summary - Aug 14, 2026");
    // And no headings of its own: a model handed "## Overview" writes that
    // back as the shape of its answer.
    expect(up).not.toMatch(/^#/m);
    expect(up).toContain("Overview");
  });

  it("keeps its prose out of the document either way", async () => {
    await generate();
    const html: string = DB.inserted.content_html;
    expect(html).not.toContain("Walked the crawlspace.");
    expect(html).not.toContain("Summary - Aug 14, 2026");
    expect(html).not.toContain("photo:76edc");
  });
});

/*
 * A Report is written from the Summaries. It is not a stack of them.
 *
 * "Full Project Report is also listing the walkthrough summeries in series in
 * the same report. Walkthrough Summery and Full project Details are completely
 * separte things. Full project report gathers all meta data inclduing AI
 * summeries and writes a polisehd client facing docuemnt with a cover page."
 *
 * The write-ups were quoted in under a heading apiece, each with its own date,
 * which made the back half of a client-facing report a run of other documents
 * the client can already open on their own share links. Everything below is one
 * rule read two ways: the prose goes to the model, and the page gets what the
 * model wrote.
 */
describe("the Report does not reprint the Summaries", () => {
  beforeEach(() => {
    DB.walkthroughs = [{ id: "w1", started_at: "2026-08-01T08:30:00Z", created_at: null }];
    DB.summaries = [
      summaryRow({
        id: "s1",
        walkthrough_id: "w1",
        title: "First visit - Summary",
        markdown:
          "## Overview\n\nWalked the attic and the condenser pad.\n\n## Key Points\n\n- Unit runs.",
      }),
    ];
  });

  it("carries no section of quoted write-ups", async () => {
    await generate();
    const html: string = DB.inserted.content_html;
    expect(html).not.toContain("Walkthrough Summaries");
    expect(html).not.toContain("Walked the attic and the condenser pad.");
    expect(html).not.toContain("First visit - Summary");
  });

  it("hands the same prose to the drafter instead", async () => {
    await generate();
    expect(DB.prompt).toContain("Field write-ups from the walkthroughs on this job (1)");
    expect(DB.prompt).toContain("Walked the attic and the condenser pad.");
  });

  it("tells the model to fold them in rather than narrate them one by one", async () => {
    // Handed a set of finished documents with no instruction, a model narrates
    // them in order, which is the shape being removed.
    await generate();
    expect(DB.system).toContain("SOURCE MATERIAL");
    expect(DB.system).toMatch(/Never reproduce a write-up/);
    expect(DB.system).toMatch(/never give a visit a section or a heading of its own/);
    expect(DB.system).toMatch(/never tell the reader to see a summary elsewhere/);
  });

  it("leaves the visits to the prose, with no counter standing in for them", async () => {
    /*
     * A "Walkthroughs recorded" row on the figures panel was tried and taken
     * out: the only counts available here are of summary rows, capped, and
     * blind to a walk nobody summarised. What the reader gets instead is the
     * work itself, dated, in the sections the model wrote.
     */
    await generate();
    const html: string = DB.inserted.content_html;
    expect(html).not.toContain("Walkthroughs recorded");
    expect(html).toContain('<span class="panel-label">Days on site</span>');
  });

  it("draws on a write-up that has no walkthrough behind it too", async () => {
    // A summary written from a photo selection is still the only place someone
    // said what happened, whether or not a recording sits behind it.
    DB.walkthroughs = [];
    DB.summaries = [
      summaryRow({
        id: "fromPhotos",
        photo_notes: [{ photoId: "ph1" }],
        markdown: "## Overview\n\nDrafted from a photo selection.",
      }),
    ];
    await generate();
    expect(writeUps(DB.prompt)).toHaveLength(1);
    expect(DB.prompt).toContain("Drafted from a photo selection.");
    expect(DB.inserted.content_html).not.toContain("Drafted from a photo selection.");
  });
});
