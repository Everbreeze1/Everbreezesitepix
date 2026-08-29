import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The mobile client must read the field names the services actually send.
 *
 * This is the most repeated mistake in the mobile port, and it fails in the
 * quietest possible way: `result?.itemCount` on a response carrying
 * `item_count` is `undefined`, not an error. Nothing throws, nothing logs,
 * TypeScript is satisfied because the declared shape is a guess and the guess
 * type-checks against itself. The screen simply shows zero, or an empty
 * placeholder, or reports that nothing came back.
 *
 * Four of these shipped before anybody looked at a device:
 *
 *   listShowcases        item_count / cover_image_url, read as itemCount / coverUrl
 *   listProjectGroups    project_count / thumbnails,   read as projectIds / photoUrls
 *   getProjectPage       { page, tokens },             read as the row itself
 *   createProjectPage    { page },                     read as { id }
 *   summarizePhotosReport { markdown },                read as { summary } or { text }
 *   setWalkthroughShare  { token },                    read as { shareToken }
 *
 * Each assertion below reads BOTH sides: the service source for what it returns,
 * and the mobile source for what it reads. Either drifting fails the test, which
 * is the point - the client cannot be checked against a copy of the contract,
 * only against the contract.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/**
 * Source with comments removed.
 *
 * Needed because the modules that were fixed explain the old field names in a
 * comment, which is worth keeping and must not read as a regression.
 *
 * The lookbehind is not optional and `tests/invariants.test.ts` enforces it: an
 * unguarded `/*` opens a comment at any slash-star, including one inside a
 * string, and runs to the next star-slash deleting everything between.
 */
const code = (p: string) =>
  read(p)
    .replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** The body of one exported service function, for asserting against its returns. */
function serviceBody(file: string, fn: string): string {
  const source = read(file);
  const start = source.indexOf(`export async function ${fn}`);
  expect(start, `${fn} not found in ${file}`).toBeGreaterThan(-1);
  // To the next top-level export, which is close enough: these functions do not
  // nest another export inside themselves.
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("project pages", () => {
  const service = "apps/api/src/domains/projects/pages.ts";
  const client = () => read("apps/mobile/src/api/pages.ts");

  it("getProjectPage wraps the row in `page`, and the client unwraps it", () => {
    // Reading `result.id` here throws "Page not found" on every page that
    // exists, which is exactly what it did.
    expect(serviceBody(service, "getProjectPageService")).toMatch(/return\s*\{\s*\n?\s*page:/);
    expect(client()).toMatch(/rpc<\{\s*page\?:[^>]*>\("getProjectPage"/);
    expect(client()).toContain("result?.page");
  });

  it("createProjectPage returns `page`, not an id", () => {
    expect(serviceBody(service, "createProjectPageService")).toMatch(/return\s*\{\s*page:/);
    expect(client()).toContain("result?.page?.id");
    // The old guess. If it comes back, so does a create button that always
    // reports failure on a page it successfully created.
    expect(code("apps/mobile/src/api/pages.ts")).not.toContain("result?.pageId");
  });
});

describe("the AI report draft", () => {
  it("summarizePhotosReport returns `markdown`", () => {
    /*
     * Not `summary`, and not `text`. Reading either returned null every time,
     * so Draft always said the model had returned nothing, on a call that had
     * just cost real money against the Gemini key.
     */
    expect(
      serviceBody("apps/api/src/domains/ai/service.ts", "summarizePhotosReportService"),
    ).toMatch(/return\s*\{\s*markdown/);
    const client = read("apps/mobile/src/api/reports.ts");
    expect(client).toContain("result?.markdown");
    expect(client).not.toMatch(/result\?\.(summary|text)\b/);
  });

  it("describeSiteLogPhotos returns `notes`", () => {
    expect(
      serviceBody("apps/api/src/domains/ai/service.ts", "describeSiteLogPhotosService"),
    ).toMatch(/return\s*\{\s*notes\s*\}/);
    expect(read("apps/mobile/src/api/site-logs.ts")).toContain("result?.notes");
  });
});

describe("walkthrough sharing", () => {
  it("setWalkthroughShare returns `token`", () => {
    // `shareToken` and `share_token` were both guesses, so enabling sharing
    // appeared to succeed and produced no link at all.
    const service = readFileSync(
      join(ROOT, "apps/api/src/domains/walkthroughs/service.ts"),
      "utf8",
    );
    expect(service).toMatch(/return\s*\{\s*token\s*\}/);
    const client = code("apps/mobile/src/api/walkthroughs.ts");
    expect(client).toContain("result?.token");
    expect(client).not.toContain("result?.shareToken");
  });
});

describe("the two the device session caught", () => {
  it("listShowcases sends snake_case counts and cover urls", () => {
    /*
     * Every portfolio card read "0 photos" and drew the empty-cover
     * placeholder, however many photos the page held.
     */
    // Code only: the module explains the old names in a comment, which is
    // worth keeping and must not read as a regression.
    const view = code("apps/mobile/src/api/portfolio-view.ts");
    expect(view).toContain("item_count");
    expect(view).toContain("cover_image_url");
    expect(view).not.toMatch(/\bitemCount\b/);
    expect(view).not.toMatch(/\bcoverUrl\b/);
  });

  it("listProjectGroups sends a count and thumbnails, not ids", () => {
    // Every group read "No projects yet" and showed no covers.
    const view = code("apps/mobile/src/api/group-view.ts");
    expect(view).toContain("project_count");
    expect(view).toContain("thumbnails");
    expect(view).not.toMatch(/\bphotoUrls\b/);
  });
});

describe("the rule, stated once", () => {
  it("no mobile api module invents a camelCase alias for a snake_case column", () => {
    /*
     * A blunt sweep for the shape of the mistake rather than its instances: a
     * client reading `something?.fooBar ?? something?.foo_bar` is guessing at
     * which one the server sends, and a guess that happens to be right today is
     * still a guess.
     *
     * Scoped to the modules that talk to our own API, where the contract is
     * knowable by reading the service. A genuinely ambiguous third-party
     * response would be a fair exception; there are none in this list.
     */
    const files = [
      "apps/mobile/src/api/pages.ts",
      "apps/mobile/src/api/reports.ts",
      "apps/mobile/src/api/portfolio.ts",
      "apps/mobile/src/api/project-groups.ts",
      "apps/mobile/src/api/pipelines.ts",
      "apps/mobile/src/api/team.ts",
      "apps/mobile/src/api/notifications.ts",
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = code(file);
      // `x?.fooBar ?? x?.foo_bar` and the reverse.
      if (/\?\.\w*[a-z][A-Z]\w*\s*\?\?\s*\w+\?\.\w*_\w+/.test(source)) offenders.push(file);
      if (/\?\.\w*_\w+\s*\?\?\s*\w+\?\.\w*[a-z][A-Z]/.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
