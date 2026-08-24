import { rpcOp } from "./everlumen-api";

/** Combine one project into another (moves children, deletes source). */
export const combineProjects = rpcOp<{ sourceId: string; targetId: string }, unknown>(
  "combineProjects",
);
