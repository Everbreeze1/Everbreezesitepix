import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildTaskReportSection,
  buildTaskReportSections,
  taskReportProgress,
  type TaskForReport,
  type TaskPhotoStateForReport,
} from "../packages/shared/src/index";

/*
 * The per-photo notes answered "what was done" inside the app, but a report is
 * what reaches the customer, and reports carried no tasks at all - so the
 * record of the work stopped at the office.
 *
 * A section is `{ title, body, photos: [{ photo_id, caption }] }`, which
 * already says everything a task needs to: the task is the title, its standing
 * is the body, and the per-photo note is the caption printed under the picture
 * it was written about. These pin that mapping, and the escaping, because both
 * are the kind of thing that silently degrades into a broken page.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * The banned character, built rather than typed.
 *
 * Matching one is the documented exception to the repo rule; writing one into
 * a tracked file is not, and tests/no-em-dash.test.ts reads this file like any
 * other.
 */
const EM_DASH = String.fromCharCode(0x2014);

const task = (over: Partial<TaskForReport> = {}): TaskForReport => ({
  id: "t1",
  title: "Replace condenser fittings",
  description: null,
  status: "in_progress",
  photo_ids: ["p1", "p2", "p3"],
  ...over,
});

const state = (
  photo_id: string,
  status: "open" | "done",
  note?: string | null,
): TaskPhotoStateForReport => ({ photo_id, status, note: note ?? null });

describe("a task's photos, captioned with what was done", () => {
  it("prints the note under the photo it was written about", () => {
    const section = buildTaskReportSection(task(), [
      state("p1", "done", "Resealed the flashing"),
      state("p2", "done", "Replaced the fitting"),
      state("p3", "open"),
    ]);
    expect(section?.photos).toEqual([
      { photo_id: "p1", caption: "Resealed the flashing" },
      { photo_id: "p2", caption: "Replaced the fitting" },
      { photo_id: "p3", caption: "Outstanding" },
    ]);
  });

  it("falls back to a word rather than an empty caption", () => {
    // A finished photo with no note still has to read as finished, or the page
    // shows a picture with nothing said about it.
    const section = buildTaskReportSection(task(), [
      state("p1", "done"),
      state("p2", "done", "  "),
    ]);
    expect(section?.photos[0].caption).toBe("Completed");
    expect(section?.photos[1].caption).toBe("Completed");
  });

  it("puts finished photos first, each group in the task's own order", () => {
    const section = buildTaskReportSection(task({ photo_ids: ["p1", "p2", "p3", "p4"] }), [
      state("p2", "done", "b"),
      state("p4", "done", "d"),
    ]);
    expect(section?.photos.map((p) => p.photo_id)).toEqual(["p2", "p4", "p1", "p3"]);
  });

  it("can leave the outstanding photos out", () => {
    const section = buildTaskReportSection(task(), [state("p1", "done", "done it")], {
      doneOnly: true,
    });
    expect(section?.photos.map((p) => p.photo_id)).toEqual(["p1"]);
  });

  it("returns nothing rather than a heading with no evidence under it", () => {
    // A task carrying no photos, and a done-only build of a task with nothing
    // finished, both have nothing to show.
    expect(buildTaskReportSection(task({ photo_ids: [] }), [])).toBeNull();
    expect(buildTaskReportSection(task(), [], { doneOnly: true })).toBeNull();
  });
});

describe("the body states where the work stands", () => {
  const body = (states: TaskPhotoStateForReport[], over?: Partial<TaskForReport>) =>
    buildTaskReportSection(task(over), states)?.body ?? "";

  it("says completed when every photo is signed off", () => {
    expect(body([state("p1", "done"), state("p2", "done"), state("p3", "done")])).toContain(
      "<strong>Completed.</strong> All 3 photos signed off.",
    );
  });

  it("says how much is left in the middle of a job", () => {
    expect(body([state("p1", "done")])).toContain(
      "<strong>In progress.</strong> 1 of 3 photos done, 2 still outstanding.",
    );
  });

  it("says not started when nothing is ticked", () => {
    expect(body([])).toContain("<strong>Not started.</strong> 3 photos outstanding.");
  });

  it("counts one photo in the singular", () => {
    expect(body([], { photo_ids: ["p1"] })).toContain("1 photo outstanding");
  });

  it("carries the task's own description through", () => {
    expect(body([], { description: "SW corner, above the meter" })).toContain(
      "<p>SW corner, above the meter</p>",
    );
  });
});

