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
    // No space collapsing: "a—b" is "a-b", not "a - b".
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
