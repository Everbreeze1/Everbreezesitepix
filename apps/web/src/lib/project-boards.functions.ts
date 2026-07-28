import { rpcOp } from "./sitepix-api";

export interface ProjectBoard {
  id: string;
  name: string;
  tag_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const listProjectBoards = rpcOp<undefined, { boards: ProjectBoard[] }>("listProjectBoards");

export const createProjectBoard = rpcOp<{ name: string; tagIds: string[] }, ProjectBoard>(
  "createProjectBoard",
);

export const updateProjectBoard = rpcOp<
  { id: string; name?: string; tagIds?: string[] },
  ProjectBoard
>("updateProjectBoard");

export const deleteProjectBoard = rpcOp<{ id: string }, { ok: true }>("deleteProjectBoard");
