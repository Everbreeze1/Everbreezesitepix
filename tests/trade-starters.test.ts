import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { INDUSTRIES, REPORT_STARTERS, tradeCategoryFor } from "@sitepix/shared";

/*
 * Every Templates tab has to answer the same question the same way.
 *
 * The client's point was that picking a trade should decide what you see. That
 * only holds if it holds everywhere: a company told "your templates now lead",
 * clicking through Documents, Checklists, Workflows and Reports and finding two
 * of the four unchanged, reads the feature as broken rather than partial.
 *
 * tests/checklist-starters.test.ts covers the Checklists tab in the same shape.
 * This file covers Workflows and Reports, plus the invariant that binds all of
 * them: an industry with a trade section of its own has something filed under
 * it on every tab that has a library.
 */

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const WORKFLOW_PAGE_PATH = "apps/web/src/features/settings/pages/WorkflowTemplatesPage.tsx";
const WORKFLOW_PAGE = read(WORKFLOW_PAGE_PATH);
/*
 * The starter list moved out of the page into a data module of its own, so the
 * blueprint installer could import it without pulling the builder screen and
 * every `@/` alias in it into a node test run. The page is still read above for
 * the "does this screen use the personalised rank" checks below.
 */
const WORKFLOW_STARTERS_SRC = read(
  "apps/web/src/features/settings/components/workflow-starters.ts",
);

/** The trade order every tab sorts by. */
const CATEGORY_ORDER = (() => {
  const src = read("apps/web/src/lib/template-categories.ts");
  const m = /export const CATEGORY_ORDER = \[([\s\S]*?)\]/.exec(src);
  return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
})();

/** Industries that have a trade section of their own, so a library can lead with it. */
const TRADES_WITH_A_SECTION = INDUSTRIES.map((i) => tradeCategoryFor(i.id)).filter(
  (c): c is string => !!c,
);

interface Starter {
  name: string;
  category: string | null;
  phaseCount: number;
  stepCount: number;
  signoffCount: number;
}

const WORKFLOW_STARTERS: Starter[] = (() => {
  const block = /const STARTER_WORKFLOWS:[\s\S]*?\n\];/.exec(WORKFLOW_STARTERS_SRC)?.[0] ?? "";
  return block
    .split(/\n {2}\{\n/)
    .slice(1)
    .map((chunk) => ({
      name: /name: "((?:[^"\\]|\\.)*)"/.exec(chunk)?.[1] ?? "",
      category: /\n {4}category: "([^"]+)"/.exec(chunk)?.[1] ?? null,
      // Phases are named at six-space indent inside `phases: [`; steps are the
      // only thing carrying `kind:`. Both survive whatever Prettier does to
      // line breaks, which counting `{ label: "` did not.
      phaseCount: [...chunk.matchAll(/\n {8}name: "/g)].length,
      stepCount: [...chunk.matchAll(/\bkind: "/g)].length,
      signoffCount: [...chunk.matchAll(/\brequires_signoff: true/g)].length,
    }))
    .filter((s) => s.name);
})();

