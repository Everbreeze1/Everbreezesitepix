/**
 * Reading a pipeline on a phone.
 *
 * Import-free so the bucketing is tested. The rules are small but two of them
 * matter more than they look:
 *
 * A project with no stage is not a project in the first column. `NULL` on
 * `projects.pipeline_stage_id` means "not in a pipeline", which is a different
 * thing from "at the start of one", and folding the two together would silently
 * pull every job in the workspace onto whichever board somebody opened.
 *
 * And a stage is exclusive. That is the whole point of the migration that
 * introduced it: `project_boards.tag_ids` made a column a tag, tags are
 * many-per-project, and a job could appear in three columns at once. The data
 * enforces one now, and nothing here may reintroduce the old behaviour.
 */

export type ProjectStatus = string;

export type PipelineStage = {
  id: string;
  board_id: string;
  name: string;
  color: string;
  position: number;
  /** Which of the three project buckets a job in this stage counts as. */
  status: ProjectStatus;
};

export type ProjectBoard = {
  id: string;
  name: string;
  stages: PipelineStage[];
  created_by: string;
  created_at: string;
  updated_at: string;
};

/** Anything with a stage on it. */
export type StagedProject = {
  id: string;
  name: string;
  client_name?: string | null;
  city?: string | null;
  pipeline_stage_id?: string | null;
};

/** Stages left to right, as the board would draw them. */
export function orderedStages(board: Pick<ProjectBoard, "stages">): PipelineStage[] {
  return [...(board.stages ?? [])].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    // Same tie-break reason as the template editor: two stages sharing a
    // position would otherwise swap places between renders.
    return a.name.localeCompare(b.name);
  });
}

/**
 * Projects in one stage.
 *
 * Exclusive by construction: a project matches at most one stage id, so no
 * project can be counted twice across the columns of a board.
 */
export function projectsInStage<T extends StagedProject>(projects: T[], stageId: string): T[] {
  return projects.filter((project) => project.pipeline_stage_id === stageId);
}

/**
 * How many jobs stand in each stage.
 *
 * Returned as a map keyed by stage id rather than an array parallel to the
 * stages, because a parallel array silently mismatches the moment a stage is
 * deleted between the two reads.
 */
export function stageCounts(
  projects: StagedProject[],
  stages: PipelineStage[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const stage of stages) counts.set(stage.id, 0);
  for (const project of projects) {
    const id = project.pipeline_stage_id;
    if (!id) continue;
    // Only stages of the board in view. A project on a different board must not
    // add a phantom count here.
    if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
  }
  return counts;
}

/**
 * Projects on no board at all.
 *
 * Offered as a separate list, not as a first column. Somebody opening a
 * pipeline wants to add jobs to it, and this is the list they add from; showing
 * them inside the board would make it look like they were already on it.
 */
export function unstaged<T extends StagedProject>(projects: T[]): T[] {
  return projects.filter((project) => !project.pipeline_stage_id);
}

/**
 * Whether a stage belongs to this board.
 *
 * A project can hold a stage id from a board that was since deleted, or from
 * another board entirely. Rendering it under the current board's header would
 * be a quiet lie about where the job is.
 */
export function stageOnBoard(
  stageId: string | null | undefined,
  board: Pick<ProjectBoard, "stages"> | null,
): PipelineStage | null {
  if (!stageId || !board) return null;
  return (board.stages ?? []).find((stage) => stage.id === stageId) ?? null;
}

/** The line under a board's name. */
export function boardSummary(stageCount: number, projectCount: number): string {
  if (stageCount === 0) return "No stages yet";
  const stages = `${stageCount} stage${stageCount === 1 ? "" : "s"}`;
  return `${stages}, ${projectCount} job${projectCount === 1 ? "" : "s"}`;
}

/** What an empty stage says, rather than showing nothing at all. */
export function emptyStageBody(stageName: string): string {
  return `Nothing is at "${stageName}" right now. Move a job here from another stage, or add one from the jobs not on this pipeline.`;
}

/**
 * The crossover luminance between black text and white text.
 *
 * Not a taste value. WCAG contrast is `(lighter + 0.05) / (darker + 0.05)`, so
 * against white a background scores `1.05 / (L + 0.05)` and against black it
 * scores `(L + 0.05) / 0.05`. Those are equal when `(L + 0.05)^2 = 0.0525`,
 * which is `L = 0.1791`. Above it black wins, below it white does, and picking
 * anything else here means deliberately choosing the lower-contrast option for
 * some range of colours.
 */
const TEXT_CROSSOVER = 0.1791;

/**
 * A readable text colour to put on a stage's colour.
 *
 * Stage colours are chosen freely and run from `#1f2937` to `#fde68a`, so a
 * fixed foreground is unreadable against half of them.
 *
 * Two steps, and skipping either gets colours wrong in opposite directions.
 * The sRGB values are gamma-decoded first, without which every mid-tone reads
 * as brighter than it looks. Then the channels are weighted 0.2126 / 0.7152 /
 * 0.0722, because the eye is far more sensitive to green than to blue: a
 * saturated blue and a saturated green with the same raw average are nowhere
 * near equally bright, and only the weighting tells them apart.
 */
export function readableOn(hex: string): "#ffffff" | "#111827" {
  const value = hex.replace("#", "");
  // The column has a hex CHECK on the server, but an older row or a hand-edit
  // can hold anything, and an unreadable pill beats a crash.
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return "#ffffff";

  const channel = (from: number) => {
    const c = parseInt(value.slice(from, from + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > TEXT_CROSSOVER ? "#111827" : "#ffffff";
}

/**
 * The stage chip's spoken label.
 *
 * Read aloud, the chip was "Scheduled, 1 jobs". The count is almost always
 * small on a pipeline column, so the singular is the common case rather than
 * the edge one, and it is the case that reads wrong.
 *
 * Here rather than inline in the screen so it is covered by a test: the number
 * only says "1" on a workspace that happens to have exactly one job at that
 * stage, which is precisely the state nobody has open when they read the diff.
 */
export function stageCountLabel(stageName: string, count: number): string {
  return `${stageName}, ${count} ${count === 1 ? "job" : "jobs"}`;
}
