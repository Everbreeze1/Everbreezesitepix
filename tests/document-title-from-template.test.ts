import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  copyDocumentTitle,
  projectDocumentTitle,
  uniqueDocumentTitle,
} from "../apps/api/src/domains/projects/page-title";
import { createPageFromTemplateInputSchema } from "../apps/api/src/domains/projects/page-templates";

/*
 * A document created from a template used to be titled `template.name` and
 * nothing else. So "HVAC Service Call Report" was the row in Templates →
 * Documents, the row in this project's Documents tab, and the row in every
 * other project's, all at once - and the one thing a title had to say, which
 * job this is, was the thing it did not. It leaves the app that way too:
 * `renderPagePdf` builds the download filename from this string, so every
 * service call ever exported arrived as `HVAC_Service_Call_Report.pdf`.
 *
 * The client: "it confusingly saves under that project under generic template
 * name and forces the user to change the name to stay organized."
 */
describe("projectDocumentTitle - a document says which job it belongs to", () => {
  it("leads with the project, then the template it came from", () => {
    expect(projectDocumentTitle("Willow Street Retrofit", "HVAC Service Call Report")).toBe(
      "Willow Street Retrofit - HVAC Service Call Report",
    );
  });

  it("is not the template's own name, which is the whole bug", () => {
    const title = projectDocumentTitle("Willow Street Retrofit", "HVAC Service Call Report");
    expect(title).not.toBe("HVAC Service Call Report");
  });

  it("keeps the template name whole - it is the half that says what this is", () => {
    expect(projectDocumentTitle("Willow Street Retrofit", "HVAC Service Call Report")).toContain(
      "HVAC Service Call Report",
    );
  });

  it("falls back to the template alone when the project has no name", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(projectDocumentTitle(empty, "Roof Inspection")).toBe("Roof Inspection");
    }
  });

  it("does not prefix a template that already opens with the project name", () => {
    // `savePageAsTemplate` defaults its name to the document's title, which has
    // been through here - so this is the ordinary round trip, not an edge case.
    expect(
      projectDocumentTitle("Willow Street Retrofit", "Willow Street Retrofit - Punch List"),
    ).toBe("Willow Street Retrofit - Punch List");
  });

  it("matches the project name case-insensitively before deciding to prefix", () => {
    expect(projectDocumentTitle("willow street", "Willow Street Punch List")).toBe(
      "Willow Street Punch List",
    );
  });

  it("never exceeds the 200 the title column and both page schemas allow", () => {
    const title = projectDocumentTitle("P".repeat(300), "T".repeat(160));
    expect(title.length).toBeLessThanOrEqual(200);
    // The project name is what gets cut, never the template name.
    expect(title.endsWith("T".repeat(160))).toBe(true);
  });

  it("drops the prefix rather than printing a stub of it", () => {
    const template = "T".repeat(198);
    expect(projectDocumentTitle("Willow Street Retrofit", template)).toBe(template);
  });

  it("still returns something for a template with no name at all", () => {
    expect(projectDocumentTitle("Willow Street", "   ")).toBe("Willow Street - Untitled document");
  });
});

/*
 * The same sheet is filled in twice on one job - a second service call, a
 * re-inspection after a fix - and two rows reading exactly alike is the same
 * confusion moved one level in.
 */
describe("uniqueDocumentTitle - two visits are not one document", () => {
  const base = "Willow Street Retrofit - HVAC Service Call Report";

  it("leaves a free name alone", () => {
    expect(uniqueDocumentTitle(base, ["Something else"])).toBe(base);
  });

  it("numbers from 2, since the first one is not '(1)'", () => {
    expect(uniqueDocumentTitle(base, [base])).toBe(`${base} (2)`);
  });

  it("keeps counting past the numbers already used", () => {
    expect(uniqueDocumentTitle(base, [base, `${base} (2)`, `${base} (3)`])).toBe(`${base} (4)`);
  });

  it("does not say '(copy)' - the second visit is not a copy of the first", () => {
    expect(uniqueDocumentTitle(base, [base])).not.toContain("copy");
  });

  it("compares the way a person would: case and stray spaces do not free a name", () => {
    expect(uniqueDocumentTitle(base, [`  ${base.toUpperCase()}  `])).toBe(`${base} (2)`);
  });

  it("stays inside 200 characters when the suffix would push it over", () => {
    const long = "T".repeat(200);
    const out = uniqueDocumentTitle(long, [long]);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith(" (2)")).toBe(true);
  });
});

/*
 * The template picker is one of four routes that create a document, and all
 * four invented their own default: `template.name` verbatim, "Daily Log -
 * 8/17/2026", "Report - 8/17/2026", "Untitled". Fixing one of them and leaving
 * the others is how the project's Documents tab ends up half organised, so
 * these cover the shapes the other routes hand in.
 */
