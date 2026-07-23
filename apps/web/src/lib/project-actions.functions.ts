import { rpcOp } from "./sitepix-api";

/** Combine one project into another (moves children, deletes source). */
export const combineProjects = rpcOp<{ sourceId: string; targetId: string }, unknown>(
  "combineProjects",
);
