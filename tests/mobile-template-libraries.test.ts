import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReportTemplateStructure, REPORT_STARTERS } from "../packages/shared/src/index";
import { CATEGORY_ORDER as WEB_CATEGORY_ORDER } from "../apps/web/src/lib/template-categories";
import { nextCopyName as webNextCopyName } from "../apps/web/src/lib/duplicate-name";
import { BLUEPRINT_STARTERS as WEB_BLUEPRINT_STARTERS } from "../apps/web/src/features/settings/components/blueprint-starters";
import { STARTER_TEMPLATES as WEB_CHECKLIST_STARTERS } from "../apps/web/src/features/settings/components/checklist-starters";
import { STARTER_WORKFLOWS as WEB_WORKFLOW_STARTERS } from "../apps/web/src/features/settings/components/workflow-starters";
import { WALKTHROUGH_STARTERS as WEB_WALKTHROUGH_STARTERS } from "../apps/web/src/features/settings/components/walkthrough-starters";
import { SINGLETON_KINDS as WEB_SINGLETON_KINDS } from "../apps/web/src/features/settings/components/blueprint-outcomes";
import {
  CATEGORY_ORDER,
  categoryRank,
  GENERAL_CATEGORY,
  groupByTrade,
  isMissingTable,
  matchesSearch,
  nextCopyName,
  storedCategory,
  tradeOf,
  TRADE_CHOICES,
} from "../apps/mobile/src/api/template-library-view";
import {
  BLUEPRINT_STARTERS,
  CHECKLIST_STARTER_PIECES,
  WALKTHROUGH_STARTER_PIECES,
  WORKFLOW_STARTER_PIECES,
} from "../apps/mobile/src/api/blueprint-starters";
import {
  ADDABLE_KINDS,
  addableEntries,
  addRefusal,
  contentsSummary,
  filterTargets,
  installSummary,
  multiApplyHeadline,
  nextSectionPosition,
  saveErrorMessage,
  sectionRows,
  SINGLETON_KINDS,
  swapped,
  targetAddress,
  tradesInUse,
  visibleBlueprints,
  type BlueprintRow,
  type Libraries,
  type SectionLink,
} from "../apps/mobile/src/api/blueprint-library-view";
import {
  copyName,
  extractFields,
  groupDocTemplates,
  newTemplateHtml,
  normaliseFiling,
  shadowedExamples,
  withBody,
  type DocTemplateRow,
} from "../apps/mobile/src/api/document-template-view";
import {
  cleanPlaceholder,
  COVER_STYLES,
  LAYOUT_OPTIONS,
  layoutLabel,
  starterStructure,
  structureSummary,
  visibleReportTemplates,
  type ReportTemplateRow,
} from "../apps/mobile/src/api/report-template-view";
import {
  captureLabel,
  nextShotPosition,
  normaliseCapture,
  shotsFor,
  shotSummary,
  visibleWalkthroughTemplates,
  type ShotRow,
} from "../apps/mobile/src/api/walkthrough-template-view";
import { parseDoc } from "../apps/mobile/src/api/rich-doc";
import { parentHref } from "../apps/mobile/src/lib/back-fallback";

/*
 * The template libraries on the phone: blueprints, documents, report templates
 * and walkthroughs, plus creating workflow templates.
 *
 * Owner's brief: every website capability in the app. So most of what is
 * checked here is that the phone's rules are the web's rules, with the web's
 * own modules imported beside them wherever they can be.
 */

const ROOT = process.cwd();
const APP = join(ROOT, "apps/mobile/app/(app)");
const read = (p: string) => readFileSync(p, "utf8");