describe("projectDocumentTitle - the generated and blank routes", () => {
  it("puts the site in front of a generated report, which is the PDF filename", () => {
    expect(projectDocumentTitle("Willow Street Retrofit", "Report - 8/17/2026")).toBe(
      "Willow Street Retrofit - Report - 8/17/2026",
    );
  });

  it("names a daily log after its job, so two sites in one morning differ", () => {
    const kind = "Daily Log - 8/17/2026";
    expect(projectDocumentTitle("Willow Street Retrofit", kind)).not.toBe(
      projectDocumentTitle("Marina Bay Fitout", kind),
    );
  });

  it("keeps the word Untitled on a blank page - it has no name and should say so", () => {
    const title = projectDocumentTitle("Willow Street Retrofit", "Untitled");
    expect(title).toBe("Willow Street Retrofit - Untitled");
    expect(title).toContain("Untitled");
  });

  it("tells two same-day daily logs apart, which the date alone cannot", () => {
    const first = projectDocumentTitle("Willow Street Retrofit", "Daily Log - 8/17/2026");
    expect(uniqueDocumentTitle(first, [first])).toBe(`${first} (2)`);
  });
});

/*
 * The backfill has to reach the same answer as the TypeScript, because the two
 * halves land in one list: a document renamed by the migration sits directly
 * above one created by `page-title.ts` the next morning, and if the separator or
 * the cap disagree the list reads as two different apps.
 *
 * There is no Postgres in this suite to execute the migration against, so these
 * check the rules it is built from rather than its output. The cap is the one
 * that bites: `updateProjectPage` refuses a title over 200, and the editor sends
 * the title with every autosave, so a 205 character title written by the
 * migration would make the next body edit on that document fail validation and
 * silently drop the user's typing.
 */
describe("the backfill migration agrees with page-title.ts", () => {
  const ROOT = resolve(__dirname, "..");
  const sql = readFileSync(
    join(ROOT, "supabase/migrations/20260907000000_project_page_titles_name_their_project.sql"),
    "utf8",
  );
  const ts = readFileSync(join(ROOT, "apps/api/src/domains/projects/page-title.ts"), "utf8");

  it("caps titles at the same 200 the page schemas do", () => {
    expect(ts).toContain("const MAX_PAGE_TITLE = 200;");
    // `200 - length(_base) - 3` is MAX_PAGE_TITLE minus the separator.
    expect(sql).toContain("200 - length(_base) - 3");
    expect(sql).toContain("length(title) > 200");
  });

  it("joins the two halves with the same separator", () => {
    expect(ts).toContain('const TITLE_SEPARATOR = " - ";');
    expect(sql).toContain("_project || ' - ' || _base");
  });

  it("gives up on a prefix at the same width", () => {
    expect(ts).toContain("const MIN_PREFIX = 8;");
    expect(sql).toContain("_room < 8");
  });

  it("numbers a clash rather than calling it a copy", () => {
    expect(sql).toContain("' (' || _n || ')'");
    // Statements only - the comments say the word "(copy)" explaining why the
    // migration does not write it, and matching those would be matching prose.
    const statements = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(statements.toLowerCase()).not.toContain("copy");
  });

  it("restores the updated_at trigger it disables", () => {
    // Left off, every document silently stops recording when it was last
    // edited. The migration raises rather than returning a database like that.
    expect(sql).toContain("DISABLE TRIGGER trg_project_pages_updated_at");
    expect(sql).toContain("ENABLE TRIGGER trg_project_pages_updated_at");
    expect(sql).toContain("Migration finished with triggers still disabled");
  });

  it("only renames a title still identical to the one the app assigned", () => {
    // The safety rule, and the reason this is not a guess about user data.
    expect(sql).toContain("btrim(p.title) = btrim(t.name)");
    expect(sql).toContain("btrim(p.title) = 'Untitled'");
    expect(sql).toContain("^(Daily Log|Summary|Report) - [0-9][0-9/.-]*$");
  });

  it("is safe to run twice - a renamed row no longer matches", () => {
    expect(sql).toContain("starts_with(lower(_base), lower(_project))");
  });
});

/*
 * A source-level check, because the failure is silent: a fifth creation route
 * added later that writes its own default puts one unnamed document back in the
 * list, and nothing goes red. There is no cheap way to run these services -
 * they are Supabase calls end to end - so this asserts the wiring instead.
 */
