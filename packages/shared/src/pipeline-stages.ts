/**
 * What a pipeline stage is, and what it is not.
 *
 * A pipeline used to be a saved selection of project tags: each tag became a
 * column, and a project appeared in every column whose tag it carried. Two
 * things were wrong with that, and both are structural rather than cosmetic.
 *
 * A project can hold many tags, so the same job was drawn in three columns of
 * one board at once. A stage is a position, and a job has one position. No
 * amount of UI care makes a many-to-many relation single-select.
 *
 * And because a board was only a list of tag ids, nothing stopped a second
 * board being made from an overlapping list under a near-identical name. Two
 * boards called "Kitchen Remodels" and "kitchen remodel" would each show a
 * different subset of the same work, and neither was wrong.
 *
 * So the stage moved onto the project as one scalar field
 * (`projects.pipeline_stage_id`), and the columns became rows the board owns
 * (`public.pipeline_stages`). Tags stay exactly where they were, doing what
 * they are good at: filtering and search.
 *
 * This module is the single description of the parts both the API and the web
 * app need to agree on: the stage set a new pipeline ships with, and the
 * name-normalising rule that decides when two names are the same name.
 */

export interface PipelineStageSeed {
  name: string;
  color: string;
}

/**
 * The stage set every new pipeline starts with, and the one the migration
 * gives a board whose tags had all been deleted.
 *
 * It is a default and not a fixed list: every one of these can be renamed,
 * recoloured, reordered, removed or added to per board. What cannot change is
 * that a project sits in exactly one of them.
 *
 * Kept in step with the VALUES list in
 * supabase/migrations/20260917000000_pipeline_stages.sql by
 * tests/pipeline-stages.test.ts.
 */
export const DEFAULT_PIPELINE_STAGES: readonly PipelineStageSeed[] = [
  { name: "Lead/Quoted", color: "#64748b" },
  { name: "Scheduled", color: "#3b82f6" },
  { name: "In Progress", color: "#f59e0b" },
  { name: "Completed", color: "#10b981" },
  { name: "Invoiced", color: "#8b5cf6" },
  { name: "Paid", color: "#0f766e" },
];

/** Colour offered to a stage added beyond the defaults, cycled by position. */
export const PIPELINE_STAGE_COLORS: readonly string[] = [
  "#64748b",
  "#3b82f6",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#0f766e",
  "#ec4899",
  "#0ea5e9",
  "#ef4444",
  "#14b8a6",
];

export function nextPipelineStageColor(usedCount: number): string {
  return PIPELINE_STAGE_COLORS[usedCount % PIPELINE_STAGE_COLORS.length];
}

/**
 * Case, spacing and punctuation are not what makes two pipelines different.
 *
 * "Kitchen Remodels", "kitchen remodels" and "Kitchen-Remodels" are one
 * pipeline that somebody typed three ways. This is the rule the unique indexes
 * in the migration use, so the client and the database call the same pairs
 * duplicates.
 */
export function normalizePipelineName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function samePipelineName(a: string, b: string): boolean {
  return normalizePipelineName(a) === normalizePipelineName(b);
}

export const MAX_PIPELINE_STAGES = 20;

/**
 * Why a name is being pushed back on.
 *
 * `duplicate` is refused outright: the database will refuse it too, and a
 * clearer message here beats a unique-violation from Postgres.
 *
 * `tag` and `project` are warnings, not blocks. "Name each pipeline after the
 * process it represents, not a customer, job, or location" is a rule about
 * intent, and intent is not decidable from a string. A pipeline that borrows
 * the name of a tag or of a single job is the exact shape the old tag-boards
 * produced, so it is worth saying out loud, and it is still the person's call.
 */
export type PipelineNameIssue =
  | { kind: "empty" }
  | { kind: "duplicate"; existing: string }
  | { kind: "tag"; existing: string }
  | { kind: "project"; existing: string };

export function pipelineNameIssue(
  name: string,
  context: {
    /** Other pipelines on this team. Exclude the one being renamed. */
    otherPipelineNames: readonly string[];
    tagNames?: readonly string[];
    projectNames?: readonly string[];
  },
): PipelineNameIssue | null {
  const trimmed = name.trim();
  if (!trimmed) return { kind: "empty" };

  const dup = context.otherPipelineNames.find((n) => samePipelineName(n, trimmed));
  if (dup) return { kind: "duplicate", existing: dup };

  const tag = (context.tagNames ?? []).find((n) => samePipelineName(n, trimmed));
  if (tag) return { kind: "tag", existing: tag };

  const project = (context.projectNames ?? []).find((n) => samePipelineName(n, trimmed));
  if (project) return { kind: "project", existing: project };

  return null;
}

/** True when the issue should stop the save rather than just warn about it. */
export function pipelineNameBlocks(issue: PipelineNameIssue | null): boolean {
  return issue?.kind === "empty" || issue?.kind === "duplicate";
}

export function pipelineNameMessage(issue: PipelineNameIssue): string {
  switch (issue.kind) {
    case "empty":
      return "Give the pipeline a name.";
    case "duplicate":
      return `"${issue.existing}" already exists. Rename that one or add stages to it instead of starting a second board.`;
    case "tag":
      return `"${issue.existing}" is a tag. Name a pipeline after the process it runs, like "Install Jobs" or "Service Calls". Ad hoc groupings belong in a tag filter.`;
    case "project":
      return `"${issue.existing}" is a project. A pipeline is the process a job moves through, not one job. Name it after the process.`;
  }
}
