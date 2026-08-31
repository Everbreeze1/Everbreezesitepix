import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applySummary,
  failureLines,
  filterBlueprints,
  landedLines,
  landedTotal,
  OUTCOME,
  planWarning,
  provenanceWarning,
  sortedBlueprints,
  type ApplyResult,
  type BlueprintOption,
} from "../apps/mobile/src/api/blueprints-view";

/*
 * Applying a blueprint to a job.
 *
 * A blueprint bundles the checklists, workflows, documents, draft reports, shot
 * lists and label sets a company uses for one kind of job, and applying it
 * creates all of them at once.
 *
 * Most of what is tested here is wording, and that is not a lightweight thing:
 * the web version was rebuilt because "I don't know what happens when I select
 * a template" was a fair complaint. Naming the template type does not answer it.
 * Naming the tab the result lands in does.
 */

const result = (over: Partial<ApplyResult>): ApplyResult => ({
  counts: {},
  failed: [],
  ledgerRecorded: true,
  originTagged: true,
  ...over,
});

describe("landedLines", () => {
  it("names the tab each thing landed in, not the template type", () => {
    const lines = landedLines({ checklists: 2, workflows: 1 });
    expect(lines).toEqual(["2 checklists in Checklists", "1 workflow in Workflows"]);
  });

  it("gets the singular right", () => {
    expect(landedLines({ checklists: 1 })).toEqual(["1 checklist in Checklists"]);
  });

  it("sends reports to Reports, not Documents", () => {
    /*
     * Reports are workspace-level rather than a project tab. Saying "Documents"
     * sent people to a tab that would never show them, which is the exact class
     * of bug this wording exists to avoid.
     */
    expect(landedLines({ reports: 1 })[0]).toContain("in Reports");
    expect(landedLines({ reports: 1 })[0]).not.toContain("Documents");
  });

  it("reads label sets by their wire key and prints them readably", () => {
    /*
     * The bug this is here for, verbatim from the web's own history: the
     * service counts label sets under `label_sets`, the readable plural is
     * "label sets", the lookup matched on the plural, missed, and the screen
     * printed "1 label_sets". A display string and a wire key have no reason to
     * agree, so they are separate fields.
     */
    const lines = landedLines({ label_sets: 1 });
    expect(lines).toEqual(["1 label set in Project labels"]);
    expect(lines[0]).not.toContain("label_sets");
  });

  it("calls a walkthrough a shot list, which is what lands", () => {
    // The wire key is `walkthroughs`; what a crew sees is a run of capture
    // steps in the Workflows tab.
    expect(landedLines({ walkthroughs: 2 })).toEqual(["2 shot lists in Workflows"]);
  });

  it("skips anything that did not land", () => {
    expect(landedLines({ checklists: 0, workflows: 3 })).toEqual(["3 workflows in Workflows"]);
    expect(landedLines({})).toEqual([]);
  });

  it("ignores a key the phone does not know", () => {
    // The server could add a kind before the phone learns to name it. Better to
    // omit a line than to print a raw wire key at somebody.
    expect(landedLines({ gadgets: 4 })).toEqual([]);
  });

  it("is in a fixed order regardless of key order", () => {
    // Object key order follows insertion, and the server builds `counts` fresh
    // each call. A result screen that reorders between two applies looks broken.
    const a = landedLines({ workflows: 1, checklists: 1 });
    const b = landedLines({ checklists: 1, workflows: 1 });
    expect(a).toEqual(b);
  });
});

describe("landedTotal", () => {
  it("adds up only the keys it knows", () => {
    expect(landedTotal({ checklists: 2, workflows: 1, gadgets: 9 })).toBe(3);
    expect(landedTotal({})).toBe(0);
  });
});

