import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assignRefusal,
  changeSummary,
  crewName,
  crewSummary,
  hasChanges,
  newlyAssigned,
  sortedRoster,
  toggled,
  unassigned,
  type CrewCandidate,
} from "../apps/mobile/src/api/project-assignees-view";

/*
 * Who is on a job.
 *
 * `project_assignments` has existed all along and `project_assigned` is a
 * notification type the phone already routed; it simply had no way to raise
 * one. Which is backwards for a fact about who is standing on a site.
 *
 * The rule worth testing hard is the diff. Assigning somebody sends them a push
 * notification, so getting it wrong either interrupts a crew that has not
 * changed or silently fails to tell the person who just got the job.
 */

const person = (over: Partial<CrewCandidate>): CrewCandidate => ({
  userId: "u1",
  fullName: "Sam Whitfield",
  email: "sam@site.test",
  avatarUrl: null,
  role: "standard",
  ...over,
});

const SAM = person({ userId: "u-sam", fullName: "Sam Whitfield" });
const ALEX = person({ userId: "u-alex", fullName: "Alex Doyle" });
const BEV = person({ userId: "u-bev", fullName: "Bev Ncube" });
const CREW = [SAM, ALEX, BEV];

describe("toggled", () => {
  it("adds somebody who is not on", () => {
    expect(toggled(["u-sam"], "u-alex")).toEqual(["u-sam", "u-alex"]);
  });

  it("removes somebody who is", () => {
    expect(toggled(["u-sam", "u-alex"], "u-sam")).toEqual(["u-alex"]);
  });

  it("does not mutate what it was given", () => {
    const before = ["u-sam"];
    toggled(before, "u-alex");
    expect(before).toEqual(["u-sam"]);
  });

  it("keeps the order stable, so the sheet does not reshuffle under a thumb", () => {
    expect(toggled(["u-sam", "u-alex", "u-bev"], "u-alex")).toEqual(["u-sam", "u-bev"]);
  });
});

describe("newlyAssigned", () => {
  /*
   * This has to match what the service does, because the service is what sends
   * the push. It diffs against the existing rows and notifies only the
   * additions.
   */

  it("is the people who were not there before", () => {
    expect(newlyAssigned(["u-sam"], ["u-sam", "u-alex"])).toEqual(["u-alex"]);
  });

  it("is empty when nothing changed", () => {
    // Re-saving the sheet without changing anything must not light up the whole
    // crew's phones again.
    expect(newlyAssigned(["u-sam", "u-alex"], ["u-alex", "u-sam"])).toEqual([]);
  });

  it("is empty when somebody was only removed", () => {
    expect(newlyAssigned(["u-sam", "u-alex"], ["u-sam"])).toEqual([]);
  });

  it("is everybody when the job was unstaffed", () => {
    expect(newlyAssigned([], ["u-sam", "u-alex"])).toEqual(["u-sam", "u-alex"]);
  });
});

describe("unassigned", () => {
  it("is the people who are coming off", () => {
    expect(unassigned(["u-sam", "u-alex"], ["u-sam"])).toEqual(["u-alex"]);
  });

  it("is everybody when the job is being emptied", () => {
    // Empty is a legitimate save: it is how a job is unstaffed.
    expect(unassigned(["u-sam"], [])).toEqual(["u-sam"]);
  });
});

describe("hasChanges", () => {
  it("is false for the same set in a different order", () => {
    /*
     * Order is not meaning here: the server replaces the whole set. Treating a
     * reorder as a change would leave the Save button live on a sheet nobody
     * edited, and then send a write that notifies nobody and changes nothing.
     */
    expect(hasChanges(["u-sam", "u-alex"], ["u-alex", "u-sam"])).toBe(false);
  });

  it("catches an addition, a removal, and a swap", () => {
    expect(hasChanges(["u-sam"], ["u-sam", "u-alex"])).toBe(true);
    expect(hasChanges(["u-sam", "u-alex"], ["u-sam"])).toBe(true);
    // Same size, different people: the case a length check alone would miss.
    expect(hasChanges(["u-sam"], ["u-alex"])).toBe(true);
  });

  it("is false for two empty crews", () => {
    expect(hasChanges([], [])).toBe(false);
  });
});

describe("sortedRoster", () => {
  it("puts the current crew first, alphabetically within each group", () => {
    // Reopening the sheet should show the crew without scrolling, which on a
    // roster of thirty is the difference between glancing and hunting.
    const sorted = sortedRoster(CREW, ["u-bev"]);
    expect(sorted.map((p) => p.userId)).toEqual(["u-bev", "u-alex", "u-sam"]);
  });

  it("is plain alphabetical when nobody is assigned", () => {
    expect(sortedRoster(CREW, []).map((p) => p.fullName)).toEqual([
      "Alex Doyle",
      "Bev Ncube",
      "Sam Whitfield",
    ]);
  });

  it("does not mutate the roster it was given", () => {
    const original = [...CREW];
    sortedRoster(CREW, ["u-bev"]);
    expect(CREW).toEqual(original);
  });

  it("sorts somebody with no name by their fallback label", () => {
    const anon = person({ userId: "u-anon", fullName: null, email: "aaa@site.test" });
    expect(sortedRoster([SAM, anon], []).map((p) => p.userId)).toEqual(["u-anon", "u-sam"]);
  });
});

