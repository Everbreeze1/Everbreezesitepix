import { rpcOp } from "./everlumen-api";
import type { PublicProjectReport, PublicReportPhoto, PublicReportSection } from "@everlumen/api";

export type { PublicProjectReport, PublicReportPhoto, PublicReportSection };

export const getPublicProjectReport = rpcOp<{ token: string }, PublicProjectReport>(
  "getPublicProjectReport",
);
