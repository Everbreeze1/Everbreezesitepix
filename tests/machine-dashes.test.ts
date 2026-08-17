import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { normalizeDashes, normalizeDashesTrimmed } from "../packages/shared/src/machine-dashes";

/*
 * Every dash is written as an escape here, never as the literal character.
 * tests/no-em-dash.test.ts scans this file too, and a literal would fail it.
 */
const EN = "\u2013";
const EM = "\u2014";
const BAR = "\u2015";
const TWO_EM = "\u2E3A";
const THREE_EM = "\u2E3B";

describe("normalizeDashes", () => {
  it("folds every banned dash to a plain hyphen", () => {
    for (const d of [EN, EM, BAR, TWO_EM, THREE_EM]) {
      expect(normalizeDashes(`north wall ${d} cracked`)).toBe("north wall - cracked");
    }
  });

  it("folds every occurrence, not just the first", () => {
    expect(normalizeDashes(`a${EM}b${EM}c`)).toBe("a-b-c");
  });

  it("leaves a hyphen, a minus and ordinary text alone", () => {
    expect(normalizeDashes("already - fine")).toBe("already - fine");
    expect(normalizeDashes("-12 degrees")).toBe("-12 degrees");
    expect(normalizeDashes("")).toBe("");
  });

  it("keeps the spacing the model wrote", () => {
    // No space collapsing: a long dash with no spaces yields a bare hyphen.
    expect(normalizeDashes(`a${EM}b`)).toBe("a-b");
  });

  it("trims and survives null or undefined", () => {
    expect(normalizeDashesTrimmed(`  Site visit ${EM} August  `)).toBe("Site visit - August");
    expect(normalizeDashesTrimmed(null)).toBe("");
    expect(normalizeDashesTrimmed(undefined)).toBe("");
  });

  it("cleans the title shape the Auto Report was actually storing", () => {
    expect(
      normalizeDashesTrimmed(`20 Charlcote Crescent ${EM} Site visit report ${EM} 8/1/2026`),
    ).toBe("20 Charlcote Crescent - Site visit report - 8/1/2026");
  });
});

/*
 * The `fold_machine_dashes` backfills do in SQL what normalizeDashes does in
 * TypeScript, for rows this app had already written before the repo-wide sweep.
 * Two implementations of one rule drift silently: adding a dash to
 * MACHINE_DASHES would leave a migration folding four of five, and nothing
 * would say so - the symptom is a character surviving on a public marketing
 * page, which is exactly how this was found in the first place.
 *
 * Discovered by glob rather than named one by one. The first backfill turned
 * out to have missed several columns and needed a second, and a test that only
 * knew about the file it was written beside would have gone on passing while a
 * new one drifted.
 *
 * The migrations spell the characters as chr() so no literal enters the repo,
 * so the check reads those codes back out and compares the sets.
 */
describe("the SQL backfills and normalizeDashes agree on the character set", () => {
  const dir = resolve(__dirname, "../supabase/migrations");
  const files = readdirSync(dir)
    .filter((n) => /fold_machine_dashes.*\.sql$/.test(n))
    .sort();

  it("finds the backfill migrations", () => {
    // A rename that slips past the glob would silently empty this whole block.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const sql = readFileSync(resolve(dir, file), "utf8");

    it(`${file} folds exactly the dashes normalizeDashes folds`, () => {
      const declared = [...sql.matchAll(/chr\((\d+)\)/g)].map((m) => Number(m[1]));
      expect(declared.length).toBeGreaterThan(0);

      const fromTs = [EN, EM, BAR, TWO_EM, THREE_EM].map((c) => c.codePointAt(0)!);
      expect([...new Set(declared)].sort((a, b) => a - b)).toEqual(
        [...fromTs].sort((a, b) => a - b),
      );
    });

    it(`${file} maps every dash to a hyphen, since translate() drops unmatched ones`, () => {
      // translate(str, from, to) deletes any character in `from` with no
      // positional partner in `to`. A short replacement string would silently
      // splice dashes out of live copy instead of replacing them.
      const from = [...sql.matchAll(/chr\((\d+)\)/g)].length;
      const to = sql.match(/hyphens\s+text\s*:=\s*'(-+)'/)?.[1].length ?? 0;
      expect(to).toBe(from);
    });
  }
});
