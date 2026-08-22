import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const TEMPLATES = "apps/web/src/features/settings/pages/TemplatesPage.tsx";
const SETTINGS = "apps/web/src/features/settings/pages/SettingsPage.tsx";

/*
 * Labels moved to Settings; Label Sets parked in the Templates hub.
 *
 * "move Labels management out of Templates into a workspace-settings area, and
 * hide Label Sets until we figured out a use for them. for now lets clean those
 * two from Blueprint Templates."
 */
describe("Labels moved to Settings", () => {
  it("has a Labels section in Settings", () => {
    const s = read(SETTINGS);
    expect(s).toContain('id: "labels"');
    expect(s).toContain("<WorkspaceLabelsSection");
  });

  it("the workspace section loads its own project usage, no Templates coupling", () => {
    const s = read("apps/web/src/features/settings/components/WorkspaceLabelsSection.tsx");
    expect(s).toContain("<LabelsManager");
    expect(s).toContain('.from("projects")');
    // The Templates-only "N templates" badge is not PASSED here (a comment may
    // still name the prop it is deliberately omitting).
    expect(s).not.toMatch(/templateUsage=/);
  });

  it("the manager treats the template count as optional", () => {
    // So the relocated home does not have to carry Templates data just to draw
    // a badge that does not belong there.
    expect(read("apps/web/src/features/settings/components/LabelsManager.tsx")).toContain(
      "templateUsage?:",
    );
  });

  it("no longer renders labels in the Templates hub", () => {
    const s = read(TEMPLATES);
    expect(s).not.toContain("<LabelsManager");
    expect(s).not.toMatch(/key: "labels", label: "Labels"/);
  });

  it("still lets a project edit its own labels", () => {
    // "I can add and edit labels per project" - untouched. The blueprint editor
    // keeps its per-template label control.
    expect(read(TEMPLATES)).toContain("onUpdateLabels");
  });
});

describe("Label Sets parked", () => {
  it("is off", () => {
    expect(read(TEMPLATES)).toContain("export const SHOW_LABEL_SETS = false;");
  });

  it("gates the tab strip and the blueprint Add-section menu", () => {
    const s = read(TEMPLATES);
    expect(s).toMatch(/SHOW_LABEL_SETS[\s\S]{0,120}key: "label-sets"/);
    expect(s).toContain('!SHOW_LABEL_SETS && k === "label_set"');
  });

  it("redirects a deep link to the parked or moved tabs", () => {
    const s = read(TEMPLATES);
    expect(s).toContain('requestedTab === "label-sets"');
    expect(s).toContain('requestedTab === "labels"');
  });

  it("keeps the manager and section kind for when it returns", () => {
    // Parked, not deleted.
    expect(read(TEMPLATES)).toContain("<LabelSetsManager");
    expect(read("apps/web/src/features/settings/components/blueprint-outcomes.ts")).toContain(
      '"label_set"',
    );
  });
});

describe("the Templates empty state", () => {
  it("names every tab it still has, and no tab it does not", () => {
    /*
     * Regression: an earlier edit deleted the body of the "Build the pieces"
     * card entirely, leaving a titled card with an empty paragraph. It passed
     * typecheck and prettier because `body` is structurally optional.
     */
    const s = read(TEMPLATES);
    const body = /title: "Build the pieces",[\s\S]{0,260}?body: "([^"]*)"/.exec(s)?.[1];
    expect(body, "the Build the pieces card must have a body").toBeTruthy();
    expect(body).toContain("Checklists");
    expect(body).toContain("reports");
    // The three that left.
    expect(body).not.toMatch(/walkthrough/i);
    expect(body).not.toMatch(/label set/i);
    expect(body).not.toMatch(/\blabels\b/i);
  });
});
