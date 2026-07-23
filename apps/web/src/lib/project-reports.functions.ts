import { rpcOp } from "./sitepix-api";
import type { PublicProjectReport, PublicReportPhoto, PublicReportSection } from "@sitepix/api";

export type { PublicProjectReport, PublicReportPhoto, PublicReportSection };

export const getPublicProjectReport = rpcOp<{ token: string }, PublicProjectReport>(
  "getPublicProjectReport",
);