describe("shared library rules", () => {
  it("files templates under the web's trades, in the web's order", () => {
    expect(CATEGORY_ORDER).toEqual(WEB_CATEGORY_ORDER);
    expect(TRADE_CHOICES[0]).toBe(GENERAL_CATEGORY);
    expect(categoryRank(GENERAL_CATEGORY)).toBe(-1);
    expect(categoryRank("Electrical")).toBe(0);
    expect(categoryRank("Something new")).toBe(CATEGORY_ORDER.length);
  });

  it("treats General as the absence of a trade", () => {
    expect(tradeOf(null)).toBe(GENERAL_CATEGORY);
    expect(tradeOf("  ")).toBe(GENERAL_CATEGORY);
    expect(storedCategory(GENERAL_CATEGORY)).toBeNull();
    expect(storedCategory("HVAC")).toBe("HVAC");
  });

  it("groups by trade in rank order", () => {
    const groups = groupByTrade(
      [
        { n: "a", c: "Plumbing" },
        { n: "b", c: null },
        { n: "c", c: "Electrical" },
      ],
      (r) => r.c,
    );
    expect(groups.map((g) => g.trade)).toEqual([GENERAL_CATEGORY, "Electrical", "Plumbing"]);
  });

  it("names copies exactly as the web does", () => {
    const cases: [string, string[]][] = [
      ["Site Report", []],
      ["Site Report", ["Site Report (copy)"]],
      ["Site Report (copy)", ["Site Report (copy)", "site report (copy 2)"]],
      ["X (copy) (copy)", []],
    ];
    for (const [name, taken] of cases) {
      expect(nextCopyName(name, taken)).toBe(webNextCopyName(name, taken));
    }
  });

  it("matches search across fields and recognises a missing table", () => {
    expect(matchesSearch("", "anything")).toBe(true);
    expect(matchesSearch("hvac", "Service", "HVAC")).toBe(true);
    expect(matchesSearch("roof", "Service", null)).toBe(false);
    expect(isMissingTable("PGRST205")).toBe(true);
    expect(isMissingTable("42P01")).toBe(true);
    expect(isMissingTable("23505")).toBe(false);
  });
});