describe("the workflow starter library", () => {
  it("parses (guards the scan these tests depend on)", () => {
    expect(WORKFLOW_STARTERS.length).toBeGreaterThanOrEqual(11);
    expect(CATEGORY_ORDER.length).toBeGreaterThanOrEqual(9);
    expect(TRADES_WITH_A_SECTION.length).toBeGreaterThanOrEqual(9);
    for (const s of WORKFLOW_STARTERS) {
      expect(s.phaseCount, `${s.name} parsed no phases`).toBeGreaterThan(0);
      expect(s.stepCount, `${s.name} parsed no steps`).toBeGreaterThan(0);
    }
  });

  it("files every starter under a trade the rest of the app knows", () => {
    for (const s of WORKFLOW_STARTERS) {
      expect(s.category, `${s.name} has no trade`).toBeTruthy();
      expect(CATEGORY_ORDER, `${s.name} uses unranked trade "${s.category}"`).toContain(s.category);
    }
  });

  it("gives every trade with its own section a workflow", () => {
    const covered = new Set(WORKFLOW_STARTERS.map((s) => s.category));
    for (const trade of TRADES_WITH_A_SECTION) {
      expect(covered.has(trade), `${trade} has no starter workflow`).toBe(true);
    }
  });

  it("makes every starter worth picking over a blank workflow", () => {
    // The promise is "a workflow already shaped". Two phases and four steps is
    // a blank canvas with extra clicks.
    for (const s of WORKFLOW_STARTERS) {
      expect(s.phaseCount, `${s.name} has too few phases`).toBeGreaterThanOrEqual(3);
      expect(s.stepCount, `${s.name} has too few steps`).toBeGreaterThanOrEqual(10);
      // A workflow with no gate is a checklist wearing a workflow's name - the
      // sign-off is the thing this builder has that the checklist builder does
      // not.
      expect(s.signoffCount, `${s.name} has no sign-off gate`).toBeGreaterThan(0);
    }
  });

  it("uses one name per starter", () => {
    const names = WORKFLOW_STARTERS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the report starter library", () => {
  it("files every starter under a trade the rest of the app knows", () => {
    for (const s of REPORT_STARTERS) {
      expect(CATEGORY_ORDER, `${s.id} uses unranked trade "${s.category}"`).toContain(s.category);
    }
  });

  it("gives every trade with its own section a report", () => {
    const covered = new Set(REPORT_STARTERS.map((s) => s.category));
    for (const trade of TRADES_WITH_A_SECTION) {
      expect(covered.has(trade), `${trade} has no starter report`).toBe(true);
    }
  });

  it("gives every starter sections, a unique id and a density", () => {
    const ids = REPORT_STARTERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of REPORT_STARTERS) {
      expect(s.sections.length, `${s.id} has no sections`).toBeGreaterThanOrEqual(2);
      expect(new Set(s.sections).size, `${s.id} repeats a heading`).toBe(s.sections.length);
      expect([1, 2, 3, 4], `${s.id} has an out-of-range density`).toContain(s.photosPerPage);
      expect(s.description.length, `${s.id} has no description`).toBeGreaterThan(20);
    }
  });
});

describe("every Templates tab reads the company's trade", () => {
  const SURFACES: Array<[string, string]> = [
    ["Documents", "apps/web/src/features/settings/components/DocumentTemplatesManager.tsx"],
    ["Document picker", "apps/web/src/features/projects/components/ChoosePageTemplateDialog.tsx"],
    ["Checklists", "apps/web/src/features/settings/pages/ChecklistTemplatesPage.tsx"],
    ["Workflows", WORKFLOW_PAGE_PATH],
    /*
     * The two surfaces added with the blueprint layering work. Walkthroughs is
     * a library tab like the five above it; Blueprints became one the moment
     * blueprints gained a trade of their own, and it was the last tab still
     * sorting by creation order.
     */
    ["Walkthroughs", "apps/web/src/features/settings/components/WalkthroughTemplatesManager.tsx"],
    ["Blueprints", "apps/web/src/features/settings/pages/TemplatesPage.tsx"],
    ["Report templates", "apps/web/src/features/settings/components/ReportTemplatesManager.tsx"],
    ["New report dialog", "apps/web/src/features/projects/components/NewReportDialog.tsx"],
    /*
     * The field-facing pickers, which the first pass missed.
     *
     * Settings is where templates are authored; these are where they are USED,
     * on a phone, on site, by the person the ordering was for. A trade that
     * leads in Settings and not here is the personalisation failing at the only
     * moment it was meant to pay off.
     */
    ["In-project checklists", "apps/web/src/features/projects/components/ProjectChecklists.tsx"],
    ["In-project workflows", "apps/web/src/features/projects/components/ProjectWorkflows.tsx"],
    ["Apply template dialog", "apps/web/src/features/projects/components/ApplyTemplateDialog.tsx"],
  ];

  it("sorts by the personalised rank on every surface with a library", () => {
    for (const [label, path] of SURFACES) {
      const src = read(path);
      expect(src, `${label} does not use the personalised rank`).toMatch(/makeCategoryRank\(/);
      expect(src, `${label} does not read the company profile`).toMatch(/useCompanySetup\(/);
      expect(src, `${label} defines its own trade order again`).not.toMatch(
        /const CATEGORY_ORDER = \[/,
      );
    }
  });

  it("shares one trade selector between the builders", () => {
    /*
     * Checklists, Workflows and report templates are the same control three
     * times. They each had their own copy for about ten minutes, which is
     * exactly how the trade lists drift apart.
     */
    for (const path of [
      "apps/web/src/features/settings/pages/ChecklistTemplatesPage.tsx",
      WORKFLOW_PAGE_PATH,
      "apps/web/src/features/settings/components/ReportTemplatesManager.tsx",
    ]) {
      const src = read(path);
      expect(src, `${path} does not use the shared selector`).toMatch(
        /from "@\/components\/builder\/TradeSelect"/,
      );
      expect(src, `${path} declares its own selector again`).not.toMatch(/function TradeSelect\(/);
    }
  });

  it("carries the trade onto the rows the starters create", () => {
    expect(WORKFLOW_PAGE).toMatch(
      /createTemplate\(starter\.name, starter\.description, starter\.category \?\? null\)/,
    );
    expect(WORKFLOW_PAGE, "duplicating drops the trade").toMatch(
      /createTemplate\(`\$\{t\.name\} \(copy\)`, t\.description, t\.category \?\? null\)/,
    );
  });

  it("selects the column it sorts by", () => {
    /*
     * The silent failure this exists for: a query that never asks for
     * `category` gets undefined on every row, so `makeCategoryRank` files the
     * whole list under General and the ordering looks like it simply does
     * nothing. No error, no warning - just a personalisation that quietly
     * stopped applying.
     */
    expect(WORKFLOW_PAGE).toMatch(
      /select\("id, name, description, archived, created_at, category"\)/,
    );
    expect(read("apps/web/src/features/settings/components/ReportTemplatesManager.tsx")).toMatch(
      /sections, archived, created_at, updated_at, category/,
    );
    /*
     * Only the surfaces backed by a `category` COLUMN. The document library
     * keeps its trade inside the `body` jsonb instead, read as
     * `body->>category` or handed over by the listDocumentTemplates RPC, so
     * neither document surface has a column to select and both are exempt.
     */
    for (const path of [
      "apps/web/src/features/projects/components/ProjectChecklists.tsx",
      "apps/web/src/features/projects/components/ProjectWorkflows.tsx",
      "apps/web/src/features/projects/components/ApplyTemplateDialog.tsx",
      "apps/web/src/features/settings/pages/ChecklistTemplatesPage.tsx",
    ]) {
      expect(read(path), `${path} sorts by a column it never selects`).toMatch(
        /\.select\("[^"]*\bcategory\b/,
      );
    }
  });

  it("ships the migration the columns live in", () => {
    const sql = read("supabase/migrations/20260829000000_workflow_report_template_trades.sql");
    expect(sql).toMatch(/ALTER TABLE public\.workflow_templates/);
    expect(sql).toMatch(/ALTER TABLE public\.report_templates/);
    expect([...sql.matchAll(/ADD COLUMN IF NOT EXISTS category TEXT/g)]).toHaveLength(2);
  });
});
