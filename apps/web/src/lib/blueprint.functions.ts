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
  { counts: Record<string, number> }
>("applyProjectBlueprint");
