import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describeProjects, newProjectName, projectDisplayName } from "@sitepix/shared";

/**
 * The photo bulk-select review, pinned.
 *
 *   "the selection toolbar renders as a floating pill directly on top of the
 *    main site header [...] it visually covers the search bar and fully hides
 *    the notification bell and account menu, so users lose access to global nav
 *    while selecting photos."
 *
 *   "Share gets stuck in a permanent loading spinner with no result, no popup,
 *    and no error - reproduced twice."
 *
 *   "Hide gives zero feedback (no toast, no confirmation, no change in photo
 *    count), so it's unclear whether it's doing anything at all."
 *
 *   "the Move destination picker shows duplicate 'Untitled project' entries [...]
 *    worth fixing at the source rather than in each individual picker."
 *
 * The first three share a root: the bar was `position: fixed` at the top of the
 * viewport, which is where the header lives and also where sonner draws its
 * toasts, so Hide's confirmation was landing behind the very bar that ran it.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const BAR = "apps/web/src/features/photos/components/PhotoBulkActionBar.tsx";
const PROJECT = "apps/web/src/features/projects/pages/ProjectDetailPage.tsx";
const GALLERY = "apps/web/src/features/gallery/pages/GalleryPage.tsx";

describe("the selection bar docks in the content, not over the global header", () => {
  const CODE = stripComments(read(BAR));

  it("is a sticky element in the flow rather than fixed to the viewport", () => {
    expect(CODE).toMatch(/className="sticky top-\[82px\] z-10/);
    // The old shape. `fixed ... top-3` is exactly what put it over the header.
    expect(CODE).not.toMatch(/\bfixed right-0 top-3\b/);
  });

  it("no longer measures the sidebar, because it is inside the content column", () => {
    // The left offset only existed to dodge the rail from a fixed position.
    expect(CODE).not.toContain("useSidebar");
    expect(CODE).not.toContain("barLeftOffset");
  });

  it("sits under the header's stacking order instead of over it", () => {
    const header = read("apps/web/src/components/AppHeader.tsx");
    // If either number moves, the bar starts overlapping global nav again.
    expect(header).toMatch(/sticky top-0 z-20 flex h-\[82px\]/);
    expect(CODE).toMatch(/top-\[82px\] z-10/);
  });

  it("is mounted above the grid in both callers, which a sticky bar requires", () => {
    for (const rel of [PROJECT, GALLERY]) {
      const src = stripComments(read(rel));
      const bar = src.indexOf("<PhotoBulkActionBar");
      const grid = src.indexOf("grid-cols", bar);
      expect(bar).toBeGreaterThan(-1);
      // Mounted after the grid, a sticky element can only stick to the bottom
      // of the page, which is not a toolbar.
      expect(grid).toBeGreaterThan(bar);
    }
  });
});

describe("Share opens the app's own share flow instead of the OS sheet", () => {
  const CODE = stripComments(read(BAR));

  it("does not call the native share sheet, whose promise can never settle", () => {
    expect(CODE).not.toContain("sharePhotoNative");
    // A button with no async work behind it has nothing to hang on.
    expect(CODE).toMatch(/label="Share"[\s\S]{0,160}onClick=\{\(\) => setShareOpen\(true\)\}/);
    expect(CODE).not.toMatch(/busy === "share"/);
  });

  it("mints real photo_shares rows, so a link can be revoked later", () => {
    expect(CODE).toContain("createPhotoShare");
    expect(CODE).toContain("shareUrl");
  });

  it("reuses the single-photo dialog rather than growing a second one", () => {
    expect(CODE).toMatch(/count === 1 \? \(\s*<SharePhotoDialog/);
    expect(read("apps/web/src/features/photos/components/SharePhotoDialog.tsx")).toContain(
      "export const SHARE_DURATIONS",
    );
  });

  it("caps a batch rather than firing one request per photo of a Select all", () => {
    expect(CODE).toContain("SHARE_LINK_LIMIT");
  });
});

describe("the native share helper cannot leave a caller spinning", () => {
  const CODE = stripComments(read("apps/web/src/lib/native-share.ts"));

  it("bounds every navigator.share call", () => {
    expect(CODE).toContain("SHARE_SHEET_TIMEOUT_MS");
    // Both the file share and the URL share go through the guard: one call site
    // each, and no bare await of `.share()` left anywhere.
    const shareCalls = CODE.match(/\.share\(/g) ?? [];
    const guarded = CODE.match(/withTimeout\(\s*\(?navigator/g) ?? [];
    expect(shareCalls.length).toBe(2);
    expect(guarded.length).toBe(2);
    expect(CODE).not.toMatch(/await \(?navigator( as any\))?\.share\(/);
  });

  it("keeps the image fetch inside the browser's user-gesture window", () => {
    expect(CODE).toContain("FETCH_BUDGET_MS");
    expect(CODE).toContain("AbortController");
  });
});

describe("Hide says what it did, and only when it actually did it", () => {
  const CODE = stripComments(read(BAR));

  it("counts the rows the update returned rather than trusting a 204", () => {
    // PostgREST answers an update that matched nothing with success and no
    // error, so a bare update could not tell a hide from a refusal.
    expect(CODE).toMatch(/\.update\(\{ hidden: next \}\)[\s\S]{0,80}\.select\("id"\)/);
    expect(CODE).toMatch(/if \(changed === 0\)/);
  });

  it("explains where hidden photos go, since the grid keeps showing them", () => {
    expect(CODE).toMatch(/drop out of the timeline and calendar/);
  });

  it("offers an undo, which is the feedback a toast alone cannot give", () => {
    expect(CODE).toMatch(/label: "Undo"/);
  });
});

describe("the project Photos tab is as discoverable as the Gallery's", () => {
  const CODE = stripComments(read(PROJECT));

  it("has a Select control, not only a tick box that needs a hover", () => {
    expect(CODE).toContain("photoSelectMode");
    expect(CODE).toMatch(
      /\{photoSelectMode \|\| selectedPhotoIds\.length > 0 \? "Done" : "Select"\}/,
    );
  });

  it("pins the tick boxes open in select mode, for touch where hover never fires", () => {
    expect(CODE).toMatch(/inSelectionMode \? "opacity-100" : "opacity-0"/);
  });

  it("turns select mode off with the selection", () => {
    expect(CODE).toMatch(
      /const clearSelection = \(\) => \{[\s\S]{0,120}setPhotoSelectMode\(false\)/,
    );
  });

  it("reaches the carousel too, not only the grid", () => {
    // The Select pill renders in both views. Without this prop the carousel
    // could only learn about selection after a photo was already ticked, so
    // pressing Select in carousel view did nothing at all.
    expect(CODE).toMatch(/selectMode=\{photoSelectMode\}/);
    const carousel = stripComments(
      read("apps/web/src/features/projects/components/PhotoCarousel.tsx"),
    );
    expect(carousel).toMatch(/const inSelectionMode = selectMode \|\| selSet\.size > 0/);
    expect(carousel).toMatch(/inSelectionMode \? "opacity-100" : "opacity-0"/);
  });

  it("drops photos from the selection once a filter hides them", () => {
    // Otherwise Hide and Trash act on photos the user was never shown. The
    // Gallery has guarded this since its own review; the grid did not.
    expect(CODE).toMatch(/const onScreen = new Set\(filteredPhotos\.map\(\(p\) => p\.id\)\)/);
  });

  it("lets Escape leave select mode, but not through an open dialog", () => {
    expect(CODE).toContain("onEscapeOutsideModals");
  });
});

describe("one Escape does not both close a dialog and clear what is behind it", () => {
  const HELPER = stripComments(read("apps/web/src/lib/modal-layers.ts"));

  /*
   * Measured, not reasoned about. Both grids shipped a guard that read
   * `!modalLayerIsOpen()` from a bubble-phase listener; Radix's DismissableLayer
   * removes its content on the same keypress, also in the bubble phase, so the
   * guard asked whether a dialog was open after the dialog had gone. In a
   * browser: Escape out of the bulk Share dialog cleared the ticked photos,
   * while closing the same dialog by its X button did not.
   */
  it("listens in the capture phase, which is the entire fix", () => {
    expect(HELPER).toMatch(/addEventListener\("keydown", onKey, true\)/);
    expect(HELPER).toMatch(/removeEventListener\("keydown", onKey, true\)/);
  });

  it("still asks the DOM rather than a React flag", () => {
    // A state flag reads back stale: the layer above is already unmounting.
    expect(HELPER).toMatch(/if \(modalLayerIsOpen\(\)\) return;/);
  });

  it("is what both grids use, so neither can drift back to the broken shape", () => {
    for (const rel of [PROJECT, GALLERY]) {
      const src = stripComments(read(rel));
      expect(src).toContain("onEscapeOutsideModals");
      expect(src).not.toMatch(/addEventListener\("keydown"/);
    }
  });
});

