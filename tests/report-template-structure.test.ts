import { describe, it, expect } from "vitest";
import { parseReportTemplateStructure } from "../packages/shared/src/report-template-structure";

/*
 * `report_templates.sections` is jsonb carrying two shapes at once:
 *
 *   legacy   [{ heading, body }]                        - the column DEFAULT
 *   current  { coverStyle, placeholders, items: [...] } - what the editor writes
 *
 * Nothing migrated the old rows, so both are live. The blueprint apply service
 * read the column as `((r as any).sections as any[]) ?? []` - a cast plus a
 * null-only guard - and then called `.map`, so every report template saved by
 * the current editor blew up with "sections.map is not a function" mid-apply.
 *
 * The contract these lock in: parseReportTemplateStructure is TOTAL. Whatever is
 * in that column, callers get an object with a real `items` array and can `.map`
 * it without a type guard.
 */
describe("parseReportTemplateStructure - both live shapes of report_templates.sections", () => {
  it("reads the current editor object shape (the one that threw)", () => {
    const s = parseReportTemplateStructure({
      coverStyle: "hero",
      placeholders: ["project_name", "report_date"],
      items: [
        { id: "a", heading: "Executive summary", body: "<p>Hi</p>", layout: "text" },
        { id: "b", heading: "Photos", body: "", layout: "photo-grid" },
      ],
    });
    expect(s.coverStyle).toBe("hero");
    expect(s.placeholders).toEqual(["project_name", "report_date"]);
    expect(s.items.map((i) => i.heading)).toEqual(["Executive summary", "Photos"]);
    expect(s.items[1].layout).toBe("photo-grid");
  });

  it("reads the legacy bare-array shape", () => {
    const s = parseReportTemplateStructure([
      { heading: "Overview", body: "<p>x</p>" },
      { heading: "Next steps", body: "" },
    ]);
    expect(s.items.map((i) => i.heading)).toEqual(["Overview", "Next steps"]);
    // A bare array carries no cover or placeholder information.
    expect(s.coverStyle).toBe("centered");
    expect(s.placeholders).toEqual([]);
  });

  it("always returns a mappable items array - never throws", () => {
    for (const raw of [
      null,
      undefined,
      {},
      [],
      "",
      0,
      false,
      { items: null },
      { items: "nope" },
      { placeholders: "nope", items: [] },
      { coverStyle: 42, items: [] },
      [null, undefined, 7],
    ]) {
      const s = parseReportTemplateStructure(raw);
      expect(Array.isArray(s.items)).toBe(true);
      expect(Array.isArray(s.placeholders)).toBe(true);
      // The exact call that used to throw.
      expect(() => s.items.map((i) => i.heading)).not.toThrow();
    }
  });

  it("survives a double-encoded JSON string", () => {
    const s = parseReportTemplateStructure(
      JSON.stringify({
        coverStyle: "minimal",
        placeholders: [],
        items: [{ heading: "A", body: "" }],
      }),
    );
    expect(s.coverStyle).toBe("minimal");
    expect(s.items.map((i) => i.heading)).toEqual(["A"]);
  });

  it("fills in defaults for malformed section entries rather than dropping them", () => {
    const s = parseReportTemplateStructure({ items: [{}, { heading: 5 }, { body: null }] });
    expect(s.items).toHaveLength(3);
    expect(s.items[0].heading).toBe("Section 1");
    expect(s.items[1].heading).toBe("Section 2");
    expect(s.items.every((i) => typeof i.body === "string")).toBe(true);
    expect(s.items.every((i) => i.layout === "text")).toBe(true);
  });

  it("rejects unknown cover styles and layouts instead of passing them through", () => {
    const s = parseReportTemplateStructure({
      coverStyle: "spinning-3d",
      items: [{ heading: "A", body: "", layout: "interpretive-dance" }],
    });
    expect(s.coverStyle).toBe("centered");
    expect(s.items[0].layout).toBe("text");
  });

  it("gives every section a unique id so list rendering and reordering stay stable", () => {
    const s = parseReportTemplateStructure({
      items: [
        { heading: "A", body: "" },
        { heading: "B", body: "" },
        { heading: "C", body: "" },
      ],
    });
    const ids = s.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("preserves ids that are already stored", () => {
    const s = parseReportTemplateStructure({
      items: [{ id: "keep-me", heading: "A", body: "" }],
    });
    expect(s.items[0].id).toBe("keep-me");
  });
});
