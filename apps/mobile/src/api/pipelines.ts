import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { PipelineStage, ProjectBoard, StagedProject } from "./pipeline-view";

/**
 * Pipelines: which stage each job is standing in.
 *
 * Through `/v1/rpc` rather than direct RLS, because `listProjectBoards`
 * resolves the caller's team and attaches each board's stages in one call, and
 * `setProjectPipelineStage` does more than write a column: the stage owns the
 * project's status, so moving a job also moves it between the active, won and
 * lost buckets. Doing that from the client would put a second copy of that rule
 * on the phone.
 *
 * Reading the stage a project is in comes off `projects.pipeline_stage_id`,
 * which the project list already selects nothing of, so this module asks for it
 * separately rather than widening a query five other screens share.
 */

export async function listProjectBoards(): Promise<ProjectBoard[]> {
  const result = await api.rpc<{ boards?: ProjectBoard[] }>("listProjectBoards");
  return result?.boards ?? [];
}

/**
 * Move a project, or take it off the board entirely.
 *
 * `null` is a real argument and means "not in a pipeline". Without it the only
 * way off a board would be to delete the board, which is why the web version
 * grew the same nullable parameter.
 */
export async function setProjectStage(projectId: string, stageId: string | null): Promise<void> {
  await api.rpc("setProjectPipelineStage", { projectId, stageId });
}

/**
 * Projects, with the one extra column a pipeline needs.
 *
 * Its own query rather than widening `PROJECT_FIELDS` in `projects.ts`, which
 * five other screens share: the project list, the gallery filter, the map, the
 * capture picker and Home all pay for every column added there, and none of
 * them has any use for a stage id.
 *
 * Archived jobs are excluded. A pipeline is a view of live work, and a column
 * whose count includes jobs nobody is working on is a number that means
 * nothing.
 */
export async function listStagedProjects(): Promise<StagedProject[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, client_name, city, pipeline_stage_id")
    .is("deleted_at", null)
    .not("archived", "is", true)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as StagedProject[]) ?? [];
}

export type { PipelineStage, ProjectBoard, StagedProject };
