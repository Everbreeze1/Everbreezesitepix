import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cardColumns,
  embeddedCount,
  groupStrips,
  lastActivityAt,
  photoCountLabel,
  STRIP_SIZE,
  stripOverflow,
} from "../apps/mobile/src/api/project-cards-view";

/*
 * The Projects tab's cards. The owner's note: "the projects list is very
 * simple, it should have some pictures from the project". Each card now leads
 * with the job's newest photos and carries its count, last activity, stage,
 * crew and labels, read for the whole list at once.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("project cards", () => {
  it("counts photos in words", () => {
    expect(photoCountLabel(null)).toBeNull();
    expect(photoCountLabel(0)).toBe("No photos");
    expect(photoCountLabel(1)).toBe("1 photo");
    expect(photoCountLabel(24)).toBe("24 photos");
  });

  it("only claims more photos when the count is known", () => {
    expect(stripOverflow(24, 4)).toBe(20);
    expect(stripOverflow(3, 3)).toBe(0);
    expect(stripOverflow(null, 4)).toBe(0);
  });

  it("dates a job by its newest photo when that is later than its last edit", () => {
    const edit = "2026-09-01T10:00:00Z";
    const photo = "2026-09-20T10:00:00Z";
    expect(lastActivityAt(edit, photo)).toBe(photo);
    expect(lastActivityAt(photo, edit)).toBe(photo);
    expect(lastActivityAt(edit, null)).toBe(edit);
  });

  it("is one column on a phone and a grid on a tablet", () => {
    expect(cardColumns(390)).toBe(1);
    expect(cardColumns(768)).toBe(2);
    expect(cardColumns(1024)).toBe(3);
    expect(cardColumns(1366)).toBe(4);
  });

  it("keeps the newest few per project when rows come back flat", () => {
    const rows = [
      { project_id: "a", id: 1 },
      { project_id: "b", id: 2 },
      { project_id: "a", id: 3 },
      { project_id: "a", id: 4 },
      { project_id: "a", id: 5 },
      { project_id: "a", id: 6 },
    ];
    const grouped = groupStrips(rows);
    expect(grouped.a.map((r) => r.id)).toEqual([1, 3, 4, 5].slice(0, STRIP_SIZE));
    expect(grouped.b.map((r) => r.id)).toEqual([2]);
  });

  it("reads PostgREST's embedded count", () => {
    expect(embeddedCount([{ count: 12 }])).toBe(12);
    expect(embeddedCount([])).toBeNull();
    expect(embeddedCount(null)).toBeNull();
  });

  it("loads the whole list's photos in one read, not one per card", () => {
    const screen = read("apps/mobile/app/(app)/(tabs)/projects.tsx");
    expect(screen).toContain("listProjectCardExtras(projectIds)");
    expect(screen).toContain("<ProjectListCard");
    const api = read("apps/mobile/src/api/project-cards.ts");
    expect(api).toContain('referencedTable: "recent"');
    expect(api).toContain("photos!photos_project_id_fkey(count)");
    const card = read("apps/mobile/src/components/ProjectListCard.tsx");
    expect(card).not.toContain("useQuery");
  });
});
