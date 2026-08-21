import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const TEMPLATES = "apps/web/src/features/settings/pages/TemplatesPage.tsx";

/*
 * Walkthroughs parked in the Templates hub.
 *
 * "Lets Hide Walkthroughs from Templates Tab for now... at this point its
 * redundant because WT is very improvised... we will revisit that template
 * later."
 *
 * The asks in that sentence are two: hidden now, and cheap to bring back. So
 * these check both - that the entry points are gated, and that nothing about
 * the feature was actually removed.
 */
describe("SHOW_WALKTHROUGH_TEMPLATES", () => {
  const src = () => read(TEMPLATES);

  it("is off", () => {
    expect(src()).toContain("export const SHOW_WALKTHROUGH_TEMPLATES = false;");
  });

  it("gates the Templates tab strip", () => {
    // The tab is added only when the flag is on, rather than always-present.
    expect(src()).toMatch(/SHOW_WALKTHROUGH_TEMPLATES[\s\S]{0,120}key: "walkthroughs"/);
  });

  it("gates the blueprint Add-section menu", () => {
    // A blueprint must not become a second door to the parked templates.
    expect(src()).toMatch(/SHOW_WALKTHROUGH_TEMPLATES \|\| k !== "walkthrough"/);
  });

  it("redirects a deep link to the hidden tab instead of rendering a stranded panel", () => {
    const s = src();
    expect(s).toContain('requestedTab === "walkthroughs"');
    // The key stays legal so an old link still validates rather than 404s.
    expect(s).toContain('"walkthroughs",');
  });

  it("does not claim walkthroughs is one of the tabs in the empty state", () => {
    // The get-started copy listed the tabs by name; leaving walkthroughs in it
    // would point at a tab that is no longer there.
    const s = src();
    const body =
      /body: "Checklists, workflows[^"]*each on its own tab above[^"]*"/.exec(s)?.[0] ?? "";
    expect(body).not.toContain("walkthroughs");
  });

  it("removes nothing, so re-enabling is one line", () => {
    const s = src();
    // The panel, the library, and the blueprint section kind all stay.
    expect(s).toContain("<WalkthroughTemplatesManager");
    expect(s).toContain('case "walkthrough":');
    // The recording feature - a different thing entirely - is untouched.
    expect(read("apps/web/src/features/projects/pages/ProjectDetailPage.tsx")).toContain(
      'key: "walkthroughs"',
    );
  });
});