describe("crewSummary", () => {
  it("names one or two, then counts the rest", () => {
    // "Sam and Alex" tells a foreman what a count does not.
    expect(crewSummary(CREW, [])).toBe("Nobody assigned");
    expect(crewSummary(CREW, ["u-sam"])).toBe("Sam Whitfield");
    expect(crewSummary(CREW, ["u-sam", "u-alex"])).toBe("Sam Whitfield and Alex Doyle");
    expect(crewSummary(CREW, ["u-sam", "u-alex", "u-bev"])).toBe(
      "Sam Whitfield, Alex Doyle and 1 more",
    );
  });

  it("skips an id with nobody behind it rather than printing a blank", () => {
    /*
     * Reachable: somebody assigned to a job then removed from the team leaves
     * an id the roster no longer explains. Printing "Sam, and 1 more" for a
     * ghost is worse than not counting them.
     */
    expect(crewSummary(CREW, ["u-sam", "u-ghost"])).toBe("Sam Whitfield");
  });

  it("says nobody rather than crashing on an empty roster", () => {
    expect(crewSummary([], ["u-sam"])).toBe("Nobody assigned");
  });
});

describe("crewName", () => {
  it("prefers a name, falls back to an email, then to Teammate", () => {
    expect(crewName({ fullName: "Sam", email: "s@x.test" })).toBe("Sam");
    expect(crewName({ fullName: null, email: "s@x.test" })).toBe("s@x.test");
    expect(crewName({ fullName: "   ", email: null })).toBe("Teammate");
  });
});

describe("assignRefusal", () => {
  it("explains rather than hiding the row", () => {
    /*
     * Deliberate: who is on a job is worth reading even by somebody who cannot
     * change it, and hiding the row from a Restricted member would leave them
     * thinking the job is unstaffed.
     */
    expect(assignRefusal(true)).toBeNull();
    expect(assignRefusal(false)).toContain("not change it");
  });
});

describe("changeSummary", () => {
  it("says nothing when nothing changed", () => {
    expect(changeSummary(CREW, ["u-sam"], ["u-sam"])).toBeNull();
  });

  it("says who will be told, matching who the server actually notifies", () => {
    const summary = changeSummary(CREW, ["u-sam"], ["u-sam", "u-alex"]);
    expect(summary).toContain("Alex Doyle will be told");
    // Sam was already on the job and is not re-notified, so must not appear as
    // somebody about to be told.
    expect(summary).not.toContain("Sam Whitfield will be told");
  });

  it("mentions a removal without promising a notification for it", () => {
    const summary = changeSummary(CREW, ["u-sam", "u-alex"], ["u-sam"]);
    expect(summary).toContain("comes off the job");
    expect(summary).not.toContain("will be told");
  });

  it("covers both halves of a swap", () => {
    const summary = changeSummary(CREW, ["u-sam"], ["u-alex"]);
    expect(summary).toContain("Alex Doyle will be told");
    expect(summary).toContain("Sam Whitfield comes off the job");
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/teams/service.ts"), "utf8");

  it("takes the server's permission answer rather than re-deriving it", () => {
    /*
     * The service returns `canAssign` precisely so the button appears if and
     * only if the write would be accepted. A client working the gate out from
     * the roster would eventually disagree, and the failure mode is a control
     * that looks live and is refused.
     */
    expect(service()).toContain("canAssign: mayAssignCrew(");
    const client = readFileSync(
      join(process.cwd(), "apps/mobile/src/api/project-assignees.ts"),
      "utf8",
    );
    expect(client).toContain("result.canAssign");
    // No local copy of the role list, which is how the two would drift.
    expect(client).not.toContain("mayAssignCrew");
  });

  it("sends the whole set, which is what the service replaces", () => {
    const s = service();
    // Delete-then-insert: an untick is only an instruction if the full set goes.
    expect(s).toContain('.from("project_assignments" as any)\n    .delete()');
    const client = readFileSync(
      join(process.cwd(), "apps/mobile/src/api/project-assignees.ts"),
      "utf8",
    );
    expect(client).toContain("setProjectAssignees");
    expect(client).toContain("userIds");
  });

  it("asks for one project through an op that takes many", () => {
    const client = readFileSync(
      join(process.cwd(), "apps/mobile/src/api/project-assignees.ts"),
      "utf8",
    );
    expect(client).toContain("projectIds: [projectId]");
    expect(service()).toContain("data.projectIds");
  });

  it("relies on the server notifying only the additions", () => {
    // The wording in `changeSummary` promises this, so it had better be true.
    const s = service();
    const at = s.indexOf("setProjectAssigneesService");
    expect(s.slice(at)).toContain("existing");
  });
});