describe("blueprint starters stay in step with the web", () => {
  it("offers the same starters", () => {
    expect(BLUEPRINT_STARTERS).toEqual(WEB_BLUEPRINT_STARTERS);
  });

  it("carries a byte-identical copy of every piece a starter builds", () => {
    const byName = <T extends { name: string }>(list: readonly T[], name: string) =>
      list.find((s) => s.name === name);
    for (const piece of CHECKLIST_STARTER_PIECES) {
      expect(piece).toEqual(byName(WEB_CHECKLIST_STARTERS, piece.name));
    }
    for (const piece of WORKFLOW_STARTER_PIECES) {
      expect(piece).toEqual(byName(WEB_WORKFLOW_STARTERS, piece.name));
    }
    for (const piece of WALKTHROUGH_STARTER_PIECES) {
      expect(piece).toEqual(byName(WEB_WALKTHROUGH_STARTERS, piece.name));
    }
  });

  it("can resolve every piece a starter asks for", () => {
    const has = (list: readonly { name: string }[], name: string) =>
      list.some((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());
    for (const starter of BLUEPRINT_STARTERS) {
      for (const piece of starter.pieces) {
        if (piece.kind === "checklist")
          expect(has(CHECKLIST_STARTER_PIECES, piece.name)).toBe(true);
        if (piece.kind === "workflow") expect(has(WORKFLOW_STARTER_PIECES, piece.name)).toBe(true);
        if (piece.kind === "walkthrough")
          expect(has(WALKTHROUGH_STARTER_PIECES, piece.name)).toBe(true);
        if (piece.kind === "report") expect(has(REPORT_STARTERS, piece.name)).toBe(true);
      }
    }
  });
});

const bp = (over: Partial<BlueprintRow>): BlueprintRow => ({
  id: "b",
  name: "B",
  description: null,
  labels: [],
  archived: false,
  category: null,
  isDefault: false,
  createdAt: "2026-01-01",
  ...over,
});

const libraries: Libraries = {
  checklist: [
    { id: "c1", name: "Pre-pour" },
    { id: "c2", name: "Punch list" },
  ],
  workflow: [{ id: "w1", name: "Install job" }],
  document: [{ id: "d1", name: "Invoice" }],
  report: [{ id: "r1", name: "Site visit" }],
  walkthrough: [],
  label_set: [],
};

describe("the blueprint library", () => {
  it("sorts by trade, then the trade default, then name, and filters", () => {
    const rows = [
      bp({ id: "1", name: "Zeta", category: "Plumbing" }),
      bp({ id: "2", name: "Alpha", category: "Plumbing" }),
      bp({ id: "3", name: "Beta", category: "Plumbing", isDefault: true }),
      bp({ id: "4", name: "Own", category: null }),
      bp({ id: "5", name: "Old", archived: true }),
    ];
    const shown = visibleBlueprints(rows, { showArchived: false, search: "", trade: null });
    expect(shown.map((r) => r.name)).toEqual(["Own", "Beta", "Alpha", "Zeta"]);
    expect(
      visibleBlueprints(rows, { showArchived: true, search: "old", trade: null }).map((r) => r.id),
    ).toEqual(["5"]);
    expect(
      visibleBlueprints(rows, { showArchived: false, search: "", trade: "Plumbing" }),
    ).toHaveLength(3);
    expect(tradesInUse(rows, false)).toEqual([GENERAL_CATEGORY, "Plumbing"]);
  });

  const links: SectionLink[] = [
    { id: "i1", blueprintId: "b", kind: "workflow", refId: "w1", position: 0, legacy: false },
    { id: "i2", blueprintId: "b", kind: "document", refId: "gone", position: 3, legacy: false },
    { id: "l1", blueprintId: "b", kind: "checklist", refId: "c1", position: 0, legacy: true },
    { id: "x", blueprintId: "other", kind: "report", refId: "r1", position: 0, legacy: false },
  ];

  it("lists legacy checklist links first, and keeps a deleted template visible", () => {
    const rows = sectionRows("b", links, libraries);
    expect(rows.map((r) => r.id)).toEqual(["l1", "i1", "i2"]);
    expect(rows[2]).toMatchObject({ missing: true, name: "Deleted document template" });
    expect(contentsSummary(rows)).toBe("1 checklist, 1 workflow, 1 document");
    expect(contentsSummary([])).toBe("Empty");
  });

  it("allows one workflow, never adds twice, and positions after the highest", () => {
    const rows = sectionRows("b", links, libraries);
    expect(addRefusal("workflow", rows)).toMatch(/already has a workflow/);
    expect(addRefusal("checklist", rows)).toBeNull();
    expect(addableEntries("checklist", libraries, rows).map((e) => e.id)).toEqual(["c2"]);
    expect(nextSectionPosition(rows)).toBe(4);
    expect([...SINGLETON_KINDS]).toEqual([...WEB_SINGLETON_KINDS]);
  });

  it("offers only the kinds the web's Add section menu offers", () => {
    const page = read(join(ROOT, "apps/web/src/features/settings/pages/TemplatesPage.tsx"));
    const walkthroughs = /SHOW_WALKTHROUGH_TEMPLATES = true/.test(page);
    const labelSets = /SHOW_LABEL_SETS = true/.test(page);
    expect(ADDABLE_KINDS.includes("walkthrough")).toBe(walkthroughs);
    expect(ADDABLE_KINDS.includes("label_set")).toBe(labelSets);
  });

  it("explains a second trade default rather than failing blankly", () => {
    expect(saveErrorMessage("23505", "duplicate key", "HVAC")).toMatch(
      /already the default for HVAC/,
    );
    expect(saveErrorMessage("42501", "denied", "HVAC")).toBe("denied");
  });

  it("swaps neighbours and refuses a move off the end", () => {
    const list = ["a", "b", "c"];
    expect(swapped(list, 0, 1)).toEqual(["b", "a", "c"]);
    expect(swapped(list, 0, -1)).toBe(list);
  });

  it("reports a partial starter install in full", () => {
    const summary = installSummary("Bathroom Remodel", 5, {
      blueprintId: "b",
      attached: 4,
      skipped: [{ kind: "document", name: "Change Order Log", reason: "Missing." }],
      created: [{ kind: "checklist", name: "Punch List Walk" }],
    });
    expect(summary.title).toBe('"Bathroom Remodel" added with 4 of 5 sections');
    expect(summary.lines).toEqual([
      "Also added 1 piece to your libraries.",
      "Change Order Log: Missing.",
    ]);
  });

  it("never says applied when nothing was", () => {
    const ok = { projectId: "p", projectName: "Oak St", counts: {}, failed: [] };
    expect(multiApplyHeadline([ok])).toBe("Applied to Oak St.");
    expect(multiApplyHeadline([{ ...ok, error: "no" }])).toMatch(/Nothing was created/);
    expect(multiApplyHeadline([ok, { ...ok, error: "no" }])).toBe("Applied to 1 of 2 projects.");
    expect(multiApplyHeadline([{ ...ok, failed: [{ kind: "report", reason: "x" }] }])).toMatch(
      /some items/,
    );
  });

  it("finds projects by name or address", () => {
    const targets = [
      { id: "1", name: "Oak St", street: "1 Oak St", city: "Leeds" },
      { id: "2", name: "Elm", street: null, city: "York" },
    ];
    expect(filterTargets(targets, "york").map((t) => t.id)).toEqual(["2"]);
    expect(targetAddress(targets[0])).toBe("1 Oak St, Leeds");
    expect(targetAddress({ ...targets[1], city: null })).toBeNull();
  });
});

const doc = (over: Partial<DocTemplateRow>): DocTemplateRow => ({
  id: "d",
  teamId: "t",
  name: "Doc",
  description: null,
  category: null,
  filesUnder: "report",
  copiedFrom: null,
  fields: [],
  archived: false,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("document templates", () => {
  it("hides a built-in behind the company's live version of it", () => {
    const rows = [
      doc({ id: "ex", teamId: null, name: "HVAC Report", category: "HVAC" }),
      doc({ id: "own", name: "HVAC Report", category: "HVAC", copiedFrom: "ex" }),
      doc({ id: "ex2", teamId: null, name: "Invoice", category: "HVAC" }),
    ];
    expect([...shadowedExamples(rows)]).toEqual(["ex"]);
    const groups = groupDocTemplates(rows, { showArchived: false, search: "" });
    expect(groups).toHaveLength(1);
    // The team's own first within a trade, then the built-ins.
    expect(groups[0].rows.map((r) => r.id)).toEqual(["own", "ex2"]);

    // Archiving the company's version brings the example back.
    const archived = rows.map((r) => (r.id === "own" ? { ...r, archived: true } : r));
    expect(shadowedExamples(archived).size).toBe(0);
  });

  it("stores the fields the body uses, as the web does", () => {
    expect(extractFields("{{ Project_Name }} and {{date}} and {{date}}")).toEqual([
      "date",
      "project_name",
    ]);
  });

  it("starts a new template the phone can edit in full", () => {
    const html = newTemplateHtml("Site <visit>", "For clients");
    expect(html.startsWith("<h1>Site &lt;visit&gt;</h1><p>For clients</p>")).toBe(true);
    expect(parseDoc(html).every((b) => b.kind !== "raw")).toBe(true);
    expect(extractFields(html)).toEqual(["project_name", "report_date"]);
  });

  it("keeps body keys it does not know about, and drops General", () => {
    const raw = { style: "letter", html: "<p>x</p>", category: "HVAC", custom: 1 };
    expect(withBody(raw, { html: "<p>y</p>" })).toEqual({ ...raw, html: "<p>y</p>" });
    expect(withBody(raw, { category: null })).not.toHaveProperty("category");
    expect(withBody(raw, { filesUnder: "invoice" }).filesUnder).toBe("invoice");
    expect(normaliseFiling("nonsense")).toBe("report");
  });

  it("keeps a built-in's name for its copy when free, and numbers a second template", () => {
    expect(copyName(doc({ teamId: null, name: "Invoice" }), [])).toBe("Invoice");
    expect(copyName(doc({ teamId: null, name: "Invoice" }), ["Invoice"])).toBe("Invoice (copy)");
    expect(copyName(doc({ name: "Invoice" }), [])).toBe("Invoice (copy)");
  });
});

describe("report templates", () => {
  it("writes today's shape, which the shared reader reads back unchanged", () => {
    const structure = starterStructure();
    expect(parseReportTemplateStructure(structure)).toEqual(structure);
    expect(structure.items.map((s) => s.heading)).toEqual([
      "Executive summary",
      "Observations",
      "Photos",
      "Next steps",
    ]);
    expect(new Set(structure.items.map((s) => s.id)).size).toBe(4);
    expect(structureSummary(structure)).toBe("4 sections, centered cover");
  });

  it("offers every cover and layout the shared structure accepts", () => {
    expect(COVER_STYLES.map((c) => c.id)).toEqual(["minimal", "centered", "hero", "photo"]);
    expect(LAYOUT_OPTIONS.map((l) => l.id)).toEqual([
      "text",
      "text-photos",
      "photo-grid",
      "checklist",
    ]);
    expect(layoutLabel("photo-grid")).toBe("Photo grid");
  });

  it("cleans a typed placeholder the web's way", () => {
    expect(cleanPlaceholder(" client ref ", [])).toBe("client_ref");
    expect(cleanPlaceholder("date", ["date"])).toBeNull();
    expect(cleanPlaceholder("   ", [])).toBeNull();
  });

  it("orders by trade then age, and hides archived", () => {
    const row = (over: Partial<ReportTemplateRow>): ReportTemplateRow => ({
      id: "r",
      teamId: null,
      name: "R",
      subtitle: null,
      sections: [],
      archived: false,
      category: null,
      createdAt: "2026-01-01",
      ...over,
    });
    const rows = [
      row({ id: "a", category: "HVAC", createdAt: "2026-01-02" }),
      row({ id: "b", category: null, createdAt: "2026-01-03" }),
      row({ id: "c", category: "HVAC", createdAt: "2026-01-01" }),
      row({ id: "d", archived: true }),
    ];
    expect(visibleReportTemplates(rows, false).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(visibleReportTemplates(rows, true)).toHaveLength(4);
  });
});

describe("walkthrough templates", () => {
  const shot = (over: Partial<ShotRow>): ShotRow => ({
    id: "s",
    templateId: "t",
    position: 0,
    label: "Shot",
    description: null,
    capture: "photo",
    required: false,
    ...over,
  });

  it("orders shots and positions a new one after the highest", () => {
    const shots = [
      shot({ id: "b", position: 5 }),
      shot({ id: "a", position: 1, required: true }),
      shot({ id: "x", templateId: "other", position: 9 }),
    ];
    const mine = shotsFor(shots, "t");
    expect(mine.map((s) => s.id)).toEqual(["a", "b"]);
    expect(nextShotPosition(mine)).toBe(6);
    expect(nextShotPosition([])).toBe(0);
    expect(shotSummary(mine)).toBe("2 shots, 1 required");
    expect(shotSummary([])).toBe("No shots yet");
  });

  it("reads an unknown capture as a photo", () => {
    expect(normaliseCapture("video")).toBe("video");
    expect(normaliseCapture("gif")).toBe("photo");
    expect(captureLabel("note")).toBe("Note");
  });

  it("filters and sorts by trade then name", () => {
    const t = (id: string, name: string, category: string | null, archived = false) => ({
      id,
      name,
      description: null,
      category,
      archived,
      createdAt: "",
    });
    const rows = [
      t("1", "Roof", "Roofing & Exterior"),
      t("2", "Leak", "Plumbing"),
      t("3", "Old", null, true),
    ];
    expect(
      visibleWalkthroughTemplates(rows, { showArchived: false, search: "" }).map((r) => r.id),
    ).toEqual(["2", "1"]);
    expect(
      visibleWalkthroughTemplates(rows, { showArchived: true, search: "old" }).map((r) => r.id),
    ).toEqual(["3"]);
  });
});

describe("the screens are wired", () => {
  const layout = read(join(APP, "_layout.tsx"));
  const screens: [string, string][] = [
    ["blueprints.tsx", "New blueprint"],
    ["document-templates.tsx", "New document template"],
    ["report-templates.tsx", "New report template"],
    ["walkthrough-templates.tsx", "New walkthrough template"],
  ];

  it("no longer sends anyone to the web for a template", () => {
    const s = read(join(APP, "templates.tsx"));
    expect(s).not.toContain("Edit on the web");
    expect(s).not.toContain("webAppLink");
    for (const href of [
      "/blueprints",
      "/document-templates",
      "/report-templates",
      "/walkthrough-templates",
    ]) {
      expect(s).toContain(`"${href}"`);
    }
  });

  for (const [file, label] of screens) {
    it(`${file} creates from the header and is registered with a way back`, () => {
      const s = read(join(APP, file)).replace(/\s+/g, " ");
      expect(s).toContain("headerRight");
      expect(s).toContain(`accessibilityLabel="${label}"`);
      const route = file.replace(/\.tsx$/, "");
      expect(layout).toContain(`name="${route}"`);
      expect(parentHref(route)).toBe("/templates");
    });
  }

  it("sends each template back to its own library", () => {
    expect(parentHref("blueprint/[id]", { id: "x" })).toBe("/blueprints");
    expect(parentHref("document-template/[id]", { id: "x" })).toBe("/document-templates");
    expect(parentHref("report-template/[id]", { id: "x" })).toBe("/report-templates");
    expect(parentHref("walkthrough-template/[id]", { id: "x" })).toBe("/walkthrough-templates");
  });

  it("asks before every delete", () => {
    for (const file of [
      "blueprint/[id].tsx",
      "document-template/[id].tsx",
      "report-template/[id].tsx",
      "walkthrough-template/[id].tsx",
      "templates.tsx",
    ]) {
      const s = read(join(APP, file));
      expect(s, file).toContain("confirmDelete(");
      // Every delete call sits inside a confirmation callback.
      expect(s, file).not.toMatch(
        /onPress: \(\) => (remover|workflowAction)\.mutate\(\(\) => delete/,
      );
    }
  });

  it("applies a blueprint to existing projects through the same op as the web", () => {
    const s = read(join(APP, "blueprint/[id].tsx"));
    expect(s).toContain("applyBlueprint({");
    expect(read(join(ROOT, "apps/mobile/src/api/blueprints.ts"))).toContain(
      'api.rpc<Partial<ApplyResult>>("applyProjectBlueprint"',
    );
  });

  it("edits document bodies in place with the shared formatted editor", () => {
    const s = read(join(APP, "document-template/[id].tsx"));
    expect(s).toContain("<FormattedTextEditor");
    expect(s).toContain('from "@/api/rich-doc"');
    // Opened through the sanitising op, never from the raw column.
    expect(read(join(ROOT, "apps/mobile/src/api/document-template-admin.ts"))).toContain(
      '"getDocumentTemplate"',
    );
  });

  it("creates workflow templates, starting with one phase", () => {
    const admin = read(join(ROOT, "apps/mobile/src/api/workflow-template-admin.ts"));
    expect(admin).toMatch(/createWorkflowTemplate[\s\S]*name: "Phase 1"/);
    expect(read(join(APP, "templates.tsx"))).toContain("createWorkflowTemplate(");
  });
});
