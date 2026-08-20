import type { ProjectStatus } from "@sitepix/shared";
import { rpcOp } from "./sitepix-api";

/** One column of a pipeline. Owned by the board, never borrowed from a tag. */
export interface PipelineStage {
  id: string;
  board_id: string;
  name: string;
  color: string;
  position: number;
  /**
   * Which of the three project buckets a job standing in this stage counts as.
   * The stage owns the status: see packages/shared/src/pipeline-stages.ts.
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

/** A stage as the settings sheet edits it: no id yet means "new column". */
export interface PipelineStageInput {
  id?: string;
  name: string;
  color: string;
  status: ProjectStatus;
}

export const listProjectBoards = rpcOp<undefined, { boards: ProjectBoard[] }>("listProjectBoards");

export const createProjectBoard = rpcOp<
  { name: string; stages?: PipelineStageInput[] },
  ProjectBoard
>("createProjectBoard");

/**
 * `stages` is the full column list in display order, not a patch: anything left
 * out is removed, and the projects that were in it fall out of the pipeline
 * rather than being deleted with it.
 */
export const updateProjectBoard = rpcOp<
  { id: string; name?: string; stages?: PipelineStageInput[] },
  ProjectBoard
>("updateProjectBoard");

export const deleteProjectBoard = rpcOp<{ id: string }, { ok: true }>("deleteProjectBoard");

/**
 * The one write a drag makes. One field, one value: unlike the tag boards this
 * replaces, there is no moment where the project is in two columns at once.
 */
export const setProjectPipelineStage = rpcOp<
  { projectId: string; stageId: string | null },
  /**
   * `status` is what the project's bucket became, so a caller can update its
   * own row without a refetch. Null only for a project that has none.
   */
  { ok: true; stageId: string | null; status: ProjectStatus | null }
>("setProjectPipelineStage");
