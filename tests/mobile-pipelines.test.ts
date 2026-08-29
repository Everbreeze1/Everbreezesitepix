import { describe, expect, it } from "vitest";
import {
  boardSummary,
  emptyStageBody,
  orderedStages,
  projectsInStage,
  readableOn,
  stageCounts,
  stageOnBoard,
  unstaged,
  type PipelineStage,
  type StagedProject,
} from "../apps/mobile/src/api/pipeline-view";

/*
 * Pipelines.
 *
 * The rule under all of this is that **a stage is exclusive**, which is the
 * entire point of 20260917000000_pipeline_stages.sql. The boards it replaced
 * made a column a tag, tags are many-per-project, and a job could stand in
 * three columns at once. Nothing here may reintroduce that, and nothing here
 * may treat "no stage" as "the first stage" either: `NULL` means not in a
 * pipeline, and folding the two together drags every job in the workspace onto
 * whichever board somebody opened.
 */

const stage = (id: string, position: number, over: Partial<PipelineStage> = {}): PipelineStage => ({
  id,
  board_id: "b1",
  name: `Stage ${id}`,
  color: "#3b82f6",
  position,
  status: "active",
  ...over,
});

const project = (id: string, stageId: string | null): StagedProject => ({
  id,
  name: `Job ${id}`,
  client_name: null,
  city: null,
  pipeline_stage_id: stageId,
});

describe("orderedStages", () => {
  it("sorts left to right by position", () => {
    const out = orderedStages({ stages: [stage("c", 2), stage("a", 0), stage("b", 1)] });
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a tie on name so the row does not shuffle between renders", () => {
    const out = orderedStages({
      stages: [stage("z", 1, { name: "Won" }), stage("a", 1, { name: "Assigned" })],
    });
    expect(out.map((s) => s.name)).toEqual(["Assigned", "Won"]);
  });

  it("survives a board with no stages", () => {
    expect(orderedStages({ stages: [] })).toEqual([]);
    expect(orderedStages({ stages: undefined as never })).toEqual([]);
  });
});

describe("projectsInStage", () => {
  const projects = [project("a", "s1"), project("b", "s2"), project("c", null)];

  it("matches exactly one stage", () => {
    expect(projectsInStage(projects, "s1").map((p) => p.id)).toEqual(["a"]);
  });

  it("never puts one job in two stages", () => {
    /*
     * The regression the pipeline_stages migration exists to prevent. A job in
     * s1 must not also appear under s2, whatever else is true of it.
     */
    const inS1 = projectsInStage(projects, "s1");
    const inS2 = projectsInStage(projects, "s2");
    const overlap = inS1.filter((p) => inS2.some((q) => q.id === p.id));
    expect(overlap).toEqual([]);
  });

  it("does not treat a stageless job as being in any stage", () => {
    for (const id of ["s1", "s2"]) {
      expect(projectsInStage(projects, id).some((p) => p.id === "c")).toBe(false);
    }
  });
});

describe("unstaged", () => {
  it("finds the jobs on no board", () => {
    const out = unstaged([project("a", "s1"), project("b", null), project("c", null)]);
    expect(out.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("treats a missing field as unstaged, not as a crash", () => {
    expect(unstaged([{ id: "a", name: "Job a" }])).toHaveLength(1);
  });
});

describe("stageCounts", () => {
  const stages = [stage("s1", 0), stage("s2", 1)];

  it("counts each stage, including the empty ones", () => {
    // An empty stage has to appear with a zero rather than be missing from the
    // map, or its pill renders "undefined".
    const counts = stageCounts([project("a", "s1")], stages);
    expect(counts.get("s1")).toBe(1);
    expect(counts.get("s2")).toBe(0);
  });

  it("ignores a job standing on a different board", () => {
    /*
     * A project can hold a stage id belonging to another board, or to one since
     * deleted. Counting it here would add a phantom to a column it is not in.
     */
    const counts = stageCounts([project("a", "other-board-stage")], stages);
    expect(counts.get("s1")).toBe(0);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("ignores jobs with no stage", () => {
    expect(stageCounts([project("a", null)], stages).get("s1")).toBe(0);
  });
});

describe("stageOnBoard", () => {
  const board = { stages: [stage("s1", 0)] };

  it("finds a stage that belongs here", () => {
    expect(stageOnBoard("s1", board)?.id).toBe("s1");
  });

  it("refuses one that does not, rather than rendering it under this header", () => {
    // A quiet lie about where a job is, otherwise.
    expect(stageOnBoard("s9", board)).toBeNull();
    expect(stageOnBoard(null, board)).toBeNull();
    expect(stageOnBoard("s1", null)).toBeNull();
  });
});

describe("boardSummary", () => {
  it("says what is on the board", () => {
    expect(boardSummary(0, 0)).toBe("No stages yet");
    expect(boardSummary(1, 1)).toBe("1 stage, 1 job");
    expect(boardSummary(4, 12)).toBe("4 stages, 12 jobs");
  });
});

describe("emptyStageBody", () => {
  it("names the stage rather than saying 'this stage'", () => {
    expect(emptyStageBody("Invoiced")).toContain("Invoiced");
  });
});

describe("readableOn", () => {
  it("puts dark text on light stages and light text on dark ones", () => {
    /*
     * Stage colours are chosen freely and run from #1f2937 to #f59e0b, so a
     * fixed foreground is unreadable against half of them.
     */
    expect(readableOn("#f59e0b")).toBe("#111827");
    expect(readableOn("#fde68a")).toBe("#111827");
    expect(readableOn("#1f2937")).toBe("#ffffff");
    expect(readableOn("#b91c1c")).toBe("#ffffff");
  });

  it("gets mid-green right, which the naive average does not", () => {
    // Averaging the channels calls #22c55e dark and puts white on it. Relative
    // luminance weights green at 0.7152 and gets it right.
    expect(readableOn("#22c55e")).toBe("#111827");
  });

  it("copes with a malformed colour rather than throwing", () => {
    // `color` is a text column with a hex CHECK on the server, but an older row
    // or a hand-edit can hold anything.
    expect(readableOn("")).toBe("#ffffff");
    expect(readableOn("#fff")).toBe("#ffffff");
    expect(readableOn("blue")).toBe("#ffffff");
  });

  it("accepts a colour with or without the hash", () => {
    expect(readableOn("f59e0b")).toBe(readableOn("#f59e0b"));
  });
});
