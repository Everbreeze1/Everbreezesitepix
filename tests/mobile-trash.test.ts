import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contentsLabel,
  deleteRefusal,
  deleteWarning,
  isUrgent,
  purgeWarning,
  RETENTION_DAYS,
  sortedByUrgency,
  timeLeftLabel,
  trashSummary,
  type TrashedProject,
} from "../apps/mobile/src/api/trash-view";

/*
 * The workspace trash.
 *
 * The phone had a photo trash inside one job and nothing above it, so a job
 * deleted on the web could not be found from a device, let alone recovered.
 *
 * Everything here is wording, and the wording is the feature: each row is
 * either "you can still get this back" or "this is about to be gone for good",
 * and somebody choosing between them is choosing about a job's entire
 * photographic record.
 */

const project = (over: Partial<TrashedProject>): TrashedProject => ({
  id: "p1",
  name: "Riverside Unit 4",
  description: null,
  location: "12 Mill Lane",
  status: "active",
  deleted_at: "2026-08-01T09:00:00Z",
  days_left: 30,
  photo_count: 340,
  ...over,
});

describe("timeLeftLabel", () => {
  it("counts the days the server says are left", () => {
    /*
     * The server's number, not one recomputed here. The purge job runs on the
     * server's clock, so a phone in another timezone counting for itself would
     * disagree with the thing that actually deletes the data.
     */
    expect(timeLeftLabel(project({ days_left: 30 }))).toBe("30 days left");
    expect(timeLeftLabel(project({ days_left: 1 }))).toBe("1 day left");
  });

  it("says a project is due rather than showing zero", () => {
    // "0 days left" reads as a rendering fault. It is a real state: the purge
    // job simply has not run yet.
    expect(timeLeftLabel(project({ days_left: 0 }))).toBe("Due to be deleted");
  });
});

describe("isUrgent", () => {
  it("marks the last week, and not the whole retention window", () => {
    /*
     * Marking all sixty days urgent makes the marker mean nothing, which is the
     * usual way an urgency signal dies. A week is roughly the span in which
     * somebody might not open the app at all.
     */
    expect(isUrgent(project({ days_left: 7 }))).toBe(true);
    expect(isUrgent(project({ days_left: 8 }))).toBe(false);
    expect(isUrgent(project({ days_left: 0 }))).toBe(true);
  });
});

describe("contentsLabel", () => {
  it("counts the photographs, which is what makes a project matter", () => {
    expect(contentsLabel(project({ photo_count: 340 }))).toBe("340 photos");
    expect(contentsLabel(project({ photo_count: 1 }))).toBe("1 photo");
    expect(contentsLabel(project({ photo_count: 0 }))).toBe("No photos");
  });
});

describe("sortedByUrgency", () => {
  it("puts what is about to disappear first", () => {
    /*
     * Not the server's order, which is newest-deleted first. What somebody
     * opening this screen needs is whatever is about to go, and the job deleted
     * two months ago is more urgent than the one deleted this morning.
     */
    const rows = [
      project({ id: "a", days_left: 40 }),
      project({ id: "b", days_left: 2 }),
      project({ id: "c", days_left: 15 }),
    ];
    expect(sortedByUrgency(rows).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("breaks a tie by name, so the order is stable between renders", () => {
    const rows = [
      project({ id: "a", name: "Zeta", days_left: 5 }),
      project({ id: "b", name: "Alpha", days_left: 5 }),
    ];
    expect(sortedByUrgency(rows).map((p) => p.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("does not mutate what it was given", () => {
    const rows = [project({ id: "a", days_left: 40 }), project({ id: "b", days_left: 2 })];
    sortedByUrgency(rows);
    expect(rows.map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("trashSummary", () => {
  it("says nothing is deleted when nothing is", () => {
    expect(trashSummary([])).toBe("Nothing deleted");
  });

  it("counts, and flags how many are about to go", () => {
    expect(trashSummary([project({})])).toBe("1 deleted project");
    expect(trashSummary([project({ id: "a" }), project({ id: "b", days_left: 3 })])).toBe(
      "2 deleted projects, 1 due to go",
    );
  });
});

describe("purgeWarning", () => {
  it("names the photo count, because that is what is being destroyed", () => {
    /*
     * "Delete Riverside Unit 4" and "Delete Riverside Unit 4 and its 340
     * photographs" are different decisions. The purge removes the storage
     * objects as well as the rows.
     */
    const warning = purgeWarning(project({ photo_count: 340 }));
    expect(warning).toContain("340 photographs");
    expect(warning).toContain("cannot be undone");
  });

  it("does not invent photographs that are not there", () => {
    const warning = purgeWarning(project({ photo_count: 0 }));
    expect(warning).not.toContain("photograph");
    expect(warning).toContain("cannot be undone");
  });

  it("gets the singular right", () => {
    expect(purgeWarning(project({ photo_count: 1 }))).toContain("1 photograph will");
  });
});

describe("deleteWarning", () => {
  it("says the deletion is recoverable, and for how long", () => {
    // The difference between this and the purge warning is the whole point: one
    // is reversible for sixty days and the other is not reversible at all.
    const warning = deleteWarning("Riverside Unit 4");
    expect(warning).toContain(String(RETENTION_DAYS));
    expect(warning).toContain("put it back");
  });
});

describe("deleteRefusal", () => {
  it("explains why a teammate cannot delete a job", () => {
    /*
     * Load-bearing rather than decorative. The server enforces ownership as
     * `eq("owner_id", userId)` on an UPDATE, and an update matching nothing is
     * not an error in PostgREST - the op answers `{ ok: true }` either way. A
     * client that offered the button anyway would report a deletion that never
     * happened.
     */
    expect(deleteRefusal(true)).toBeNull();
    expect(deleteRefusal(false)).toContain("created this job");
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/trash/service.ts"), "utf8");

  it("mirrors the retention window the server actually enforces", () => {
    expect(service()).toContain(`export const TRASH_RETENTION_DAYS = ${RETENTION_DAYS};`);
  });

  it("reads the row fields the service shapes", () => {
    const s = service();
    for (const field of ["days_left:", "photo_count:", "deleted_at:", "location:"]) {
      expect(s, field).toContain(field);
    }
    const view = readFileSync(join(process.cwd(), "apps/mobile/src/api/trash-view.ts"), "utf8");
    for (const field of ["days_left", "photo_count", "deleted_at", "location"]) {
      expect(view, field).toContain(field);
    }
  });

  it("relies on the list being scoped to the caller", () => {
    /*
     * What makes Restore and Delete-for-good safe to offer on every row without
     * an ownership check: the list itself only ever contains projects this
     * account owns, so neither can silently match zero rows.
     */
    const s = service();
    const at = s.indexOf("listTrashedProjectsService");
    expect(s.slice(at, at + 600)).toContain('.eq("owner_id", ctx.userId)');
  });

  it("does not add a second route for trashing a live project", () => {
    /*
     * The project screen already does it through `applyProjectPatch`. Two paths
     * to the same act would mean two different permission behaviours, which is
     * worse than the one wart the existing path has.
     */
    const client = readFileSync(join(process.cwd(), "apps/mobile/src/api/trash.ts"), "utf8");
    expect(client).not.toContain('rpc("softDeleteProject"');
  });
});
