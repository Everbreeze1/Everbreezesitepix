import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CHECKLIST_TYPE_LABELS,
  CONDITION_OPTIONS,
  MAX_UNIT_LENGTH,
  MEASUREMENT_UNITS,
  SEVERITY_LEVELS,
  answerWantsPhoto,
  formatChecklistAnswer,
  isMissingRequiredPhoto,
  normalizeUnit,
  severityLabel,
} from "../packages/shared/src/index";

/*
 * Severity, Condition, measurement units and "photo required" on checklists.
 *
 * The answer shapes are shared by the web runner, the app, the public share
 * link and the printed sheet, so the vocabulary is tested once here, and the
 * places that copy a template item into a project are checked for carrying the
 * two new columns: a copy that drops them silently turns "photo required" off
 * on every job made from that template.
 */

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("severity", () => {
  it("runs 1 Minor to 5 Critical", () => {
    expect(SEVERITY_LEVELS.map((l) => l.value)).toEqual([1, 2, 3, 4, 5]);
    expect(severityLabel(1)).toBe("Minor");
    expect(severityLabel(5)).toBe("Critical");
    expect(severityLabel(6)).toBeNull();
    expect(severityLabel(null)).toBeNull();
  });

  it("prints the number with its name", () => {
    expect(formatChecklistAnswer("severity", 4)).toBe("4 / 5 High");
    expect(formatChecklistAnswer("severity", 9)).toBeNull();
    expect(formatChecklistAnswer("severity", null)).toBeNull();
  });
});

describe("condition", () => {
  it("offers Good, Fair, Poor and prints them as stored", () => {
    expect([...CONDITION_OPTIONS]).toEqual(["Good", "Fair", "Poor"]);
    expect(formatChecklistAnswer("condition", "Poor")).toBe("Poor");
  });
});

describe("measurement units", () => {
  it("prints a number with its unit, and without one when there is none", () => {
    expect(formatChecklistAnswer("numeric", 12, "ft")).toBe("12 ft");
    expect(formatChecklistAnswer("numeric", 0, "psi")).toBe("0 psi");
    expect(formatChecklistAnswer("numeric", 12, null)).toBe("12");
    expect(formatChecklistAnswer("numeric", 12, "   ")).toBe("12");
  });

  it("normalizes a typed unit the way the database stores it", () => {
    expect(normalizeUnit("  sq ft ")).toBe("sq ft");
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit(null)).toBeNull();
    expect(normalizeUnit("x".repeat(40))).toHaveLength(MAX_UNIT_LENGTH);
  });

  it("only offers units that fit the column", () => {
    for (const u of MEASUREMENT_UNITS) expect(u.length).toBeLessThanOrEqual(MAX_UNIT_LENGTH);
  });
});

describe("photos", () => {
  it("asks for a photo on a Fail, a Poor, or a High or Critical severity", () => {
    expect(answerWantsPhoto("pass_fail", "Fail")).toBe(true);
    expect(answerWantsPhoto("pass_fail", "Pass")).toBe(false);
    expect(answerWantsPhoto("condition", "Poor")).toBe(true);
    expect(answerWantsPhoto("condition", "Fair")).toBe(false);
    expect(answerWantsPhoto("severity", 4)).toBe(true);
    expect(answerWantsPhoto("severity", 3)).toBe(false);
    expect(answerWantsPhoto("yes_no", "No")).toBe(false);
  });

  it("counts a photo-required item as missing only until a photo is attached", () => {
    expect(isMissingRequiredPhoto({ photo_required: true }, 0)).toBe(true);
    expect(isMissingRequiredPhoto({ photo_required: true }, 1)).toBe(false);
    expect(isMissingRequiredPhoto({ photo_required: false }, 0)).toBe(false);
  });
});

describe("wiring", () => {
  const SQL = read("supabase/migrations/20261011000000_checklist_severity_condition_units.sql");

  it("ships the columns and the widened type check for both item tables", () => {
    for (const table of ["checklist_template_items", "project_checklist_items"]) {
      expect(SQL).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS unit text`),
      );
      expect(SQL).toMatch(new RegExp(`${table}_item_type_check[\\s\\S]*'severity','condition'`));
    }
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS photo_required boolean NOT NULL DEFAULT false/);
    // Unit and photo switch are structure: only checklist authors may change them.
    expect(SQL).toMatch(/OR NEW\.unit IS DISTINCT FROM OLD\.unit/);
    expect(SQL).toMatch(/OR NEW\.photo_required IS DISTINCT FROM OLD\.photo_required/);
  });

  it("labels every answer type the database allows", () => {
    const allowed = /CHECK \(item_type IN \(([^)]*)\)\)/.exec(SQL)?.[1] ?? "";
    for (const t of [...allowed.matchAll(/'(\w+)'/g)].map((m) => m[1])) {
      expect(CHECKLIST_TYPE_LABELS, `no label for ${t}`).toHaveProperty(t);
    }
  });

  it("offers the new types in the web builder and reads the new columns", () => {
    expect(read("apps/web/src/lib/checklist-items.ts")).toMatch(
      /TYPE_ORDER[\s\S]*"condition",\s*"severity"/,
    );
    expect(
      read("apps/web/src/features/projects/components/checklist/checklist-shared.tsx"),
    ).toMatch(/ITEM_COLUMNS =[\s\S]*unit, photo_required/);
  });

  it("carries unit and photo_required wherever a template item is copied", () => {
    for (const p of [
      "apps/web/src/features/projects/components/ApplyTemplateDialog.tsx",
      "apps/web/src/features/projects/components/ProjectChecklists.tsx",
      "apps/web/src/features/settings/components/install-blueprint-starter.ts",
      "apps/web/src/features/settings/components/ChecklistLibraryContent.tsx",
      "apps/web/src/features/settings/pages/ChecklistTemplatesPage.tsx",
      "apps/web/src/features/projects/pages/ChecklistDocumentPage.tsx",
      "apps/api/src/domains/blueprints/service.ts",
    ]) {
      const src = read(p);
      expect(src, `${p} drops the unit`).toMatch(/\bunit:/);
      expect(src, `${p} drops photo_required`).toMatch(/\bphoto_required:/);
    }
  });

  it("prints a measurement with its unit on the public link", () => {
    expect(read("apps/api/src/domains/projects/field-records.ts")).toMatch(
      /formatChecklistAnswer\(r\.item_type, r\.response_value, r\.unit\)/,
    );
  });

  it("uses the new types in the starter library", () => {
    const src = read("apps/web/src/features/settings/components/checklist-starters.ts");
    expect(src).toMatch(/item_type: "severity"/);
    expect(src).toMatch(/item_type: "condition"/);
    expect(src).toMatch(/unit: "/);
    expect(src).toMatch(/photo_required: true/);
  });
});
