import { rpcOp } from "./sitepix-api";
import type {
  listProjectGroupsService,
  getProjectGroupService,
  createProjectGroupService,
  updateProjectGroupService,
  deleteProjectGroupService,
  setGroupProjectsService,
  addProjectToGroupService,
} from "@sitepix/api";

/** See walkthroughs.functions.ts - result types are derived, not hand-written. */
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export const listProjectGroups = rpcOp<undefined, Result<typeof listProjectGroupsService>>(
  "listProjectGroups",
);

export const getProjectGroup = rpcOp<{ groupId: string }, Result<typeof getProjectGroupService>>(
  "getProjectGroup",
);

export const createProjectGroup = rpcOp<
  {
    name: string;
    description?: string | null;
    projectIds?: string[];
  },
  Result<typeof createProjectGroupService>
>("createProjectGroup");

export const updateProjectGroup = rpcOp<
  {
    id: string;
    name?: string;
    description?: string | null;
  },
  Result<typeof updateProjectGroupService>
>("updateProjectGroup");

export const deleteProjectGroup = rpcOp<{ id: string }, Result<typeof deleteProjectGroupService>>(
  "deleteProjectGroup",
);

export const setGroupProjects = rpcOp<
  { groupId: string; projectIds: string[] },
  Result<typeof setGroupProjectsService>
>("setGroupProjects");

export const addProjectToGroup = rpcOp<
  { groupId: string; projectId: string },
  Result<typeof addProjectToGroupService>
>("addProjectToGroup");
