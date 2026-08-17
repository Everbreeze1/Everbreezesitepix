import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WALKTHROUGH_STARTERS,
  type WalkthroughStarter,
} from "../apps/web/src/features/settings/components/walkthrough-starters";
import { CATEGORY_ORDER } from "../apps/web/src/lib/template-categories";

/**
 * The walkthrough starter library.
 *
 * These are copied verbatim into a user's own `walkthrough_templates` rows and
 * then, via a blueprint, into the capture steps a crew works through on site.
 * So the checks here are the ones a broken entry would otherwise fail silently
 * at: a capture value the database CHECK rejects, an empty shot list (a
 * "walkthrough" that creates nothing), or a trade string that does not exist,
 * which would file the starter under a heading no other tab uses.
 */
describe("built-in walkthrough starters", () => {
  it("ships a library worth showing", () => {
    expect(WALKTHROUGH_STARTERS.length).toBeGreaterThanOrEqual(6);
  });

  it("has unique names", () => {
    const names = WALKTHROUGH_STARTERS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("files every starter under a real trade", () => {
    for (const s of WALKTHROUGH_STARTERS) {
      if (s.category === undefined) continue;
      expect(CATEGORY_ORDER, `${s.name} claims an unknown trade`).toContain(s.category);
    }
  });

  it("covers each trade at most once, so no tab shows two near-identical starters", () => {
    const byTrade = new Map<string, string[]>();
    for (const s of WALKTHROUGH_STARTERS) {
      const key = s.category ?? "__general";
      byTrade.set(key, [...(byTrade.get(key) ?? []), s.name]);
    }
    for (const [trade, names] of byTrade) {
      expect(names, `${trade} has more than one starter`).toHaveLength(1);
    }
  });

  it("gives every starter a usable shot list", () => {
    for (const s of WALKTHROUGH_STARTERS) {
      expect(s.shots.length, `${s.name} has no shots`).toBeGreaterThanOrEqual(5);
      expect(s.description.trim(), `${s.name} has no description`).not.toBe("");
      for (const shot of s.shots) {
        expect(shot.label.trim(), `${s.name} has an unlabelled shot`).not.toBe("");
      }
      // A shot list with nothing required is a suggestion, not a standard, and
      // the point of these is that the same job gets documented the same way.
      expect(
        s.shots.some((shot) => shot.required),
        `${s.name} marks nothing as required`,
      ).toBe(true);
    }
  });

  it("only asks for capture types the database and the apply both accept", () => {
    // The CHECK constraint in 20260908000000, and the KIND_FOR_CAPTURE map in
    // applyProjectBlueprintService, are both closed over exactly these three.
    for (const s of WALKTHROUGH_STARTERS) {
      for (const shot of s.shots) {
        expect(["photo", "video", "note"], `${s.name}: ${shot.label}`).toContain(shot.capture);
      }
    }
  });

  it("agrees with the capture values the migration allows", () => {
    // Read from the migration rather than restated here, so widening one and
    // not the other fails rather than drifting.
    const sql = readFileSync(
      join(__dirname, "../supabase/migrations/20260908000000_blueprint_component_libraries.sql"),
      "utf8",
    );
    const match = sql.match(/CHECK \(capture IN \(([^)]+)\)\)/);
    expect(match, "the capture CHECK constraint moved or was renamed").toBeTruthy();
    const allowed = match![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    const used = new Set(WALKTHROUGH_STARTERS.flatMap((s) => s.shots.map((x) => x.capture)));
    for (const capture of used) expect(allowed).toContain(capture);
  });

  it("keeps a general-purpose starter, for the trades we have not written one for", () => {
    const general: WalkthroughStarter | undefined = WALKTHROUGH_STARTERS.find(
      (s) => s.category === "Field Reports",
    );
    expect(general, "no catch-all walkthrough starter").toBeTruthy();
  });
});
