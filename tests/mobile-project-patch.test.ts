import { describe, expect, it } from "vitest";
import {
  archivePatch,
  draftToPatch,
  isSaveableDraft,
  restoreProjectPatch,
  starPatch,
  trashProjectPatch,
  type ProjectDraft,
} from "../apps/mobile/src/api/project-patch";

/*
 * Project edits from the phone.
 *
 * These columns are read by the web project list, the map, report headers and
 * the public share pages, so a shape this app invents is one nothing else can
 * render.
 */

const base: ProjectDraft = {
  name: "20 Charlcote Crescent",
  street: "20 Charlcote Crescent",
  city: "Crewe",
  state: "England",
  zip: "CW2 6UH",
  client_name: "Mrs Patel",
  status: "active",
};

describe("draftToPatch", () => {
  it("trims every field", () => {
    const patch = draftToPatch({ ...base, name: "  Roof works  ", city: "  Crewe  " });
    expect(patch.name).toBe("Roof works");
    expect(patch.city).toBe("Crewe");
  });

  it("turns blank optional fields into null, not empty strings", () => {
    /*
     * The distinction matters downstream. `formatAddress` joins the truthy
     * parts, so a stored "" is invisible there, but anything checking the
     * column directly still counts the project as having a street. Writing null
     * keeps "no address" meaning one thing everywhere.
     */
    const patch = draftToPatch({
      ...base,
      street: "",
      city: "   ",
      state: null,
      zip: "",
      client_name: "  ",
    });
    expect(patch.street).toBeNull();
    expect(patch.city).toBeNull();
    expect(patch.state).toBeNull();
    expect(patch.zip).toBeNull();
    expect(patch.client_name).toBeNull();
  });

  it("carries the status through unchanged", () => {
    expect(draftToPatch({ ...base, status: "on_hold" }).status).toBe("on_hold");
    expect(draftToPatch({ ...base, status: "completed" }).status).toBe("completed");
  });

  it("never writes deleted_at, starred or archived", () => {
    // Editing details must not disturb state the person did not open the sheet
    // to change. A patch carrying `starred: undefined` would be harmless, but
    // one carrying `starred: false` would silently unstar on every save.
    const patch = draftToPatch(base);
    expect("deleted_at" in patch).toBe(false);
    expect("starred" in patch).toBe(false);
    expect("archived" in patch).toBe(false);
  });
});

describe("isSaveableDraft", () => {
  it("requires a name and nothing else", () => {
    expect(isSaveableDraft(base)).toBe(true);
    expect(
      isSaveableDraft({
        name: "Just a name",
        street: null,
        city: null,
        state: null,
        zip: null,
        client_name: null,
        status: "active",
      }),
    ).toBe(true);
  });

  it("rejects a name that is only whitespace", () => {
    // A project with no name is unfindable in a list sorted and searched by it.
    expect(isSaveableDraft({ ...base, name: "" })).toBe(false);
    expect(isSaveableDraft({ ...base, name: "   " })).toBe(false);
  });
});

describe("star and archive", () => {
  it("write only their own column", () => {
    expect(starPatch(true)).toEqual({ starred: true });
    expect(starPatch(false)).toEqual({ starred: false });
    expect(archivePatch(true)).toEqual({ archived: true });
  });

  it("keeps archive separate from trash", () => {
    /*
     * An archived project is finished and filed; a trashed one is on its way to
     * being deleted. The web list filters them separately, so merging the two
     * would make an archive from the phone read as a deletion everywhere else.
     */
    expect("deleted_at" in archivePatch(true)).toBe(false);
    expect("archived" in trashProjectPatch()).toBe(false);
  });
});

describe("trash and restore", () => {
  it("trashing stamps deleted_at", () => {
    const at = () => new Date("2026-08-28T09:41:07.000Z");
    expect(trashProjectPatch(at)).toEqual({ deleted_at: "2026-08-28T09:41:07.000Z" });
  });

  it("restoring clears it", () => {
    expect(restoreProjectPatch()).toEqual({ deleted_at: null });
  });
});
