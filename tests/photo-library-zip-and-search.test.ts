import { describe, expect, it } from "vitest";
import {
  createNameAllocator,
  photoBaseName,
  photoExtension,
  zipFileName,
} from "../apps/web/src/lib/photo-zip";
import {
  matchingProjectIds,
  photoMatchesSearch,
  photoSearchOrFilter,
} from "../apps/web/src/lib/photo-search";

describe("photo zip names", () => {
  it("never lets two photos share a path, whatever the case", () => {
    const nameFor = createNameAllocator();
    expect(nameFor("Kitchen", "jpg")).toBe("Kitchen.jpg");
    expect(nameFor("kitchen", "jpg")).toBe("kitchen-2.jpg");
    expect(nameFor("Kitchen", "jpg")).toBe("Kitchen-3.jpg");
    expect(nameFor("Kitchen", "png")).toBe("Kitchen.png");
  });

  it("keeps a caption with a slash from becoming a folder", () => {
    expect(photoBaseName({ id: "abcdef123456", caption: "Roof / north side" })).toBe(
      "Roof_north_side",
    );
  });

  it("falls back to the id when there is no usable caption", () => {
    expect(photoBaseName({ id: "abcdef123456", caption: null })).toBe("photo_abcdef12");
    expect(photoBaseName({ id: "abcdef123456", caption: " / " })).toBe("photo_abcdef12");
  });

  it("picks the extension from the downloaded type", () => {
    expect(photoExtension("image/png")).toBe("png");
    expect(photoExtension("image/jpeg; charset=binary")).toBe("jpg");
    expect(photoExtension("")).toBe("jpg");
  });

  it("names the zip after the project, or 'photos' for a mixed selection", () => {
    const day = new Date("2026-09-27T12:00:00Z");
    expect(zipFileName("Smith Roof #2", day)).toBe("Smith_Roof_2-photos-2026-09-27.zip");
    expect(zipFileName(null, day)).toBe("photos-photos-2026-09-27.zip");
  });
});

describe("photo search", () => {
  const projects = [
    { id: "p1", name: "Salgiya", street: "564 Fisher Circle", city: "Austin" },
    { id: "p2", name: "Smith roof", city: "Dallas" },
  ];

  it("matches jobs by name or address", () => {
    expect(matchingProjectIds("fisher", projects)).toEqual(["p1"]);
    expect(matchingProjectIds("  ROOF ", projects)).toEqual(["p2"]);
    expect(matchingProjectIds("", projects)).toEqual([]);
  });

  it("builds a caption-or-project filter", () => {
    expect(photoSearchOrFilter("roof", projects)).toBe("caption.ilike.%roof%,project_id.in.(p2)");
    expect(photoSearchOrFilter("gutter", projects)).toBe("caption.ilike.%gutter%");
    expect(photoSearchOrFilter("   ", projects)).toBeNull();
  });

  it("cannot be split into extra conditions by a comma or parenthesis", () => {
    const filter = photoSearchOrFilter("a,b),id.eq.(x", [])!;
    expect(filter.startsWith("caption.ilike.%")).toBe(true);
    expect(filter).not.toMatch(/[,()]/);
  });

  it("filters the same way on the client", () => {
    const byId = new Map(projects.map((p) => [p.id, p]));
    expect(photoMatchesSearch({ caption: "Gutter damage", project_id: "p2" }, "gutter", byId)).toBe(
      true,
    );
    expect(photoMatchesSearch({ caption: null, project_id: "p1" }, "fisher", byId)).toBe(true);
    expect(photoMatchesSearch({ caption: "Deck", project_id: "p1" }, "roof", byId)).toBe(false);
    expect(photoMatchesSearch({ caption: "Deck", project_id: "p1" }, "", byId)).toBe(true);
  });
});
