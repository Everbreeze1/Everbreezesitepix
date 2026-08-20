import { z } from "zod";
import {
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  PROJECT_STATUSES,
  defaultStatusForStageName,
  isProjectStatus,
  normalizePipelineName,
  type ProjectStatus,
} from "@sitepix/shared";
import type { AuthedContext } from "../../lib/user-context";

/**
 * Pipelines: a board plus the stages it owns.
 *
 * A board used to be a saved list of tag ids and nothing else, so a column was
 * a tag and a project appeared in every column whose tag it held. Stages are
 * rows of their own now, and a project points at exactly one of them through
 * `projects.pipeline_stage_id`. See packages/shared/src/pipeline-stages.ts for
 * why, and supabase/migrations/20260917000000_pipeline_stages.sql for how the
 * existing boards were carried across.
 */

export interface PipelineStage {
  id: string;
  board_id: string;
  name: string;
  color: string;
  position: number;
  /**
   * Which of the three project buckets a job standing in this stage counts as.
   * See supabase/migrations/20260922000000_pipeline_stage_status.sql: the stage
   * owns the status, so the map and the project page cannot disagree.
   */
  status: ProjectStatus;
}

export interface ProjectBoard {
  id: string;
  name: string;
  stages: PipelineStage[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

const BOARD_COLS = "id, name, created_by, created_at, updated_at";
const STAGE_COLS = "id, board_id, name, color, position";
const STAGE_COLS_WITH_STATUS = `${STAGE_COLS}, status`;

/**
 * A database that has not had 20260922000000_pipeline_stage_status.sql applied
 * yet still has to serve pipelines.
 *
 * The column is new, and this repo's migrations are applied by hand in the
 * Supabase SQL editor, so there is a window where this build is live and the
 * column is not there. Selecting it in that window would fail the whole read
 * and take the Pipelines tab down, which is a far worse outcome than a stage
 * whose bucket is guessed from its name for an afternoon - and the guess is
 * the same rule the migration seeds with, so nothing changes under the team
 * when it does land.
 */
function mentionsMissingStatusColumn(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? "");
  return /status/i.test(message) && /(column|schema cache)/i.test(message);
}

function withStageStatus(rows: Array<Record<string, any>>): PipelineStage[] {
  return rows.map((r) => ({
    id: r.id,
    board_id: r.board_id,
    name: r.name,
    color: r.color,
    position: r.position,
    status: isProjectStatus(r.status) ? r.status : defaultStatusForStageName(r.name),
  }));
}

/** Runs a stage write, and once more without `status` if the column is absent. */
type WriteResult = { error: { message: string } | null };

async function writeStages(
  rows: Array<Record<string, unknown>>,
  run: (rows: Array<Record<string, unknown>>) => Promise<WriteResult>,
): Promise<WriteResult> {
  const first = await run(rows);
  if (!first.error || !mentionsMissingStatusColumn(first.error)) return first;
  return run(rows.map(({ status: _dropped, ...rest }) => rest));
}

async function myTeamId(ctx: AuthedContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("team_members" as any)
    .select("team_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return (data as any)?.team_id ?? null;
}

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { status: 400 });
}

/** Two stages that read the same are one stage typed twice. */
function assertDistinctStageNames(names: string[]): void {
  const seen = new Set<string>();
  for (const raw of names) {
    const norm = normalizePipelineName(raw);
    if (!norm) throw badRequest("Every stage needs a name.");
    if (seen.has(norm)) throw badRequest(`Two stages are both called "${raw.trim()}".`);
    seen.add(norm);
  }
}

async function stagesFor(ctx: AuthedContext, boardIds: string[]): Promise<PipelineStage[]> {
  if (boardIds.length === 0) return [];
  const read = (cols: string) =>
    (ctx.supabase as any)
      .from("pipeline_stages")
      .select(cols)
      .in("board_id", boardIds)
      .order("position", { ascending: true });

  const withStatus = await read(STAGE_COLS_WITH_STATUS);
  if (!withStatus.error) return withStageStatus((withStatus.data as any[]) ?? []);
  const base = await read(STAGE_COLS);
  return withStageStatus((base.data as any[]) ?? []);
}