describe("applySummary", () => {
  it("counts what landed", () => {
    expect(applySummary(result({ counts: { checklists: 2, workflows: 1 } }))).toBe(
      "3 items added to this job.",
    );
    expect(applySummary(result({ counts: { checklists: 1 } }))).toBe("1 item added to this job.");
  });

  it("says so when a blueprint was empty, rather than just saying Done", () => {
    /*
     * A real outcome, not an error: a blueprint whose items have all been
     * archived applies cleanly and creates nothing. "Done" over an empty list
     * leaves somebody hunting the project for things that were never made.
     */
    expect(applySummary(result({}))).toContain("nothing was added");
  });

  it("mentions the failures in the headline", () => {
    const summary = applySummary(
      result({ counts: { checklists: 2 }, failed: [{ kind: "document", reason: "gone" }] }),
    );
    expect(summary).toContain("2 items added");
    expect(summary).toContain("1 could not be");
  });

  it("does not claim success when everything failed", () => {
    const summary = applySummary(result({ failed: [{ kind: "document", reason: "gone" }] }));
    expect(summary).toBe("Nothing could be added.");
  });
});

describe("failureLines", () => {
  it("shows the reason rather than swallowing it", () => {
    /*
     * A partial apply is the normal failure here - a blueprint referencing a
     * document that has since been deleted - and somebody who is not told will
     * assume the whole blueprint is on the job.
     */
    expect(
      failureLines(result({ failed: [{ kind: "document", reason: "no longer exists" }] })),
    ).toEqual(["document: no longer exists"]);
  });

  it("names a label set readably even though the key is not", () => {
    expect(failureLines(result({ failed: [{ kind: "label_sets", reason: "bad" }] }))[0]).toContain(
      "label set:",
    );
  });

  it("falls back to the raw kind rather than dropping a failure", () => {
    // Losing a failure is worse than printing an ugly word for it.
    expect(failureLines(result({ failed: [{ kind: "gadget", reason: "bad" }] }))).toEqual([
      "gadget: bad",
    ]);
  });

  it("is empty when nothing failed", () => {
    expect(failureLines(result({}))).toEqual([]);
  });
});

describe("provenanceWarning", () => {
  it("is silent when everything was recorded", () => {
    expect(provenanceWarning(result({ counts: { checklists: 1 } }))).toBeNull();
  });

  it("warns when the items landed but their origin did not", () => {
    /*
     * The service reports this rather than failing, because the items really
     * were created. Surfacing it is the other half of that decision: it noted
     * that a silent flag nobody reads is the same as no flag at all.
     */
    const warning = provenanceWarning(result({ counts: { checklists: 1 }, originTagged: false }));
    expect(warning).toContain("which blueprint set it up");
  });

  it("warns when the ledger row itself failed", () => {
    expect(
      provenanceWarning(result({ counts: { checklists: 1 }, ledgerRecorded: false })),
    ).toBeTruthy();
  });

  it("says nothing when nothing landed", () => {
    // There is no provenance to lose, and a second warning under "nothing was
    // added" is noise.
    expect(provenanceWarning(result({ originTagged: false }))).toBeNull();
  });
});

describe("sortedBlueprints", () => {
  const option = (over: Partial<BlueprintOption>): BlueprintOption => ({
    id: "b1",
    name: "Blueprint",
    labels: [],
    category: null,
    isDefault: false,
    ...over,
  });

  it("puts the category default first, then alphabetical", () => {
    // A company with one blueprint per job type has marked one for each, and
    // that is the one being reached for nine times out of ten.
    const sorted = sortedBlueprints([
      option({ id: "1", name: "Zeta" }),
      option({ id: "2", name: "Alpha" }),
      option({ id: "3", name: "Mid", isDefault: true }),
    ]);
    expect(sorted.map((o) => o.name)).toEqual(["Mid", "Alpha", "Zeta"]);
  });

  it("does not mutate what it was given", () => {
    const input = [option({ name: "B" }), option({ name: "A" })];
    sortedBlueprints(input);
    expect(input.map((o) => o.name)).toEqual(["B", "A"]);
  });
});