describe("no picker prints the same project name twice", () => {
  it("labels a nameless project by something the crew recognises", () => {
    expect(projectDisplayName({ name: "  ", street: "1722 Paola Lane" })).toBe("1722 Paola Lane");
    expect(projectDisplayName({ name: null, client_name: "Neal" })).toBe("Neal");
    expect(projectDisplayName({ project_number: "4471" })).toBe("Job 4471");
    expect(projectDisplayName({})).toBe("Untitled project");
    expect(projectDisplayName(null)).toBe("Untitled project");
  });

  it("leaves a unique row alone, so the hint is not a subtitle on everything", () => {
    const out = describeProjects([{ name: "Neal" }, { name: "Ortiz" }]);
    expect(out.map((o) => o.hint)).toEqual([null, null]);
  });

  it("tells duplicates apart, and never repeats a hint inside one group", () => {
    const out = describeProjects([
      { name: "Untitled project", street: "12 Oak St" },
      { name: "Untitled project", client_name: "Neal" },
      { name: "Untitled project", created_at: "2026-08-21T14:12:00.000Z" },
      { name: "Ortiz" },
    ]);
    expect(out[3].hint).toBeNull();
    const hints = out.slice(0, 3).map((o) => o.hint);
    expect(hints.every(Boolean)).toBe(true);
    expect(new Set(hints).size).toBe(3);
  });

  it("still separates two projects whose only difference is when they were made", () => {
    const out = describeProjects([
      { name: "Untitled project", created_at: "2026-08-21T14:12:00.000Z" },
      { name: "Untitled project", created_at: "2026-08-21T16:40:00.000Z" },
    ]);
    expect(out[0].hint).not.toBe(out[1].hint);
    expect(out[0].hint).toBeTruthy();
    expect(out[1].hint).toBeTruthy();
  });

  it("stamps the fallback at creation, so the duplicates stop being created", () => {
    const a = newProjectName({}, new Date("2026-08-21T14:12:00.000Z"));
    const b = newProjectName({}, new Date("2026-08-21T16:40:00.000Z"));
    expect(a).toContain("Untitled project");
    expect(a).not.toBe(b);
    // Anything the user typed still wins outright.
    expect(newProjectName({ name: " Neal " }, new Date())).toBe("Neal");
    expect(newProjectName({ street: "1722 Paola Lane" }, new Date())).toBe("1722 Paola Lane");
  });

  it("is the only definition of the fallback left in the pickers", () => {
    const pickers = [
      "apps/web/src/features/teams/components/AssignJobsDialog.tsx",
      "apps/web/src/features/teams/components/SubcontractorsPanel.tsx",
      "apps/web/src/features/settings/pages/ReportIssuePage.tsx",
      "apps/web/src/features/projects/pages/NewProjectPage.tsx",
    ];
    for (const rel of pickers) {
      expect(stripComments(read(rel))).not.toContain('"Untitled project"');
    }
  });

  it("gives the Move picker the columns a hint is built from", () => {
    const CODE = stripComments(read(BAR));
    expect(CODE).toContain("describeProjects");
    expect(CODE).toMatch(
      /select\(\s*"id, name, street, city, state, zip, client_name, project_number, created_at"/,
    );
    // Selecting `id, name` alone is what made the rows indistinguishable.
    expect(CODE).not.toMatch(/from\("projects"\)\s*\.select\("id, name"\)/);
  });
});