async function stageById(ctx: AuthedContext, stageId: string): Promise<PipelineStage | null> {
  const read = (cols: string) =>
    (ctx.supabase as any).from("pipeline_stages").select(cols).eq("id", stageId).maybeSingle();

  const withStatus = await read(STAGE_COLS_WITH_STATUS);
  const row = withStatus.error ? (await read(STAGE_COLS)).data : withStatus.data;
  return row ? withStageStatus([row as Record<string, any>])[0] : null;
}

function attachStages(
  boards: Omit<ProjectBoard, "stages">[],
  stages: PipelineStage[],
): ProjectBoard[] {
  const byBoard = new Map<string, PipelineStage[]>();
  for (const s of stages) {
    const list = byBoard.get(s.board_id);
    if (list) list.push(s);
    else byBoard.set(s.board_id, [s]);
  }
  return boards.map((b) => ({ ...b, stages: byBoard.get(b.id) ?? [] }));
}

async function boardWithStages(ctx: AuthedContext, boardId: string): Promise<ProjectBoard> {
  const { data: row, error } = await (ctx.supabase as any)
    .from("project_boards")
    .select(BOARD_COLS)
    .eq("id", boardId)
    .single();
  if (error) throw badRequest(error.message);
  return attachStages([row as Omit<ProjectBoard, "stages">], await stagesFor(ctx, [boardId]))[0];
}

/**
 * The database refuses a duplicate name too (see the unique index in the
 * migration), but a unique-violation reads as a database error. Ask first so
 * the person gets told which pipeline they already have.
 */
async function assertNameFree(
  ctx: AuthedContext,
  teamId: string,
  name: string,
  exceptBoardId?: string,
): Promise<void> {
  const { data } = await (ctx.supabase as any)
    .from("project_boards")
    .select("id, name")
    .eq("team_id", teamId);
  const target = normalizePipelineName(name);
  const clash = ((data as Array<{ id: string; name: string }>) ?? []).find(
    (b) => b.id !== exceptBoardId && normalizePipelineName(b.name) === target,
  );
  if (clash) {
    throw badRequest(
      `A pipeline called "${clash.name}" already exists. Rename that one, or add stages to it instead of starting a second board.`,
    );
  }
}

export async function listProjectBoardsService(
  ctx: AuthedContext,
): Promise<{ boards: ProjectBoard[] }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) return { boards: [] };
  const { data } = await (ctx.supabase as any)
    .from("project_boards")
    .select(BOARD_COLS)
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  const boards = (data as Omit<ProjectBoard, "stages">[]) ?? [];
  return {
    boards: attachStages(
      boards,
      await stagesFor(
        ctx,
        boards.map((b) => b.id),
      ),
    ),
  };
}

const stageSeedSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Stage colour must be a hex value like #3b82f6"),
  /**
   * Omitted means "guess from the name", which is what an older client that
   * does not know about the field sends, and what a newly typed stage starts
   * at in the editor.
   */
  status: z.enum([...PROJECT_STATUSES] as [ProjectStatus, ...ProjectStatus[]]).optional(),
});

/** The stage as it goes into the table: the bucket resolved, never left blank. */
function stageRow(
  stage: { name: string; color: string; status?: ProjectStatus },
  boardId: string,
  position: number,
): Record<string, unknown> {
  return {
    board_id: boardId,
    name: stage.name.trim(),
    color: stage.color,
    position,
    status: stage.status ?? defaultStatusForStageName(stage.name),
  };
}

export const createProjectBoardInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Omitted means the default Lead/Quoted to Paid set. */
  stages: z.array(stageSeedSchema).min(1).max(MAX_PIPELINE_STAGES).optional(),
});

