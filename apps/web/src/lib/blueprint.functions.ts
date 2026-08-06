import { rpcOp } from "./sitepix-api";

export const applyProjectBlueprint = rpcOp<
  {
    blueprintId: string;
    projectId: string;
    projectName: string;
    projectAddress?: string | null;
    preparedBy?: string;
    companyName?: string;
  },
  {
    counts: Record<string, number>;
    /** Items that could not be created. Empty on a fully clean apply. */
    failed: Array<{ kind: string; reason: string }>;
  }
>("applyProjectBlueprint");
