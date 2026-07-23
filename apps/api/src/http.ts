/**
 * HTTP handlers for TanStack `/v1/*` and legacy `/api/*` routes.
 * Import from `@sitepix/api/http` in route files — keep out of client graphs.
 */

export type { HealthResponse } from "./domains/health/handler";
export { healthHandler, GET_V1_HEALTH } from "./domains/health/handler";

export { handleAuthSendEmail } from "./domains/email/auth-send";
export { handleFieldReportEmail } from "./domains/email/field-report";
export { fieldReportBodySchema } from "./domains/email/schemas";

export { handlePurgeTrash } from "./domains/hooks/purge-trash";
export { handleArchiveOldPhotos } from "./domains/hooks/archive-old-photos";

export { handleReportPdf } from "./domains/reports/public-pdf";
export { handleWalkthroughPdf } from "./domains/walkthroughs/public-pdf";

export { handleRpc } from "./domains/rpc/handle";