export async function createProjectBoardService(
  ctx: AuthedContext,
  data: z.infer<typeof createProjectBoardInputSchema>,
): Promise<ProjectBoard> {
  const teamId = await myTeamId(ctx);
  if (!teamId) throw Object.assign(new Error("No team"), { status: 400 });

  const seeds = data.stages ?? DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s }));
  assertDistinctStageNames(seeds.map((s) => s.name));
  await assertNameFree(ctx, teamId, data.name);

  const { data: row, error } = await (ctx.supabase as any)
    .from("project_boards")
    .insert({ team_id: teamId, name: data.name, created_by: ctx.userId })
    .select(BOARD_COLS)
    .single();
  if (error) throw badRequest(error.message);

  const { error: stageError } = await writeStages(
    seeds.map((s, i) => stageRow(s, (row as { id: string }).id, i)),
    (rows) => (ctx.supabase as any).from("pipeline_stages").insert(rows),
  );
  if (stageError) {
    // A pipeline with no columns is not a pipeline. Take the board back out
    // rather than leaving a half-made one on the tab strip.
    await (ctx.supabase as any)
      .from("project_boards")
      .delete()
      .eq("id", (row as { id: string }).id);
    throw badRequest(stageError.message);
  }

  return boardWithStages(ctx, (row as { id: string }).id);
}

/**
 * `stages` is the whole column list, in order, not a patch.
 *
 * A stage carrying an `id` is one that already exists and is being renamed,
 * recoloured or moved. One without is new. Anything the caller left out is
 * deleted, and the projects that were in it fall out of the pipeline
 * (`ON DELETE SET NULL`) rather than being deleted with it.
 */
const stageEditSchema = stageSeedSchema.extend({ id: z.string().uuid().optional() });

export const updateProjectBoardInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  stages: z.array(stageEditSchema).min(1).max(MAX_PIPELINE_STAGES).optional(),
});

export async function updateProjectBoardService(
  ctx: AuthedContext,
  data: z.infer<typeof updateProjectBoardInputSchema>,
): Promise<ProjectBoard> {
  if (data.name !== undefined) {
    const { data: existing } = await (ctx.supabase as any)
      .from("project_boards")
      .select("team_id")
      .eq("id", data.id)
      .maybeSingle();
    const teamId = (existing as { team_id: string } | null)?.team_id;
    if (teamId) await assertNameFree(ctx, teamId, data.name, data.id);

    const { error } = await (ctx.supabase as any)
      .from("project_boards")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw badRequest(error.message);
  }

  if (data.stages !== undefined) {
    assertDistinctStageNames(data.stages.map((s) => s.name));

    const current = await stagesFor(ctx, [data.id]);
    const keptIds = new Set(
      data.stages.map((s) => s.id).filter((id): id is string => typeof id === "string"),
    );
    const removed = current.filter((s) => !keptIds.has(s.id));

    /*
     * Removals go first, and renames pass through a throwaway name.
     *
     * `pipeline_stages_board_normalized_name_key` makes two columns that read
     * the same impossible, which is what stops the duplicate-stage mess. It
     * also means the obvious write order fails on two ordinary edits: adding a
     * stage back under the name of one being deleted, and swapping two stages'
     * names. Both are legitimate, and both collide only because the rows exist
     * at the same instant partway through.
     *
     * Deleting first clears the first case. The temporary name, which is the
     * row's own id and so cannot collide with anything, clears the second.
     */
    if (removed.length) {
      const { error } = await (ctx.supabase as any)
        .from("pipeline_stages")
        .delete()
        .in(
          "id",
          removed.map((s) => s.id),
        );
      if (error) throw badRequest(error.message);
    }

    const currentById = new Map(current.map((s) => [s.id, s]));
    const renamed = data.stages.filter(
      (s) =>
        s.id &&
        currentById.has(s.id) &&
        normalizePipelineName(currentById.get(s.id)!.name) !== normalizePipelineName(s.name),
    );
    const survivingNames = new Set(
      current.filter((s) => keptIds.has(s.id)).map((s) => normalizePipelineName(s.name)),
    );
    const needsTempPass = renamed.some((s) => survivingNames.has(normalizePipelineName(s.name)));
    if (needsTempPass) {
      for (const stage of renamed) {
        const { error } = await (ctx.supabase as any)
          .from("pipeline_stages")
          .update({ name: stage.id })
          .eq("id", stage.id)
          .eq("board_id", data.id);
        if (error) throw badRequest(error.message);
      }
    }

    for (const [i, stage] of data.stages.entries()) {
      const { board_id: _board, ...fields } = stageRow(stage, data.id, i);
      if (stage.id && current.some((c) => c.id === stage.id)) {
        /*
         * Changing what a stage counts as re-stamps the jobs standing in it -
         * that happens in the database (see the pipeline_stages_restamp_projects
         * trigger in 20260922000000_pipeline_stage_status.sql), not here, so a
         * board edited from anywhere lands the same way.
         */
        const { error } = await writeStages([fields], ([row]) =>
          (ctx.supabase as any)
            .from("pipeline_stages")
            .update(row)
            .eq("id", stage.id)
            .eq("board_id", data.id),
        );
        if (error) throw badRequest(error.message);
      } else {
        const { error } = await writeStages([stageRow(stage, data.id, i)], (rows) =>
          (ctx.supabase as any).from("pipeline_stages").insert(rows),
        );
        if (error) throw badRequest(error.message);
      }
    }
  }

  return boardWithStages(ctx, data.id);
}