describe("user text going into a page", () => {
  it("escapes a title that would otherwise close the tag it sits in", () => {
    const section = buildTaskReportSection(
      task({ title: "Fix <the> gutter & downpipe" }),
      [state("p1", "done", '5 < 6 & "rising"')],
      { doneOnly: true },
    );
    expect(section?.title).toBe("Fix &lt;the&gt; gutter &amp; downpipe");
    // Captions are text, not markup: the renderer that prints them escapes
    // them, so what matters here is that the note survives intact.
    expect(section?.photos[0].caption).toBe('5 < 6 & "rising"');
  });

  it("escapes a description before it reaches the body html", () => {
    const section = buildTaskReportSection(task({ description: "<script>x</script>" }), []);
    expect(section?.body).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(section?.body).not.toContain("<script>");
  });

  it("folds a machine dash out of copied-in text", () => {
    // The repo-wide rule: generated text never carries one, and a note pasted
    // from a phone keyboard is exactly where one arrives.
    const section = buildTaskReportSection(
      task({ title: `Gutter ${EM_DASH} SW corner` }),
      [state("p1", "done", `Resealed ${EM_DASH} twice`)],
      { doneOnly: true },
    );
    expect(section?.title).not.toContain(EM_DASH);
    expect(section?.photos[0].caption).not.toContain(EM_DASH);
  });
});

describe("counting", () => {
  it("counts a photo listed twice once", () => {
    // Same rule as the app and the SQL rollup: photo_ids has no uniqueness
    // behind it, and a photo listed twice is still one photo.
    const t = task({ photo_ids: ["p1", "p1", "p2"] });
    expect(taskReportProgress(t, [state("p1", "done"), state("p2", "done")])).toEqual({
      total: 2,
      done: 2,
      remaining: 0,
    });
    expect(buildTaskReportSection(t, [state("p1", "done")])?.photos.map((p) => p.photo_id)).toEqual(
      ["p1", "p2"],
    );
  });
});

describe("building several at once", () => {
  it("keeps the order given and drops the ones with nothing to show", () => {
    const states = new Map<string, TaskPhotoStateForReport[]>([
      ["t1", [state("p1", "done", "first")]],
      ["t3", [state("p9", "done", "third")]],
    ]);
    const sections = buildTaskReportSections(
      [
        task({ id: "t1", title: "One" }),
        task({ id: "t2", title: "Two", photo_ids: [] }),
        task({ id: "t3", title: "Three", photo_ids: ["p9"] }),
      ],
      states,
    );
    expect(sections.map((s) => s.title)).toEqual(["One", "Three"]);
  });

  it("treats a task with no recorded state as not started, not as absent", () => {
    const sections = buildTaskReportSections([task()], new Map());
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain("Not started");
  });
});

describe("the wiring into the report builder", () => {
  const page = read("apps/web/src/features/projects/pages/ReportBuilderPage.tsx");
  const dialog = read("apps/web/src/features/projects/components/AddTasksToReportDialog.tsx");

  it("offers the action next to Add section", () => {
    expect(page).toContain("Add work from tasks");
    expect(page).toContain("AddTasksToReportDialog");
  });

  it("continues positions from the highest in use", () => {
    /*
     * deleteSection leaves gaps and never renumbers, so counting the survivors
     * would reuse a position an existing section still holds and the two would
     * sort arbitrarily in the builder and in the export. `addSection` already
     * learned this; the batch insert has to know it too.
     */
    const fn = page.slice(page.indexOf("async function addTaskSections"));
    expect(fn).toContain("Math.max(max, s.position)");
    expect(fn).not.toMatch(/position:\s*sections\.length/);
  });

  it("only offers tasks that carry photos", () => {
    expect(dialog).toContain("(t.photo_ids?.length ?? 0) > 0");
  });

  it("includes outstanding photos by default", () => {
    // "what needs to get done" is half of what was asked for; a report that
    // prints only the finished half is a sales brochure.
    expect(dialog).toContain("useState(true)");
    expect(dialog).toContain("Include photos still outstanding");
  });
});
