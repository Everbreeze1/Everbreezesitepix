import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMPTY_PROJECT_FILTERS,
  NO_STAGE,
  activeProjectFilterCount,
  matchesProjectFilters,
  needsProjectFacts,
  projectFilterChips,
  toggleValue,
  withoutProjectFilterChip,
  type ProjectFacts,
  type ProjectFilters,
} from "../apps/mobile/src/api/project-filters-view";

/*
 * The Projects list's advanced filters: the web's Filters popover (Views,
 * Stage, Tags, Labels, People, Date) on the phone, behind the filter button,
 * with the applied ones as removable chips. The matching rules are the web's,
 * and two of them are easy to get backwards: tags are AND, stages are OR.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const facts = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  created_at: "2026-05-10T12:00:00Z",
  completed_at: null,
  updated_at: "2026-06-01T12:00:00Z",
  created_by: "u-creator",
  pipeline_stage_id: null,
  tagIds: [],
  contributorIds: [],
  ...over,
});
const on = (over: Partial<ProjectFilters>): ProjectFilters => ({
  ...EMPTY_PROJECT_FILTERS,
  ...over,
});
const project = { starred: false, labels: ["Lead", "Urgent"], updated_at: "2026-06-01T12:00:00Z" };

describe("matchesProjectFilters", () => {
  it("lets everything through with no refinements", () => {
    expect(matchesProjectFilters(project, facts(), EMPTY_PROJECT_FILTERS)).toBe(true);
  });

  it("starred only", () => {
    expect(matchesProjectFilters(project, facts(), on({ starredOnly: true }))).toBe(false);
    expect(
      matchesProjectFilters({ ...project, starred: true }, facts(), on({ starredOnly: true })),
    ).toBe(true);
  });

  it("matches stages as either, since a job holds one", () => {
    const f = on({ stageIds: ["s1", "s2"] });
    expect(matchesProjectFilters(project, facts({ pipeline_stage_id: "s2" }), f)).toBe(true);
    expect(matchesProjectFilters(project, facts({ pipeline_stage_id: "s3" }), f)).toBe(false);
  });

  it("treats not in a pipeline as its own choice, not the first stage", () => {
    expect(matchesProjectFilters(project, facts(), on({ stageIds: [NO_STAGE] }))).toBe(true);
    expect(matchesProjectFilters(project, facts(), on({ stageIds: ["s1"] }))).toBe(false);
  });

  it("matches tags as all of them", () => {
    const f = on({ tagIds: ["t1", "t2"] });
    expect(matchesProjectFilters(project, facts({ tagIds: ["t1"] }), f)).toBe(false);
    expect(matchesProjectFilters(project, facts({ tagIds: ["t2", "t1", "t3"] }), f)).toBe(true);
  });

  it("matches labels by the any or all switch, ignoring case", () => {
    expect(matchesProjectFilters(project, facts(), on({ labels: ["lead", "Won"] }))).toBe(true);
    expect(
      matchesProjectFilters(project, facts(), on({ labels: ["lead", "Won"], labelMode: "all" })),
    ).toBe(false);
    expect(
      matchesProjectFilters(project, facts(), on({ labels: ["lead", "urgent"], labelMode: "all" })),
    ).toBe(true);
  });

  it("matches people who contributed photos or created the job", () => {
    expect(matchesProjectFilters(project, facts(), on({ people: ["u-creator"] }))).toBe(true);
    expect(
      matchesProjectFilters(project, facts({ contributorIds: ["u-2"] }), on({ people: ["u-2"] })),
    ).toBe(true);
    expect(matchesProjectFilters(project, facts(), on({ people: ["u-9"] }))).toBe(false);
  });

  it("reads Start as created and End as completed, else last activity", () => {
    expect(matchesProjectFilters(project, facts(), on({ from: "2026-05-11" }))).toBe(false);
    expect(matchesProjectFilters(project, facts(), on({ from: "2026-05-01" }))).toBe(true);
    expect(matchesProjectFilters(project, facts(), on({ to: "2026-05-31" }))).toBe(false);
    expect(
      matchesProjectFilters(
        project,
        facts({ completed_at: "2026-05-20T10:00:00Z" }),
        on({ to: "2026-05-31" }),
      ),
    ).toBe(true);
  });

  it("does not empty the list while the facts are loading", () => {
    expect(matchesProjectFilters(project, null, on({ tagIds: ["t1"] }))).toBe(true);
  });
});

describe("the filter bookkeeping", () => {
  it("counts refinements and knows when the facts are needed", () => {
    expect(activeProjectFilterCount(EMPTY_PROJECT_FILTERS)).toBe(0);
    const f = on({ starredOnly: true, stageIds: ["a"], from: "2026-01-01", to: "2026-02-01" });
    expect(activeProjectFilterCount(f)).toBe(3);
    expect(needsProjectFacts(on({ starredOnly: true, labels: ["x"] }))).toBe(false);
    expect(needsProjectFacts(on({ people: ["u"] }))).toBe(true);
  });

  it("toggles a value in and out", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });

  it("names each applied refinement as a chip, and removes one by its key", () => {
    const f = on({
      starredOnly: true,
      stageIds: ["s1", NO_STAGE],
      tagIds: ["t1"],
      labels: ["Lead"],
      people: ["u1"],
      from: "2026-01-01",
    });
    const chips = projectFilterChips(f, {
      stage: () => "Scheduled",
      tag: () => "kitchen",
      person: () => "Sam",
    });
    expect(chips.map((c) => c.label)).toEqual([
      "Starred only",
      "Stage: Scheduled",
      "Stage: Not in a pipeline",
      "Tag: kitchen",
      "Label: Lead",
      "By Sam",
      "From 2026-01-01",
    ]);
    let next = f;
    for (const chip of chips) next = withoutProjectFilterChip(next, chip.key);
    expect(next).toEqual(on({}));
  });
});

describe("the Projects tab wires it up", () => {
  const screen = read("apps/mobile/app/(app)/(tabs)/projects.tsx");
  const sheet = read("apps/mobile/src/components/ProjectFilterSheet.tsx");

  it("opens the filter sheet from the filter button and shows removable chips", () => {
    expect(screen).toContain("<ProjectFilterSheet");
    expect(screen).toContain("<ActiveFilterChips");
    expect(screen).toContain("matchesProjectFilters(");
    expect(sheet).toContain("accessibilityLabel={`Remove filter ${chip.label}`}");
  });

  it("offers every pane the web's Filters popover has", () => {
    for (const pane of ["Views", "Stage", "Tags", "Labels", "People", "Date"]) {
      expect(sheet).toContain(`label: "${pane}"`);
    }
    expect(sheet).toContain('label="Starred only"');
  });

  it("reaches the Schedule from the header", () => {
    expect(screen).toContain('router.push("/schedule")');
  });

  it("reads the same tables the web's filters do", () => {
    const api = read("apps/mobile/src/api/project-filters.ts");
    expect(api).toContain('.from("project_tags").select("project_id, tag:tags(id, name, color)")');
    expect(api).toContain('.from("photos")');
  });
});