export const deleteProjectBoardInputSchema = z.object({ id: z.string().uuid() });

export async function deleteProjectBoardService(
  ctx: AuthedContext,
  data: z.infer<typeof deleteProjectBoardInputSchema>,
): Promise<{ ok: true }> {
  const { error } = await (ctx.supabase as any).from("project_boards").delete().eq("id", data.id);
  if (error) throw badRequest(error.message);
  return { ok: true };
}

/**
 * Move one project to one stage, or out of every pipeline with `stageId: null`.
 *
 * This is a single assignment and not an add plus a remove, which is the whole
 * difference from the tag boards it replaces: there is no window in which the
 * project is in two columns, and no failure mode that leaves it in both.
 *
 * The move carries the project's status with it, because the stage owns it: a
 * job dragged to "Paid" stops being an Active green pin on the map in the same
 * write. The database enforces this too, so a move made anywhere else lands
 * identically; it is written here as well so the new status can be returned to
 * the caller without a second read, and so the rule holds on a database that
 * has not had the migration applied yet.
 */
export const setProjectPipelineStageInputSchema = z.object({
  projectId: z.string().uuid(),
  stageId: z.string().uuid().nullable(),
});

export async function setProjectPipelineStageService(
  ctx: AuthedContext,
  data: z.infer<typeof setProjectPipelineStageInputSchema>,
): Promise<{ ok: true; stageId: string | null; status: string | null }> {
  let stage: PipelineStage | null = null;
  if (data.stageId) {
    // RLS already hides other teams' stages from this read, so a miss here is
    // either a deleted stage or somebody else's board.
    const found = await stageById(ctx, data.stageId);
    if (!found) throw badRequest("That stage no longer exists.");
    stage = found;
  }

  const { data: project } = await (ctx.supabase as any)
    .from("projects")
    .select("status")
    .eq("id", data.projectId)
    .maybeSingle();
  const currentStatus = (project as { status?: string } | null)?.status ?? null;

  const patch: Record<string, unknown> = { pipeline_stage_id: data.stageId };
  // Archiving is its own lifecycle. Dragging a card is not a reason to put an
  // archived job back on the active list.
  const nextStatus = stage && currentStatus !== "archived" ? stage.status : currentStatus;
  if (nextStatus !== currentStatus) patch.status = nextStatus;

  const { error } = await (ctx.supabase as any)
    .from("projects")
    .update(patch)
    .eq("id", data.projectId);
  if (error) throw badRequest(error.message);
  return { ok: true, stageId: data.stageId, status: nextStatus };
}
