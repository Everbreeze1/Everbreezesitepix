import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * The title page, on the report that is meant to be handed over.
 *
 * "The project full report with the title page has disappeared. It's generating
 * the old version of summery."
 *
 * The Full Project Report opened on `<div data-panel="meta">` - a stack of
 * field labels, which is how an internal tally opens - while the other report
 * the product makes has had a cover since it was written. Two documents both
 * called a Report, one of them arriving with no title page, is the first thing
 * a customer notices.
 *
 * The cover is one exported builder now, so this drives the real service and
 * reads what actually lands in `project_pages.content_html`. A unit test on
 * `coverPageHtml` alone would have passed the whole time it was going unused.
 */

const DB = {
  pages: [] as Array<{ title: string }>,
  /** What the service inserted, which is the document under test. */
  inserted: null as any,
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
    caption: "Contactor replaced",
    phase: "after",
    tags: ["attic"],
    taken_at: "2026-08-01T09:00:00Z",
    created_at: "2026-08-01T09:00:00Z",
  },
];

/** Just enough of a PostgREST query builder to run one service. */
function fakeSupabase() {
  const builder = (table: string) => {
    const state = { table, insert: null as any };
    const result = () => {
      if (state.insert) return { data: { ...state.insert, id: "page1" }, error: null };
      switch (state.table) {
        case "projects":
          return { data: project, error: null };
        case "photos":
          return { data: photos, error: null };
        case "photo_tags":
        case "walkthrough_summaries":
        case "walkthroughs":
          return { data: [], error: null };
        case "project_pages":
          return { data: DB.pages, error: null };
        case "profiles":
          return { data: { full_name: "Mike", report_photos_per_page: 2 }, error: null };
        default:
          return { data: [], error: null };
      }
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (payload: any) => {
        state.insert = payload;
        DB.inserted = payload;
        return chain;
      },
      maybeSingle: async () => result(),
      single: async () => result(),
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    return chain;
  };
  return { from: (table: string) => builder(table) };
}

vi.mock("../apps/api/src/domains/ai/service", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  chatComplete: async () =>
    "## Executive Summary\n\nThe contactor was replaced.\n\n## Work Performed\n\n- Contactor replaced\n\n## Conclusion\n\nThe contactor was replaced and the unit was returned to service.",
}));

const { generateComprehensiveReportService } =
  await import("../apps/api/src/domains/projects/comprehensive-report");
const { coverPageHtml } = await import("../apps/api/src/domains/projects/page-generate");

async function generate() {
  const ctx = { supabase: fakeSupabase(), userId: "u1" } as any;
  return await generateComprehensiveReportService(ctx, { projectId: "p1" });
}

/** Everything before the first body panel, which is the cover and nothing else. */
function cover(html: string): string {
  return html.split('<div data-panel="meta">')[0];
}

beforeEach(() => {
  DB.pages = [];
  DB.inserted = null;
});

describe("the Full Project Report's title page", () => {
  it("opens the document, ahead of the client panel", async () => {
    await generate();
    const html: string = DB.inserted.content_html;
    expect(html.indexOf("<hr>")).toBe(0);
    expect(html.indexOf("<hr>")).toBeLessThan(html.indexOf('<div data-panel="meta">'));
  });

  it("carries the site, the address and who prepared it", async () => {
    await generate();
    const page = cover(DB.inserted.content_html);
    expect(page).toContain("194 Daniels Drive");
    expect(page).toContain("Auburn, CA");
    expect(page).toContain("Prepared by Mike");
  });

  it("names which report it is, so the two covers are not the same page", async () => {
    await generate();
    expect(cover(DB.inserted.content_html)).toContain("Full Project Report");
  });

  it("pushes the body onto page two, the way the seeded templates do", async () => {
    // An empty paragraph with a height is deliberate blank space that the PDF
    // renderer honours (apps/web/src/lib/tiptap-spacer.ts). Without it the
    // cover and the client panel print on one page and neither reads as a
    // title page.
    await generate();
    expect(cover(DB.inserted.content_html)).toContain('<p style="height: 420px"></p>');
  });

  it("is the same builder the photo-picked report uses", async () => {
    await generate();
    const built = coverPageHtml({
      title: "anything",
      projectName: "194 Daniels Drive",
      address: "194 Daniels Drive, Auburn, CA, 95603",
      today: new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      author: "Mike",
      subtitle: "Full Project Report",
    });
    expect(DB.inserted.content_html.startsWith(built)).toBe(true);
  });

  it("does not restate itself in the panel underneath", async () => {
    /*
     * The panel used to open the document, so it carried project, location,
     * prepared-by and issued-on. The cover says all four a few centimetres
     * higher now, and a title page followed immediately by the same four
     * values reads as a header somebody forgot to delete.
     */
    await generate();
    const body: string = DB.inserted.content_html.slice(
      DB.inserted.content_html.indexOf('<div data-panel="meta">'),
    );
    for (const gone of [
      "Project</span>",
      "Location</span>",
      "Prepared by</span>",
      "Issued</span>",
    ]) {
      expect(body, `${gone} is on the cover already`).not.toContain(gone);
    }
  });

  it("keeps the client info a cover page has nowhere to put", async () => {
    // "include client info" is what makes this the document somebody hands
    // over. Dropping the rows the cover repeats must not take these with them.
    await generate();
    const html: string = DB.inserted.content_html;
    expect(html).toContain("Mrs Daniels");
    expect(html).toContain("(555) 010-2030");
    expect(html).toContain("JOB-4471");
  });

  it("still files as a Report, with its client info, its narrative and its photos", async () => {
    const res = await generate();
    const html: string = DB.inserted.content_html;
    expect(DB.inserted.source_template).toBe("report");
    expect(html).toContain("Mrs Daniels");
    expect(html).toContain("JOB-4471");
    expect(html).toContain("<h2>Executive Summary</h2>");
    expect(html).toContain("<h2>Work Performed</h2>");
    expect(html).toContain("<h2>Conclusion</h2>");
    expect(html).toContain('data-photo-id="ph1"');
    expect(res.photoCount).toBe(1);
  });
});

describe("coverPageHtml", () => {
  it("leaves out the subtitle line when there is none", () => {
    const html = coverPageHtml({
      title: "Report",
      projectName: "194 Daniels Drive",
      address: "",
      today: "1 August 2026",
      author: "",
    });
    expect(html).not.toContain("font-size: 16px");
    expect(html).not.toContain("Prepared by");
  });

  it("escapes what it is given, so a project name cannot close the tag it sits in", () => {
    const html = coverPageHtml({
      title: "Report",
      projectName: "</h1><script>alert(1)</script>",
      address: "",
      today: "",
      author: "",
      subtitle: "Full Project Report",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
