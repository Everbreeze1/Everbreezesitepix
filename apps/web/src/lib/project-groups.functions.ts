import { rpcOp } from "./sitepix-api";

export const listProjectGroups = rpcOp<undefined, unknown>("listProjectGroups");

export const getProjectGroup = rpcOp<{ groupId: string }, unknown>("getProjectGroup");

export const createProjectGroup = rpcOp<
  {
    name: string;
    description?: string | null;
    projectIds?: string[];
  },
  unknown
>("createProjectGroup");

export const updateProjectGroup = rpcOp<
  {
    id: string;
    name?: string;
    description?: string | null;
  },
  unknown
>("updateProjectGroup");

export const deleteProjectGroup = rpcOp<{ id: string }, unknown>("deleteProjectGroup");

export const setGroupProjects = rpcOp<{ groupId: string; projectIds: string[] }, unknown>(
  "setGroupProjects",
);

export const addProjectToGroup = rpcOp<{ groupId: string; projectId: string }, unknown>(
  "addProjectToGroup",
);
