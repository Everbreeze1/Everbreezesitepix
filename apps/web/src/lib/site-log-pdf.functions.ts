import { rpcOp } from "./sitepix-api";

export const generateSiteLogPdf = rpcOp<unknown, unknown>("generateSiteLogPdf", {
  idempotent: true,
});
