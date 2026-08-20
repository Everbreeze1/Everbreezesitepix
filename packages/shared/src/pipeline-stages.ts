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

/**
 * ONE STATUS, NOT TWO.
 *
 * The client, looking at a project header that showed both at once:
 *
 *   "Beside the statuses where Invoiced, Scheduled is, there is another status
 *    also that says complete, Active or onhold. we have to reconcile between
 *    these two statuses. The active onhold status is also on maps."
 *
 * They are right, and the header only made visible what the data already did.
 * `projects.status` is a fixed three-value bucket that the map's pins, the
 * project list's filters and every count on the dashboard are built on.
 * `projects.pipeline_stage_id` is the team's own vocabulary, and it says the
 * same thing in more detail: a job at "Paid" is not a live job, whatever its
 * status column happened to say. Nothing kept the two in step, so a project
 * could read Invoiced on its own page and Active on the map, and both were
 * "right".
 *
 * The reconciliation, which 20260917000000_pipeline_stages.sql deliberately
 * left as a later decision: THE STAGE OWNS THE STATUS. Every stage declares
 * which of the three buckets a project standing in it counts as, moving a
 * project to a stage writes both fields, and the buckets stay exactly what
 * they always were for the map and the filters. A team with no pipeline sets
 * the bucket directly, as before, because for them there is only ever one
 * status to set.
 *
 * See supabase/migrations/20261005000000_pipeline_stage_status.sql, which adds
 * the column, backfills it from these rules and makes the invariant a database
 * trigger rather than a promise the clients keep.
 */
export const PROJECT_STATUSES = ["active", "on_hold", "completed"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
};

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

/**
 * Which bucket a stage counts as before anyone says otherwise.
 *
 * Used in three places that must agree: the migration seeds the new column
 * with the same rules in SQL, the API falls back to it for a database where
 * the migration has not been applied yet, and a stage typed into the editor
 * starts here rather than at a blank choice.
 *
 * The guesses are only a starting point. "Snagging" and "Awaiting parts" mean
 * nothing to a regular expression, which is exactly why the mapping is an
 * editable field per stage instead of a rule hidden in code.
 *
 * Order matters: "On hold" is checked first, because a stage called "Complete
 * - on hold for payment" is a held job.
 */
export function defaultStatusForStageName(name: string): ProjectStatus {
  const n = normalizePipelineName(name);
  if (!n) return "active";
  if (/hold|paused|pause|waiting|awaiting|blocked|snooze|stalled|parked/.test(n)) return "on_hold";
  if (/complete|finished|done|closed|cancelled|canceled|paid|invoiced|handover|delivered/.test(n)) {
    return "completed";
  }
  return "active";
}

/**
 * Names that read as "this job has a day booked", and the ones that only look
 * like they do.
 *
 * The workspace calendar has to answer "what is scheduled this week" across
 * every project, and a stage is free text a team types for itself. Nothing on
 * the row says which column means booked work, so the name is the only signal
 * there is. Same trade-off `defaultStatusForStageName` makes, for the same
 * reason, and like that one it is a starting point rather than a rule: a job
 * carrying a `scheduled_date` is on the calendar whatever its stage is called.
 *
 * The negative list is the half that earns its keep. "Unscheduled", "To
 * schedule" and "Awaiting scheduling" are all ordinary column names, all
 * contain the word, and all mean the queue of jobs that have NO day yet, which
 * is the exact opposite of the question. Matching them would have filled the
 * calendar's scheduled rail with the un-booked backlog.
 */
const NOT_YET_SCHEDULED =
  /unschedul|notschedul|noschedul|toschedul|tobeschedul|needsschedul|awaitingschedul|pendingschedul/;

/** The positive form: a column a job lands in once a day has been agreed. */
const IS_SCHEDULED = /schedul|booked|booking|dispatch|appointment/;

export function isScheduledStageName(name: string): boolean {
  const n = normalizePipelineName(name);
  if (!n) return false;
  if (NOT_YET_SCHEDULED.test(n)) return false;
  return IS_SCHEDULED.test(n);
}

export interface PipelineStageSeed {
  name: string;
  color: string;
  /** Which of the three buckets a project standing in this stage counts as. */
  status: ProjectStatus;
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
  { name: "Lead/Quoted", color: "#64748b", status: "active" },
  { name: "Scheduled", color: "#3b82f6", status: "active" },
  { name: "In Progress", color: "#f59e0b", status: "active" },
  { name: "Completed", color: "#10b981", status: "completed" },
  // Invoiced and Paid are bookkeeping on a job whose work is over. Counting
  // them as live is what put finished jobs back on the map as green pins.
  { name: "Invoiced", color: "#8b5cf6", status: "completed" },
  { name: "Paid", color: "#0f766e", status: "completed" },
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
