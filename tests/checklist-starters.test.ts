import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { INDUSTRIES, tradeCategoryFor } from "@sitepix/shared";

/*
 * The checklist starter library, checked the same way the document library is.
 *
 * These are not database rows - `checklist_templates` is per-user, so there is
 * nothing ownerless to seed and the library lives in a TypeScript array that is
 * copied into a user's own rows on demand. Nothing type-checks the part that
 * matters: a `category` string that does not match the shared trade order files
 * the starter under a heading of one, and a trade with no starter at all is a
 * company that answered the setup wizard and then found the Starters dialog had
 * nothing addressed to them.
 */

const ROOT = resolve(__dirname, "..");
const PAGE_PATH = "apps/web/src/features/settings/pages/ChecklistTemplatesPage.tsx";
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PAGE = read(PAGE_PATH);

/** The trade order both template tabs sort by. */
const CATEGORY_ORDER = (() => {
  const src = read("apps/web/src/lib/template-categories.ts");
  const m = /export const CATEGORY_ORDER = \[([\s\S]*?)\]/.exec(src);
  return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
})();

/** The answer types a checklist item may use. */
const ITEM_TYPES = (() => {
  const src = read("apps/web/src/lib/checklist-items.ts");
  const m = /export const TYPE_ORDER: ItemType\[\] = \[([\s\S]*?)\]/.exec(src);
  return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
})();

interface Starter {
  name: string;
  category: string | null;
  itemTypes: string[];
  itemCount: number;
  labelCount: number;
  requiredCount: number;
}

const STARTERS: Starter[] = (() => {
  const block = /const STARTER_TEMPLATES:[\s\S]*?\n\];/.exec(PAGE)?.[0] ?? "";
  // Each starter is one object at two-space indent inside the array literal.
  return block
    .split(/\n {2}\{\n/)
    .slice(1)
    .map((chunk) => {
      const name = /name: "((?:[^"\\]|\\.)*)"/.exec(chunk)?.[1] ?? "";
      const category = /\n {4}category: "([^"]+)"/.exec(chunk)?.[1] ?? null;
      /*
       * Counted off `item_type` and `label`, both of which appear exactly once
       * per item wherever Prettier decides to wrap. Matching `{ label: "` was
       * the obvious way and the wrong one: it silently skips any item long
       * enough to be broken across lines, so this file's own count drifted
       * from the array it was checking.
       */
      const itemTypes = [...chunk.matchAll(/\bitem_type: "(\w+)"/g)].map((m) => m[1]);
      return {
        name,
        category,
        itemTypes,
        itemCount: itemTypes.length,
        labelCount: [...chunk.matchAll(/\blabel: "/g)].length,
        requiredCount: [...chunk.matchAll(/\brequired: true/g)].length,
      };
    })
    .filter((s) => s.name);
})();

describe("the checklist starter library", () => {
  it("parses (guards the scan these tests depend on)", () => {
    expect(STARTERS.length).toBeGreaterThanOrEqual(10);
    expect(CATEGORY_ORDER.length).toBeGreaterThanOrEqual(9);
    expect(ITEM_TYPES).toContain("pass_fail");
    // The parser must actually be reading items, not matching an empty chunk.
    for (const s of STARTERS) expect(s.itemCount, `${s.name} parsed no items`).toBeGreaterThan(0);
  });

  it("files every starter under a trade the rest of the app knows", () => {
    for (const s of STARTERS) {
      expect(s.category, `${s.name} has no trade`).toBeTruthy();
      expect(CATEGORY_ORDER, `${s.name} uses unranked trade "${s.category}"`).toContain(s.category);
    }
  });

  it("gives every industry with its own trade section at least one starter", () => {
    /*
     * The failure this exists for: a company answers "we are electricians",
     * their document templates jump to the top, they open Checklists →
     * Starters and the top card is a roof inspection. The trade order worked
     * and there was simply nothing to order.
     */
    const covered = new Set(STARTERS.map((s) => s.category));
    for (const ind of INDUSTRIES) {
      const trade = tradeCategoryFor(ind.id);
      if (!trade) continue; // Landscaping and "Something else" have no section.
      expect(covered.has(trade), `${ind.label} has no starter checklist`).toBe(true);
    }
  });

  it("uses one name per starter", () => {
    // `createFromStarter` names the created template after the starter, and the
    // dialog keys its cards by name.
    const names = STARTERS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("only uses answer types the item renderer knows", () => {
    // An unknown `item_type` reaches the database, then renders as nothing the
    // crew can fill in.
    for (const s of STARTERS) {
      for (const t of s.itemTypes) {
        expect(ITEM_TYPES, `${s.name} uses unknown item type "${t}"`).toContain(t);
      }
    }
  });

  it("makes every starter worth picking over a blank template", () => {
    // The whole promise of the dialog is "fully populated". A four-item starter
    // is a blank template with extra steps.
    for (const s of STARTERS) {
      expect(s.itemCount, `${s.name} is too thin to be a starter`).toBeGreaterThanOrEqual(7);
      expect(s.requiredCount, `${s.name} marks nothing as required`).toBeGreaterThan(0);
      // Every item is labelled. An item_type with no label renders as a blank
      // row the crew cannot answer.
      expect(s.labelCount, `${s.name} has an unlabelled item`).toBe(s.itemCount);
    }
  });
});

describe("the Checklists tab reads the company's trade", () => {
  it("groups and sorts by the shared trade order", () => {
    /*
     * The client's point, one tab further on than the documents work: the
     * Templates page has several tabs, and a trade that only leads on one of
     * them reads as the setting not having worked.
     */
    expect(PAGE, "does not read the shared trade order").toMatch(
      /from "@\/lib\/template-categories"/,
    );
    expect(PAGE, "does not use the personalised rank").toMatch(/makeCategoryRank\(/);
    expect(PAGE, "does not read the company profile").toMatch(/useCompanySetup\(/);
    expect(PAGE, "does not derive the company's own trade").toMatch(/tradeCategoryFor\(/);
    expect(PAGE, "defines its own trade order again").not.toMatch(/const CATEGORY_ORDER = \[/);
  });

  it("carries the trade onto the row it creates", () => {
    // Otherwise picking the Electrical starter files the copy under General and
    // the author has to move it by hand - which is the friction the grouping
    // was added to remove.
    expect(PAGE).toMatch(/createTemplate\(s\.name, s\.description, s\.category \?\? null\)/);
    expect(PAGE, "duplicating drops the trade").toMatch(
      /createTemplate\(`\$\{t\.name\} \(copy\)`, t\.description, t\.category \?\? null\)/,
    );
  });

  it("lets an author refile a checklist without leaving the editor", () => {
    // The control is shared with the Workflows and report-template builders -
    // three copies of one dropdown is how their trade lists drift apart. See
    // tests/trade-starters.test.ts, which holds all three to the shared one.
    expect(PAGE).toMatch(/from "@\/components\/builder\/TradeSelect"/);
    expect(PAGE).toMatch(/<TradeSelect/);
  });

  it("selects the column it groups by", () => {
    // Grouping by a field the query never asked for puts every template in
    // General, silently.
    expect(PAGE).toMatch(/select\("id, name, description, archived, created_at, category"\)/);
  });

  it("ships the migration the column lives in", () => {
    const sql = read("supabase/migrations/20260828000000_checklist_template_trades.sql");
    expect(sql).toMatch(/ALTER TABLE public\.checklist_templates/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS category TEXT/);
  });
});