describe("every route that creates a document names it the same way", () => {
  const ROOT = resolve(__dirname, "..");
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  const ROUTES = [
    ["apps/api/src/domains/projects/page-templates.ts", "picked from a template"],
    ["apps/api/src/domains/projects/page-generate.ts", "generated with AI"],
    ["apps/api/src/domains/projects/pages.ts", "created blank"],
  ] as const;

  for (const [file, what] of ROUTES) {
    it(`a document ${what} is titled through projectDocumentTitle`, () => {
      const src = read(file);
      expect(src).toContain('from "./page-title"');
      expect(src).toContain("projectDocumentTitle(");
      expect(src).toContain("uniqueDocumentTitle(");
    });
  }

  it("no route falls back to the template's own name", () => {
    // The original bug, in one line: `title: template.name`.
    expect(read("apps/api/src/domains/projects/page-templates.ts")).not.toContain(
      "title: template.name",
    );
  });

  it("a duplicate keeps 'Copy of' and stays out of the project prefix", () => {
    /*
     * Exempt from `projectDocumentTitle` on purpose: it copies a document that has
     * been named already, so prefixing it again would give "Willow Street - Copy of
     * Willow Street - Punch List".
     *
     * Not exempt from the cap or the numbering, which is where it was wrong. It
     * goes through `copyDocumentTitle` now rather than interpolating the source
     * title raw.
     */
    const src = read("apps/api/src/domains/projects/pages.ts");
    expect(src).toContain("copyDocumentTitle(source.title)");
    expect(src).not.toContain("Copy of ${source.title}");
  });
});

/*
 * "Copy of " is eight characters in front of a title already allowed to be 200,
 * and `project_pages.title` is plain `text` with nothing enforcing a length. So
 * the duplicate was written happily at 208 characters and then
 * `updateProjectPageInputSchema` refused it - and the editor sends the title with
 * every autosave, so every body edit on that document failed validation and the
 * user's typing was dropped with nothing on screen to explain it.
 *
 * Duplicating a document with a long name produced a document that could never be
 * edited again.
 */
describe("copyDocumentTitle - a duplicate stays inside the limit that made it", () => {
  it("prefixes a short title untouched", () => {
    expect(copyDocumentTitle("Willow Street - Punch List")).toBe(
      "Copy of Willow Street - Punch List",
    );
  });

  it("never exceeds the 200 the editor's own rename allows", () => {
    const longest = "x".repeat(200);
    const copy = copyDocumentTitle(longest);
    expect(copy.length).toBe(200);
    expect(copy.startsWith("Copy of ")).toBe(true);
    // Cuts the source title, never the word that says what this row is.
    expect(
      createPageFromTemplateInputSchema.safeParse({
        projectId: "22222222-2222-4222-8222-222222222222",
        templateId: "33333333-3333-4333-8333-333333333333",
        title: copy,
      }).success,
    ).toBe(true);
  });

  it("does not leave a dangling space where it cut", () => {
    const copy = copyDocumentTitle(`${"y".repeat(191)} tail`);
    expect(copy.length).toBeLessThanOrEqual(200);
    expect(copy).not.toMatch(/\s$/);
  });

  it("names a copy of an untitled document rather than emitting 'Copy of '", () => {
    expect(copyDocumentTitle("")).toBe("Copy of Untitled document");
    expect(copyDocumentTitle(null)).toBe("Copy of Untitled document");
    expect(copyDocumentTitle("   ")).toBe("Copy of Untitled document");
  });

  it("numbers a second duplicate instead of repeating itself", () => {
    // Two rows both reading "Copy of X" is the confusion the whole rule is about,
    // one level in.
    const first = copyDocumentTitle("Punch List");
    expect(uniqueDocumentTitle(first, ["Punch List", first])).toBe("Copy of Punch List (2)");
  });

  it("still fits after the number is appended to a maximum-length copy", () => {
    const copy = copyDocumentTitle("x".repeat(200));
    const numbered = uniqueDocumentTitle(copy, [copy]);
    expect(numbered.length).toBeLessThanOrEqual(200);
    expect(numbered.endsWith(" (2)")).toBe(true);
  });
});

/*
 * The dialog sends the name the user is looking at; the blueprint apply sends
 * nothing and lets the server decide. Both have to be accepted, and an empty
 * string has to be refused the same way `updateProjectPage` refuses it - the
 * dialog sends `undefined` for a cleared box rather than "".
 */
describe("createPageFromTemplate title input", () => {
  const ids = {
    projectId: "22222222-2222-4222-8222-222222222222",
    templateId: "33333333-3333-4333-8333-333333333333",
  };

  it("accepts an omitted title, which is how a blueprint apply arrives", () => {
    const res = createPageFromTemplateInputSchema.safeParse(ids);
    expect(res.success).toBe(true);
    expect(res.success && res.data.title).toBeUndefined();
  });

  it("trims a name the user typed rather than storing their stray spaces", () => {
    const res = createPageFromTemplateInputSchema.safeParse({
      ...ids,
      title: "  Willow Street - Service Call  ",
    });
    expect(res.success && res.data.title).toBe("Willow Street - Service Call");
  });

  it("refuses a blank title", () => {
    expect(createPageFromTemplateInputSchema.safeParse({ ...ids, title: "" }).success).toBe(false);
    expect(createPageFromTemplateInputSchema.safeParse({ ...ids, title: "   " }).success).toBe(
      false,
    );
  });

  it("refuses a title the editor's own rename would then refuse", () => {
    expect(
      createPageFromTemplateInputSchema.safeParse({ ...ids, title: "x".repeat(201) }).success,
    ).toBe(false);
  });
});