describe("filterBlueprints", () => {
  const all: BlueprintOption[] = [
    { id: "1", name: "Roof survey", labels: ["roofing"], category: "Survey", isDefault: false },
    { id: "2", name: "Boiler swap", labels: [], category: "Install", isDefault: false },
  ];

  it("returns everything for an empty search", () => {
    expect(filterBlueprints(all, "  ")).toHaveLength(2);
  });

  it("matches name, category or label", () => {
    expect(filterBlueprints(all, "roof").map((o) => o.id)).toEqual(["1"]);
    expect(filterBlueprints(all, "install").map((o) => o.id)).toEqual(["2"]);
    expect(filterBlueprints(all, "roofing").map((o) => o.id)).toEqual(["1"]);
  });
});

describe("planWarning", () => {
  it("warns but never locks", () => {
    /*
     * The server gates on `plan === "team" OR is_internal`, and `is_internal` is
     * not in anything the phone can read. A client that refused on plan alone
     * would lock every internal account out of a feature they are entitled to,
     * so this is a badge and the server keeps the actual gate.
     */
    expect(planWarning("team")).toBeNull();
    expect(planWarning("solo")).toBe("Team plan");
    expect(planWarning(null)).toBe("Team plan");
    expect(planWarning(undefined)).toBe("Team plan");
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/blueprints/service.ts"), "utf8");

  it("uses the exact count keys the service reports", () => {
    /*
     * These are not free to rename: they are also persisted into
     * `project_blueprint_applications.counts`, so historical ledger rows carry
     * them. Read from the service rather than trusted.
     */
    const block = service().slice(service().indexOf("const counts: Record<string, number> = {"));
    for (const kind of Object.keys(OUTCOME) as (keyof typeof OUTCOME)[]) {
      expect(block.slice(0, 400), OUTCOME[kind].countsKey).toContain(`${OUTCOME[kind].countsKey}:`);
    }
  });

  it("sends the field names the schema reads", () => {
    const s = service();
    const client = readFileSync(join(process.cwd(), "apps/mobile/src/api/blueprints.ts"), "utf8");
    for (const field of ["blueprintId", "projectId", "projectName", "projectAddress"]) {
      expect(s, `server ${field}`).toContain(field);
      expect(client, `client ${field}`).toContain(field);
    }
  });

  it("keeps the two-step select that a missing migration needs", () => {
    /*
     * PostgREST rejects the whole select over one unknown column, so a database
     * still waiting for 20260908000000 returns NO blueprints rather than
     * degraded ones - the chooser is empty and the person concludes they have
     * none. The web hit this; the phone inherits the fallback.
     */
    const client = readFileSync(join(process.cwd(), "apps/mobile/src/api/blueprints.ts"), "utf8");
    expect(client).toContain("default_for_category");
    expect(client).toContain("if (full.error)");
  });

  it("leaves the plan gate on the server", () => {
    /*
     * The server checks `plan !== "team" && !isInternal`. The phone must not
     * carry a second copy of that, because it cannot see `is_internal` and
     * would lock every internal account out of a feature they are entitled to.
     *
     * Comments are stripped before searching. The first version of this test
     * did not, and failed against the doc comment that explains exactly why the
     * phone does not read that column - it was matching prose, not logic.
     *
     * The lookbehind is not decoration: `tests/invariants.test.ts` forbids the
     * unguarded form, because a naive strip opens a block comment at any
     * slash-star at all, including the one inside `accept="image/*"`, and then
     * runs to the next star-slash deleting everything between. A `not.toContain`
     * over a swallowed region passes, which is the dangerous half.
     */
    expect(service()).toContain("requireTeamPlan");

    const view = readFileSync(
      join(process.cwd(), "apps/mobile/src/api/blueprints-view.ts"),
      "utf8",
    );
    const code = view.replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("is_internal");
    expect(code).not.toContain("isInternal");

    // And the badge stays a badge: a short label, not a sentence that reads as
    // a refusal somebody would take as final.
    expect(planWarning("solo")).toBe("Team plan");

    const screen = readFileSync(
      join(process.cwd(), "apps/mobile/src/ui/ProjectBlueprint.tsx"),
      "utf8",
    );
    // Nothing may disable the chooser on the strength of the plan warning.
    expect(screen).not.toMatch(/disabled=\{[^}]*warning/);
  });
});
