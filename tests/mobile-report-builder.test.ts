import { describe, expect, it } from "vitest";
import {
  addPhotos,
  clampPhotosPerPage,
  generateOptions,
  generatePhotoError,
  isTwoPane,
  moveItem,
  nextSectionPosition,
  normaliseSectionPhotos,
  removePhoto,
  renumberSections,
  sectionBodyToText,
  setPhotoCaption,
  templatesLockedFor,
  textToSectionBody,
} from "../apps/mobile/src/api/report-builder-view";
import { pagesForProject, searchReportIndex } from "../apps/mobile/src/api/report-index-view";

/*
 * The phone's report builder writes the same rows the web builder does, and
 * the PDF is rendered from them. These are the rules that keep the two in
 * step: section positions, photo arrays, and never flattening rich text.
 */

describe("sections", () => {
  it("a new section goes one past the highest position, not at the count", () => {
    // A deleted section leaves a gap; reusing position 1 would collide.
    expect(nextSectionPosition([{ position: 0 }, { position: 2 }])).toBe(3);
    expect(nextSectionPosition([])).toBe(0);
  });

  it("moves and renumbers from zero", () => {
    const list = [
      { id: "a", position: 0 },
      { id: "b", position: 3 },
      { id: "c", position: 7 },
    ];
    const moved = renumberSections(moveItem(list, 2, 0));
    expect(moved.map((s) => [s.id, s.position])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
  });

  it("an out of range move returns the same array", () => {
    const list = [1, 2];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 1, 2)).toBe(list);
  });
});

describe("section photos", () => {
  it("reads whatever the jsonb column holds", () => {
    expect(
      normaliseSectionPhotos([{ photo_id: "p1", caption: "Before" }, { photo_id: "p2" }, null, 4]),
    ).toEqual([
      { photo_id: "p1", caption: "Before" },
      { photo_id: "p2", caption: "" },
    ]);
    expect(normaliseSectionPhotos("nope")).toEqual([]);
  });

  it("adds without duplicating and keeps existing captions", () => {
    const start = [{ photo_id: "p1", caption: "Kept" }];
    expect(addPhotos(start, ["p1", "p2"])).toEqual([
      { photo_id: "p1", caption: "Kept" },
      { photo_id: "p2", caption: "" },
    ]);
  });

  it("captions and removes by id", () => {
    const start = [
      { photo_id: "p1", caption: "" },
      { photo_id: "p2", caption: "" },
    ];
    expect(setPhotoCaption(start, "p2", "Leak")[1].caption).toBe("Leak");
    expect(removePhoto(start, "p1").map((p) => p.photo_id)).toEqual(["p2"]);
  });
});

describe("section body text", () => {
  it("round trips paragraphs, headings and bullets", () => {
    const html = textToSectionBody(
      "## Findings\nWater under the sink.\n- Valve loose\n- Trap cracked",
    );
    expect(html).toBe(
      "<h2>Findings</h2>\n<p>Water under the sink.</p>\n<ul><li>Valve loose</li><li>Trap cracked</li></ul>",
    );
    expect(sectionBodyToText(html)).toEqual({
      editable: true,
      text: "## Findings\nWater under the sink.\n- Valve loose\n- Trap cracked",
    });
  });

  it("an empty body is editable", () => {
    expect(sectionBodyToText(null)).toEqual({ editable: true, text: "" });
    expect(sectionBodyToText("<p></p>")).toEqual({ editable: true, text: "" });
  });

  it("refuses rich text rather than flattening it on save", () => {
    const body = sectionBodyToText("<p>Replace the <strong>main</strong> valve</p>");
    expect(body.editable).toBe(false);
    if (!body.editable) expect(body.preview).toBe("Replace the main valve");
  });

  it("refuses a paragraph that would come back as a bullet", () => {
    expect(sectionBodyToText("<p>- not a list</p>").editable).toBe(false);
  });

  it("escapes what it writes", () => {
    expect(textToSectionBody("Pipes < 2in & fittings")).toBe(
      "<p>Pipes &lt; 2in &amp; fittings</p>",
    );
  });
});

describe("settings", () => {
  it("photos per page stays within 1 to 4", () => {
    expect(clampPhotosPerPage(0)).toBe(1);
    expect(clampPhotosPerPage(9)).toBe(4);
    expect(clampPhotosPerPage(undefined)).toBe(2);
    expect(clampPhotosPerPage(3)).toBe(3);
  });

  it("AI documents take 1 to 50 photos", () => {
    expect(generatePhotoError(0)).not.toBeNull();
    expect(generatePhotoError(51)).not.toBeNull();
    expect(generatePhotoError(12)).toBeNull();
  });

  it("templates lock for Starter and inactive plans only", () => {
    expect(templatesLockedFor(undefined)).toBe(false);
    expect(templatesLockedFor({ plan: "starter", isActive: true })).toBe(true);
    expect(templatesLockedFor({ plan: "pro", isActive: false })).toBe(true);
    expect(templatesLockedFor({ plan: "team", isActive: true })).toBe(false);
    expect(templatesLockedFor({ plan: "starter", isActive: false, isInternal: true })).toBe(false);
  });

  it("two panes from 768 wide", () => {
    expect(isTwoPane(767)).toBe(false);
    expect(isTwoPane(768)).toBe(true);
  });
});

describe("the New report menu", () => {
  it("offers the web menu's report kinds, and paperwork only in the full menu", () => {
    expect(generateOptions("reports").map((o) => o.kind)).toEqual([
      "summary",
      "full_report",
      "photo_report",
      "built_report",
    ]);
    const all = generateOptions("all");
    expect(all.map((o) => o.kind)).toContain("template");
    expect(all.find((o) => o.kind === "template")?.pro).toBe(true);
  });
});

describe("report index helpers", () => {
  const item = (title: string, projectName: string | null) => ({
    kind: "page" as const,
    id: title,
    projectId: "p",
    projectName,
    title,
    updatedAt: "2026-09-01T00:00:00Z",
    status: "shared" as const,
  });

  it("search matches every word across title and job", () => {
    const items = [item("Roof survey", "Fisher house"), item("Final walk", "Lee flat")];
    expect(searchReportIndex(items, "fisher roof").map((i) => i.title)).toEqual(["Roof survey"]);
    expect(searchReportIndex(items, "  ")).toHaveLength(2);
  });

  it("keeps one job's report pages", () => {
    const pages = [
      {
        id: "a",
        projectId: "p1",
        projectName: "One",
        title: "A",
        updatedAt: "2026-09-01T00:00:00Z",
        shareToken: "t",
        revokedAt: null,
      },
      {
        id: "b",
        projectId: "p2",
        projectName: "Two",
        title: "B",
        updatedAt: "2026-09-02T00:00:00Z",
        shareToken: null,
        revokedAt: null,
      },
    ];
    expect(pagesForProject(pages, "p1").map((p) => [p.id, p.status])).toEqual([["a", "shared"]]);
  });
});
