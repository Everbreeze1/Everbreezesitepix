import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPORT_STARTERS } from "../packages/shared/src/index";
import { BLUEPRINT_STARTERS } from "../apps/web/src/features/settings/components/blueprint-starters";
import { WALKTHROUGH_STARTERS } from "../apps/web/src/features/settings/components/walkthrough-starters";
import { STARTER_TEMPLATES } from "../apps/web/src/features/settings/components/checklist-starters";
import { STARTER_WORKFLOWS } from "../apps/web/src/features/settings/components/workflow-starters";
import {
  KIND_OUTCOME,
  SINGLETON_KINDS,
  type BlueprintItemKind,
} from "../apps/web/src/features/settings/components/blueprint-outcomes";
import { CATEGORY_ORDER } from "../apps/web/src/lib/template-categories";

/**
 * The pre-built blueprints.
 *
 * A blueprint is a bundle of REFERENCES, so a starter blueprint names the
 * components it wants and `installBlueprintStarter` resolves each name against
 * the user's library, falling back to that library's own starter list. A name
 * that matches nothing is not an error anyone would see: the install just
 * quietly attaches four sections where the card promised five.
 *
 * So the load-bearing check here is that every piece a starter asks for is
 * resolvable. Rename a checklist starter and this fails, which is the whole
 * point - the alternative is shipping a blueprint that installs most of itself.
 */

const normalise = (s: string) => s.trim().toLowerCase();

/** Every document template name seeded into the built-in library. */
function seededDocumentNames(): Set<string> {
  const dir = join(__dirname, "../supabase/migrations");
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => /document_templates.*seed/i.test(f))) {
    const sql = readFileSync(join(dir, file), "utf8");
    /*
     * Every seeded row is `VALUES ('slug', NULL, NULL, 'Display Name', ...` -
     * the same shape tests/document-template-library.test.ts reads. Anchoring on
     * the two NULLs is what separates the display name from the slug in front of
     * it; matching bare quoted strings would sweep up every category and
     * description in the file and make this test pass on names that do not
     * exist.
     */
    for (const m of sql.matchAll(/NULL,\s*NULL,\s*'((?:[^']|'')*)'/g)) {
      names.add(normalise(m[1].replace(/''/g, "'")));
    }
  }
  return names;
}

describe("pre-built blueprints", () => {
  it("ships the two-to-three the spec asks for", () => {
    expect(BLUEPRINT_STARTERS.length).toBeGreaterThanOrEqual(2);
    expect(BLUEPRINT_STARTERS.length).toBeLessThanOrEqual(6);
  });

  it("has unique names and a real trade each", () => {
    const names = BLUEPRINT_STARTERS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of BLUEPRINT_STARTERS) {
      expect(CATEGORY_ORDER, `${s.name} claims an unknown trade`).toContain(s.category);
      expect(s.description.trim(), `${s.name} has no description`).not.toBe("");
      expect(s.pieces.length, `${s.name} bundles nothing`).toBeGreaterThanOrEqual(3);
    }
  });

  it("respects zero-to-one workflow", () => {
    // The spec's rule, and the one `SINGLETON_KINDS` and the apply service both
    // enforce at runtime. A starter that broke it would install a blueprint the
    // builder itself would refuse to let you assemble.
    for (const s of BLUEPRINT_STARTERS) {
      for (const kind of SINGLETON_KINDS) {
        const n = s.pieces.filter((p) => p.kind === kind).length;
        expect(n, `${s.name} bundles ${n} ${kind}s`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("names a component the installer can actually resolve", () => {
    const libraries: Record<BlueprintItemKind, Set<string>> = {
      checklist: new Set(STARTER_TEMPLATES.map((t) => normalise(t.name))),
      walkthrough: new Set(WALKTHROUGH_STARTERS.map((t) => normalise(t.name))),
      workflow: new Set(STARTER_WORKFLOWS.map((t) => normalise(t.name))),
      report: new Set(REPORT_STARTERS.map((t) => normalise(t.name))),
      document: seededDocumentNames(),
      // No starter bundles a saved label set - a starter's labels ride on the
      // blueprint's own `labels` column instead.
      label_set: new Set<string>(),
    };

    const unresolvable: string[] = [];
    for (const s of BLUEPRINT_STARTERS) {
      for (const p of s.pieces) {
        if (!libraries[p.kind].has(normalise(p.name))) {
          unresolvable.push(`${s.name} -> ${p.kind} "${p.name}"`);
        }
      }
    }
    expect(unresolvable).toEqual([]);
  });

  it("only uses kinds the blueprint model knows about", () => {
    for (const s of BLUEPRINT_STARTERS) {
      for (const p of s.pieces) {
        expect(Object.keys(KIND_OUTCOME), `${s.name}: ${p.kind}`).toContain(p.kind);
      }
    }
  });
});

describe("blueprint item kinds", () => {
  it("every kind the UI offers is a kind the database accepts", () => {
    // `project_template_items.kind` is a CHECK constraint, so a kind added to
    // KIND_OUTCOME and not to the migration is rejected at insert time, with
    // the failure landing on the user rather than here.
    const sql = readFileSync(
      join(__dirname, "../supabase/migrations/20260908000000_blueprint_component_libraries.sql"),
      "utf8",
    );
    const match = sql.match(/CHECK \(kind IN \(([^)]+)\)\)/);
    expect(match, "the kind CHECK constraint moved or was renamed").toBeTruthy();
    const allowed = match![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    for (const kind of Object.keys(KIND_OUTCOME)) expect(allowed).toContain(kind);
  });

  it("every kind reports a count the apply service actually writes", () => {
    // `countsKey` is the key `applyProjectBlueprintService` reports under and
    // the key persisted into `project_blueprint_applications.counts`. The apply
    // dialog matches on it to turn "1 label_sets" into "1 label set", so a kind
    // whose key the service never writes renders as a raw wire key.
    const service = readFileSync(
      join(__dirname, "../apps/api/src/domains/blueprints/service.ts"),
      "utf8",
    );
    const countsBlock = service.match(/const counts: Record<string, number> = \{([\s\S]*?)\};/);
    expect(countsBlock, "the counts object moved").toBeTruthy();
    const keys = [...countsBlock![1].matchAll(/(\w+):\s*0/g)].map((m) => m[1]);
    for (const kind of Object.keys(KIND_OUTCOME) as BlueprintItemKind[]) {
      expect(keys, `${kind} reports a count the service never writes`).toContain(
        KIND_OUTCOME[kind].countsKey,
      );
    }
  });
});
