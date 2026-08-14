import { describe, it, expect } from "vitest";
import {
  MAX_AUTO_REPORT_PHOTO_SECTIONS,
  consolidateReportSections,
  planSectionPages,
  type DraftReportSection,
} from "../packages/shared/src/index";

/**
 * The complaint this module exists for: "report generation left to its own
 * devices is one pic per page". It was never the density setting failing - the
 * model returned one section per photo, sections are pages, and a page can only
 * batch the photos the section it belongs to actually holds.
 *
 * So the assertions here are mostly about pages, not about sections: the unit
 * under test is only correct if running its output through planSectionPages
 * produces pages that are actually full.
 */

type Photo = string;
const sec = (title: string, photos: Photo[], body = ""): DraftReportSection<Photo> => ({
  title,
  body,
  photos,
});

/** Pages that carry photos, and how many each carries. */
function photoPageSizes(sections: DraftReportSection<Photo>[], photosPerPage: 1 | 2 | 3 | 4) {
  return sections
    .flatMap((s) => planSectionPages({ body: s.body, photos: s.photos, photosPerPage }))
    .filter((p) => p.photos.length > 0)
    .map((p) => p.photos.length);
}

describe("consolidateReportSections", () => {
  it("stops one-photo-per-section from becoming one-photo-per-page", () => {
    const model = [
      sec("Kitchen", ["a"], "<p>Kitchen</p>"),
      sec("Bathroom", ["b"], "<p>Bathroom</p>"),
      sec("Roof", ["c"], "<p>Roof</p>"),
      sec("Exterior", ["d"], "<p>Exterior</p>"),
    ];
    expect(photoPageSizes(model, 2)).toEqual([1, 1, 1, 1]);

    const fixed = consolidateReportSections(model, { photosPerPage: 2 });
    expect(photoPageSizes(fixed, 2)).toEqual([2, 2]);
  });

  it("keeps every photo, in order", () => {
    const fixed = consolidateReportSections(
      [sec("A", ["a"]), sec("B", ["b", "c"]), sec("C", ["d"])],
      { photosPerPage: 3 },
    );
    expect(fixed.flatMap((s) => s.photos)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps a merged section's heading as an h3 inside the body it joins", () => {
    const fixed = consolidateReportSections(
      [sec("Roof", ["a"], "<p>Roof notes</p>"), sec("Gutters", ["b"], "<p>Gutter notes</p>")],
      { photosPerPage: 4 },
    );
    expect(fixed).toHaveLength(1);
    expect(fixed[0].title).toBe("Roof");
    expect(fixed[0].body).toBe("<p>Roof notes</p><h3>Gutters</h3><p>Gutter notes</p>");
  });

  it("escapes a heading before folding it into HTML", () => {
    const fixed = consolidateReportSections([sec("Roof", ["a"]), sec("Bay <2> & 3", ["b"])], {
      photosPerPage: 4,
    });
    expect(fixed[0].body).toContain("<h3>Bay &lt;2&gt; &amp; 3</h3>");
    expect(fixed[0].body).not.toContain("<2>");
  });

  it("leaves narrative sections alone, so the Introduction stays first", () => {
    const fixed = consolidateReportSections(
      [
        sec("Introduction", [], "<p>intro</p>"),
        sec("Roof", ["a"]),
        sec("Walls", ["b"]),
        sec("Conclusion", [], "<p>outro</p>"),
      ],
      { photosPerPage: 2 },
    );
    expect(fixed[0].title).toBe("Introduction");
    expect(fixed[fixed.length - 1].title).toBe("Conclusion");
  });

  /*
   * Adjacency guard. Merging across a text section would drag its photos back
   * in front of prose written about something else - the reader would meet
   * pictures under a heading that never mentioned them.
   */
  it("does not merge across a section that holds no photos", () => {
    const input = [
      sec("Roof", ["a"]),
      sec("Access notes", [], "<p>notes</p>"),
      sec("Walls", ["b"]),
    ];
    expect(consolidateReportSections(input, { photosPerPage: 4 })).toHaveLength(3);
  });

  it("is a no-op at one photo per page - that setting means what it says", () => {
    const input = [sec("A", ["a"]), sec("B", ["b"]), sec("C", ["c"])];
    expect(consolidateReportSections(input, { photosPerPage: 1 })).toHaveLength(3);
  });

  it("still caps section count at one per page, when the model overruns it", () => {
    const input = Array.from({ length: 9 }, (_, i) =>
      sec(`Area ${i}`, [`${i}a`, `${i}b`, `${i}c`, `${i}d`]),
    );
    const fixed = consolidateReportSections(input, { photosPerPage: 1, maxPhotoSections: 3 });
    expect(fixed).toHaveLength(3);
    expect(fixed.flatMap((s) => s.photos)).toHaveLength(36);
  });

  it("defaults the cap to MAX_AUTO_REPORT_PHOTO_SECTIONS", () => {
    const input = Array.from({ length: 10 }, (_, i) => sec(`Area ${i}`, [`${i}a`, `${i}b`]));
    const fixed = consolidateReportSections(input, { photosPerPage: 1 });
    expect(fixed).toHaveLength(MAX_AUTO_REPORT_PHOTO_SECTIONS);
  });

  it("does not mutate the sections it was handed", () => {
    const input = [sec("A", ["a"]), sec("B", ["b"])];
    consolidateReportSections(input, { photosPerPage: 4 });
    expect(input).toHaveLength(2);
    expect(input[0].photos).toEqual(["a"]);
    expect(input[0].body).toBe("");
  });

  it("survives an empty report", () => {
    expect(consolidateReportSections([], { photosPerPage: 2 })).toEqual([]);
  });
});
