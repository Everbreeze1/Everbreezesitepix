import { z } from "zod";
import {
  DEFAULT_PIPELINE_STAGES,
  MAX_PIPELINE_STAGES,
  normalizePipelineName,
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
  const { data } = await (ctx.supabase as any)
    .from("pipeline_stages")
    .select(STAGE_COLS)
    .in("board_id", boardIds)
    .order("position", { ascending: true });
  return (data as PipelineStage[]) ?? [];
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
});

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

  const { error: stageError } = await (ctx.supabase as any).from("pipeline_stages").insert(
    seeds.map((s, i) => ({
      board_id: (row as { id: string }).id,
      name: s.name.trim(),
      color: s.color,
      position: i,
    })),
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
      if (stage.id && current.some((c) => c.id === stage.id)) {
        const { error } = await (ctx.supabase as any)
          .from("pipeline_stages")
          .update({ name: stage.name.trim(), color: stage.color, position: i })
          .eq("id", stage.id)
          .eq("board_id", data.id);
        if (error) throw badRequest(error.message);
      } else {
        const { error } = await (ctx.supabase as any).from("pipeline_stages").insert({
          board_id: data.id,
          name: stage.name.trim(),
          color: stage.color,
          position: i,
        });
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
 */
export const setProjectPipelineStageInputSchema = z.object({
  projectId: z.string().uuid(),
  stageId: z.string().uuid().nullable(),
});

export async function setProjectPipelineStageService(
  ctx: AuthedContext,
  data: z.infer<typeof setProjectPipelineStageInputSchema>,
): Promise<{ ok: true; stageId: string | null }> {
  if (data.stageId) {
    // RLS already hides other teams' stages from this read, so a miss here is
    // either a deleted stage or somebody else's board.
    const { data: stage } = await (ctx.supabase as any)
      .from("pipeline_stages")
      .select("id")
      .eq("id", data.stageId)
      .maybeSingle();
    if (!stage) throw badRequest("That stage no longer exists.");
  }

  const { error } = await (ctx.supabase as any)
    .from("projects")
    .update({ pipeline_stage_id: data.stageId })
    .eq("id", data.projectId);
  if (error) throw badRequest(error.message);
  return { ok: true, stageId: data.stageId };
}
