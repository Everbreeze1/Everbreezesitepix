import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATTACHED_SECTION_TITLE,
  SAVE_TO_PHONE_LIMIT,
  SHARE_LINK_LIMIT,
  photoDropMessage,
  planPhotoDrop,
  saveToPhoneRefusal,
  savedPhotoFileName,
  sectionPhotosFor,
  shareLinkRefusal,
  shareLinksMessage,
  shareLinksShortfall,
  singleProjectRefusal,
} from "../apps/mobile/src/api/photo-selection-view";

/*
 * The hand-over actions on a photo selection: save to the phone, share links,
 * a report, a document. Every rule is the web bulk bar's, so a selection does
 * the same thing whichever device made it.
 */

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("share links for a selection", () => {
  it("caps at the web's forty links", () => {
    expect(SHARE_LINK_LIMIT).toBe(40);
    expect(shareLinkRefusal(40)).toBeNull();
    expect(shareLinkRefusal(41)).toMatch(/41 separate links/);
    expect(shareLinkRefusal(0)).toMatch(/at least one/);
  });

  it("sends one link per line", () => {
    expect(shareLinksMessage(["https://a/1", "https://a/2"])).toBe("https://a/1\nhttps://a/2");
  });

  it("says when only some links were made", () => {
    expect(shareLinksShortfall(3, 3)).toBeNull();
    expect(shareLinksShortfall(2, 3)).toMatch(/2 of 3/);
    expect(shareLinksShortfall(0, 3)).toMatch(/any/);
  });

  it("mints them with the web's op and terms: no expiry, downloads allowed", () => {
    const src = read("apps/mobile/src/api/photo-selection.ts");
    expect(src).toMatch(/createPhotoShareToken\(id, 0, true\)/);
    expect(src).toMatch(/publicUrl\("photos"/);
  });
});

describe("reports and documents from a selection", () => {
  it("refuses a selection that spans jobs", () => {
    expect(singleProjectRefusal(["p1", "p1"])).toBeNull();
    expect(singleProjectRefusal(["p1", "p2"])).toMatch(/more than one project/);
    expect(singleProjectRefusal([])).toMatch(/at least one/);
  });

  it("files into an existing report as one section, skipping photos already in it", () => {
    const plan = planPhotoDrop(
      [
        { title: "Intro", position: 0, photos: [] },
        { title: "Photos", position: 3, photos: [{ photo_id: "a", caption: "" }] },
      ],
      [
        { id: "a", caption: null },
        { id: "b", caption: "Cracked slab" },
      ],
    );
    expect(plan.fresh.map((p) => p.id)).toEqual(["b"]);
    expect(plan.skipped).toBe(1);
    // A second drop does not collide with the first.
    expect(plan.title).toBe("Photos 2");
    expect(plan.position).toBe(4);
  });

  it("names the first drop Photos and puts it first in an empty report", () => {
    const plan = planPhotoDrop([], [{ id: "a", caption: null }]);
    expect(plan.title).toBe(ATTACHED_SECTION_TITLE);
    expect(plan.position).toBe(0);
  });

  it("cleans filename captions the way the web does", () => {
    expect(sectionPhotosFor([{ id: "a", caption: "IMG_1234.jpg" }])).toEqual([
      { photo_id: "a", caption: "" },
    ]);
    expect(sectionPhotosFor([{ id: "b", caption: "North wall" }])).toEqual([
      { photo_id: "b", caption: "North wall" },
    ]);
  });

  it("reports what was added and what was skipped", () => {
    expect(photoDropMessage(1, 0)).toBe("1 photo added to the report.");
    expect(photoDropMessage(3, 2)).toMatch(/2 were already in it/);
  });

  it("a new report carries the selection in a Photos section, like NewReportDialog", () => {
    const src = read("apps/mobile/src/api/report-builder.ts");
    expect(src).toMatch(/attachPhotos\?: readonly AttachablePhoto\[\]/);
    expect(src).toMatch(/title: ATTACHED_SECTION_TITLE/);
    expect(src).toMatch(/photos: s\.photos/);
  });

  it("the document menu opens with the selection ticked", () => {
    const sheet = read("apps/mobile/src/components/GenerateReportSheet.tsx");
    expect(sheet.match(/initial=\{photoIds\}/g)?.length).toBe(2);
    const handOver = read("apps/mobile/src/components/PhotoHandOver.tsx");
    expect(handOver).toMatch(/photoIds=\{selection\.photos\.map/);
  });
});

describe("save to phone", () => {
  it("runs on iOS through the share sheet, capped per run", () => {
    expect(saveToPhoneRefusal(1, "ios")).toBeNull();
    expect(saveToPhoneRefusal(SAVE_TO_PHONE_LIMIT, "ios")).toBeNull();
    expect(saveToPhoneRefusal(SAVE_TO_PHONE_LIMIT + 1, "ios")).toMatch(/up to/);
  });

  it("says plainly that Android cannot, rather than failing after the tap", () => {
    expect(saveToPhoneRefusal(2, "android")).toMatch(/Android/);
  });

  it("names the downloaded file after the photo, keeping its extension", () => {
    expect(savedPhotoFileName({ id: "0123456789abcdef", storage_path: "u/p/0123.PNG" })).toBe(
      "photo-01234567.png",
    );
    expect(savedPhotoFileName({ id: "abcdefgh12", storage_path: "u/p/raw" })).toBe(
      "photo-abcdefgh.jpg",
    );
  });

  it("downloads originals, not thumbnails", () => {
    const src = read("apps/mobile/src/api/photo-selection.ts");
    expect(src).toMatch(/signPhotoUrls\(\[\.\.\.photos\], false\)/);
  });
});

describe("both photo grids offer the hand-over", () => {
  it("passes the selection to the bulk bar", () => {
    for (const path of [
      "apps/mobile/app/(app)/(tabs)/gallery.tsx",
      "apps/mobile/app/(app)/project/[id]/index.tsx",
    ]) {
      expect(read(path)).toMatch(/handOver=\{/);
    }
  });
});
