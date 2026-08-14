import { describe, it, expect } from "vitest";
import { REPORT_STARTERS, getReportStarter } from "../packages/shared/src/index";

/**
 * The starter library is data that lands straight in a client's PDF, so the
 * checks here are the ones a broken entry would otherwise fail silently at:
 * a duplicate id (the picker would select two cards at once), a density the
 * renderer cannot draw, or an empty section list (a "template" that creates
 * nothing, which is worse than the blank option next to it).
 */
describe("built-in report starters", () => {
  it("ships a library worth showing", () => {
    expect(REPORT_STARTERS.length).toBeGreaterThanOrEqual(4);
  });

  it("has unique ids", () => {
    const ids = REPORT_STARTERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves by id and refuses anything else", () => {
    for (const t of REPORT_STARTERS) expect(getReportStarter(t.id)).toBe(t);
    expect(getReportStarter("does-not-exist")).toBeNull();
    expect(getReportStarter(null)).toBeNull();
    expect(getReportStarter("")).toBeNull();
  });

  it("only asks for densities the renderers can draw", () => {
    for (const t of REPORT_STARTERS) {
      expect([1, 2, 3, 4]).toContain(t.photosPerPage);
    }
  });

  it("creates at least two named sections each", () => {
    for (const t of REPORT_STARTERS) {
      expect(t.sections.length, t.id).toBeGreaterThanOrEqual(2);
      for (const heading of t.sections) expect(heading.trim(), t.id).not.toBe("");
      expect(new Set(t.sections).size, `${t.id} repeats a heading`).toBe(t.sections.length);
    }
  });

  it("carries the copy the picker card renders", () => {
    for (const t of REPORT_STARTERS) {
      expect(t.name.trim(), t.id).not.toBe("");
      expect(t.description.trim(), t.id).not.toBe("");
    }
  });

  /*
   * Section headings print as-is. A stray tag would reach the PDF's rich-text
   * parser as markup rather than as a heading.
   */
  it("keeps markup out of headings and names", () => {
    for (const t of REPORT_STARTERS) {
      for (const s of [t.name, t.description, ...t.sections]) {
        expect(s, t.id).not.toMatch(/[<>]/);
      }
    }
  });

  it("labels every starter with a category the picker can badge", () => {
    for (const t of REPORT_STARTERS) expect(t.category.trim(), t.id).not.toBe("");
  });
});
