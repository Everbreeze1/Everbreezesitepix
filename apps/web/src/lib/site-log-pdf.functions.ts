import { rpcOp } from "./sitepix-api";
import type { GenerateSiteLogPdfInput, generateSiteLogPdfService } from "@sitepix/api";

/** See walkthroughs.functions.ts — result types are derived, not hand-written. */
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export const generateSiteLogPdf = rpcOp<
  GenerateSiteLogPdfInput,
  Result<typeof generateSiteLogPdfService>
>("generateSiteLogPdf", { idempotent: true });
