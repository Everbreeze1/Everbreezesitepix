/**
 * Domain services + schemas for web createServerFn adapters and mobile RPC.
 * Does not export HTTP handlers (see `@sitepix/api/http`).
 */

export { AuthError, requireAuthedContext } from "./lib/user-context";
export type { AuthedContext, ServiceContext } from "./lib/user-context";

export { geocodeAddressService, geocodeAddressInputSchema } from "./domains/maps/geocode";
export type { GeocodeAddressInput } from "./domains/maps/geocode";

export {
  synthesizeBreezeSpeechService,
  synthesizeSpeechInputSchema,
} from "./domains/tts/synthesize";
export type { SynthesizeSpeechInput, SynthesizeSpeechResult } from "./domains/tts/synthesize";

export {
  listPhotoCommentsService,
  getPhotoCommentService,
  createPhotoCommentService,
  deletePhotoCommentService,
  listPhotoCommentsInputSchema,
  getPhotoCommentInputSchema,
  createPhotoCommentInputSchema,
  deletePhotoCommentInputSchema,
} from "./domains/photos/comments";
export type { PhotoComment } from "./domains/photos/comments";

export {
  createPhotoShareService,
  listPhotoSharesService,
  revokePhotoShareService,
  getPublicPhotoShareService,
  createPhotoShareInputSchema,
  listPhotoSharesInputSchema,
  revokePhotoShareInputSchema,
  publicPhotoShareInputSchema,
} from "./domains/photos/shares";
export type { PublicPhotoShare } from "./domains/photos/shares";

export {
  TRASH_RETENTION_DAYS,
  listTrashedPhotosService,
  restorePhotosService,
  purgePhotosService,
  listTrashedProjectsService,
  softDeleteProjectService,
  restoreProjectService,
  purgeProjectService,
  getTrashCountsService,
  listTrashedPhotosInputSchema,
  restorePhotosInputSchema,
  purgePhotosInputSchema,
  softDeleteProjectInputSchema,
  restoreProjectInputSchema,
  purgeProjectInputSchema,
} from "./domains/trash/service";

export { combineProjectsService, combineProjectsInputSchema } from "./domains/projects/actions";

export {
  getPublicProjectReportService,
  publicProjectReportInputSchema,
} from "./domains/reports/public-get";
export type {
  PublicProjectReport,
  PublicReportPhoto,
  PublicReportSection,
} from "./domains/reports/public-get";

export {
  generateSiteLogPdfService,
  generateSiteLogPdfInputSchema,
} from "./domains/reports/site-log-pdf";
export type { GenerateSiteLogPdfInput } from "./domains/reports/site-log-pdf";

export { rpcRegistry, PUBLIC_RPC_OPS, rpcBodySchema } from "./domains/rpc/registry";

export {
  chatEndpoint,
  transcriptionEndpoint,
  GEMINI_FLASH_MODEL,
  isUsingCustomGemini,
} from "./lib/ai-provider";

export {
  analyzePhotoService,
  chatWithAssistantService,
  summarizePhotosReportService,
  describeSiteLogPhotosService,
  summarizeWalkthroughsReportService,
  extractPhotoTextService,
} from "./domains/ai/service";

export {
  getMyTeamService,
  createTeamService,
  inviteMemberService,
  revokeInviteService,
  removeMemberService,
  updateMemberRoleService,
  leaveTeamService,
  lookupInviteService,
  acceptInviteService,
  acceptInviteSignupService,
  resendInviteService,
  getTeamActivityService,
  getProjectContributorsService,
} from "./domains/teams/service";
export type {
  TeamMemberContribution,
  TeamActivityKind,
  TeamActivityItem,
  ProjectContributor,
} from "./domains/teams/service";

export {
  createCheckoutSessionService,
  createBillingPortalSessionService,
} from "./domains/billing/service";

export {
  listProjectGroupsService,
  getProjectGroupService,
  createProjectGroupService,
  updateProjectGroupService,
  deleteProjectGroupService,
  setGroupProjectsService,
  addProjectToGroupService,
} from "./domains/projects/groups";

export {
  createWalkthroughSessionService,
  saveWalkthroughPhotoService,
  finishWalkthroughSessionService,
  ensureWalkthroughPhotoLinksService,
  updateWalkthroughVideoPathService,
  setWalkthroughStatusService,
  listProjectWalkthroughsService,
  transcribeWalkthroughService,
  generateWalkthroughReportService,
  setWalkthroughShareService,
  getPublicWalkthroughService,
  createReportFromWalkthroughService,
  generateWalkthroughSummaryService,
  regenerateWalkthroughSummaryService,
} from "./domains/walkthroughs/service";

export {
  listNotificationsService,
  getUnreadNotificationCountService,
  markNotificationReadService,
  markAllNotificationsReadService,
  insertNotification,
  listNotificationsInputSchema,
  markNotificationReadInputSchema,
} from "./domains/notifications/service";
export type { Notification } from "./domains/notifications/service";
