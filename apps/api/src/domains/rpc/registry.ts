import { z } from "zod";
import { AuthError, type ServiceContext } from "../../lib/user-context";
import { geocodeAddressInputSchema, geocodeAddressService } from "../maps/geocode";
import {
  synthesizeBreezeSpeechService,
  synthesizeSpeechInputSchema,
} from "../tts/synthesize";
import {
  createPhotoCommentInputSchema,
  createPhotoCommentService,
  deletePhotoCommentInputSchema,
  deletePhotoCommentService,
  getPhotoCommentInputSchema,
  getPhotoCommentService,
  listPhotoCommentsInputSchema,
  listPhotoCommentsService,
} from "../photos/comments";
import {
  createPhotoShareInputSchema,
  createPhotoShareService,
  getPublicPhotoShareService,
  listPhotoSharesInputSchema,
  listPhotoSharesService,
  publicPhotoShareInputSchema,
  revokePhotoShareInputSchema,
  revokePhotoShareService,
} from "../photos/shares";
import {
  getTrashCountsService,
  listTrashedPhotosInputSchema,
  listTrashedPhotosService,
  listTrashedProjectsService,
  purgePhotosInputSchema,
  purgePhotosService,
  purgeProjectInputSchema,
  purgeProjectService,
  restorePhotosInputSchema,
  restorePhotosService,
  restoreProjectInputSchema,
  restoreProjectService,
  softDeleteProjectInputSchema,
  softDeleteProjectService,
} from "../trash/service";
import { combineProjectsInputSchema, combineProjectsService } from "../projects/actions";
import {
  getPublicProjectReportService,
  publicProjectReportInputSchema,
} from "../reports/public-get";
import {
  generateSiteLogPdfInputSchema,
  generateSiteLogPdfService,
} from "../reports/site-log-pdf";
import {
  analyzePhotoService,
  chatWithAssistantService,
  describeSiteLogPhotosService,
  extractPhotoTextService,
  summarizePhotosReportService,
  summarizeWalkthroughsReportService,
} from "../ai/service";
import {
  acceptInviteService,
  acceptInviteSignupService,
  createTeamService,
  getMyTeamService,
  getProjectContributorsService,
  getTeamActivityService,
  inviteMemberService,
  leaveTeamService,
  lookupInviteService,
  removeMemberService,
  resendInviteService,
  revokeInviteService,
  updateMemberRoleService,
} from "../teams/service";
import {
  createBillingPortalSessionInputSchema,
  createBillingPortalSessionService,
  createCheckoutSessionInputSchema,
  createCheckoutSessionService,
} from "../billing/service";
import {
  applyProjectBlueprintInputSchema,
  applyProjectBlueprintService,
} from "../blueprints/service";
import {
  addProjectToGroupService,
  createProjectGroupService,
  deleteProjectGroupService,
  getProjectGroupService,
  listProjectGroupsService,
  setGroupProjectsService,
  updateProjectGroupService,
} from "../projects/groups";
import {
  createReportFromWalkthroughService,
  createWalkthroughSessionService,
  ensureWalkthroughPhotoLinksService,
  finishWalkthroughSessionService,
  generateWalkthroughReportService,
  getPublicWalkthroughService,
  listProjectWalkthroughsService,
  saveWalkthroughPhotoService,
  setWalkthroughShareService,
  setWalkthroughStatusService,
  transcribeWalkthroughService,
  updateWalkthroughVideoPathService,
} from "../walkthroughs/service";
import {
  getUnreadNotificationCountService,
  listNotificationsInputSchema,
  listNotificationsService,
  markAllNotificationsReadService,
  markNotificationReadInputSchema,
  markNotificationReadService,
} from "../notifications/service";

export type RpcEntry = {
  public?: boolean;
  /** Expensive / side-effecting ops — clients SHOULD send Idempotency-Key. */
  idempotent?: boolean;
  handle: (ctx: ServiceContext | null, data: unknown) => Promise<unknown>;
};

function authed(
  parse: (data: unknown) => unknown,
  service: (ctx: ServiceContext, data: never) => Promise<unknown>,
  opts?: { idempotent?: boolean },
): RpcEntry {
  return {
    idempotent: opts?.idempotent,
    handle: async (ctx, data) => {
      if (!ctx) throw new AuthError("Unauthorized");
      return service(ctx, parse(data) as never);
    },
  };
}

function pub(parse: (data: unknown) => unknown, service: (data: never) => Promise<unknown>): RpcEntry {
  return {
    public: true,
    handle: async (_ctx, data) => service(parse(data) as never),
  };
}

export const rpcRegistry: Record<string, RpcEntry> = {
  geocodeAddress: authed(
    (d) => geocodeAddressInputSchema.parse(d),
    geocodeAddressService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  synthesizeBreezeSpeech: authed(
    (d) => synthesizeSpeechInputSchema.parse(d),
    synthesizeBreezeSpeechService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  listPhotoComments: authed(
    (d) => listPhotoCommentsInputSchema.parse(d),
    listPhotoCommentsService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  getPhotoComment: authed(
    (d) => getPhotoCommentInputSchema.parse(d),
    getPhotoCommentService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  createPhotoComment: authed(
    (d) => createPhotoCommentInputSchema.parse(d),
    createPhotoCommentService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  deletePhotoComment: authed(
    (d) => deletePhotoCommentInputSchema.parse(d),
    deletePhotoCommentService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  createPhotoShare: authed(
    (d) => createPhotoShareInputSchema.parse(d),
    createPhotoShareService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  listPhotoShares: authed(
    (d) => listPhotoSharesInputSchema.parse(d),
    listPhotoSharesService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  revokePhotoShare: authed(
    (d) => revokePhotoShareInputSchema.parse(d),
    revokePhotoShareService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  getPublicPhotoShare: pub(
    (d) => publicPhotoShareInputSchema.parse(d),
    getPublicPhotoShareService as (data: never) => Promise<unknown>,
  ),
  listTrashedPhotos: authed(
    (d) => listTrashedPhotosInputSchema.parse(d),
    listTrashedPhotosService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  restorePhotos: authed(
    (d) => restorePhotosInputSchema.parse(d),
    restorePhotosService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  purgePhotos: authed(
    (d) => purgePhotosInputSchema.parse(d),
    purgePhotosService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  listTrashedProjects: {
    handle: async (ctx) => {
      if (!ctx) throw new AuthError("Unauthorized");
      return listTrashedProjectsService(ctx);
    },
  },
  softDeleteProject: authed(
    (d) => softDeleteProjectInputSchema.parse(d),
    softDeleteProjectService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  restoreProject: authed(
    (d) => restoreProjectInputSchema.parse(d),
    restoreProjectService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  purgeProject: authed(
    (d) => purgeProjectInputSchema.parse(d),
    purgeProjectService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  getTrashCounts: {
    handle: async (ctx) => {
      if (!ctx) throw new AuthError("Unauthorized");
      return getTrashCountsService(ctx);
    },
  },
  combineProjects: authed(
    (d) => combineProjectsInputSchema.parse(d),
    combineProjectsService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  getPublicProjectReport: pub(
    (d) => publicProjectReportInputSchema.parse(d),
    getPublicProjectReportService as (data: never) => Promise<unknown>,
  ),
  generateSiteLogPdf: authed(
    (d) => generateSiteLogPdfInputSchema.parse(d),
    generateSiteLogPdfService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  analyzePhoto: authed(
    (d) => z.object({ photoId: z.string().uuid() }).parse(d),
    analyzePhotoService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  chatWithAssistant: authed(
    (d) =>
      z
        .object({
          conversationId: z.string().uuid().optional(),
          message: z.string().min(1).max(4000),
          photoId: z.string().uuid().optional(),
          title: z.string().max(120).optional(),
        })
        .parse(d),
    chatWithAssistantService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  summarizePhotosReport: authed(
    (d) =>
      z
        .object({
          photoIds: z.array(z.string().uuid()).min(1).max(40),
          title: z.string().max(120).optional(),
        })
        .parse(d),
    summarizePhotosReportService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  describeSiteLogPhotos: authed(
    (d) => z.object({ photoIds: z.array(z.string().uuid()).min(1).max(40) }).parse(d),
    describeSiteLogPhotosService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  summarizeWalkthroughsReport: authed(
    (d) =>
      z
        .object({
          walkthroughIds: z.array(z.string().uuid()).min(1).max(20),
          title: z.string().max(120).optional(),
        })
        .parse(d),
    summarizeWalkthroughsReportService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  extractPhotoText: authed(
    (d) => z.object({ photoId: z.string().uuid() }).parse(d),
    extractPhotoTextService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  getMyTeam: {
    handle: async (ctx) => {
      if (!ctx) throw Object.assign(new Error("Unauthorized"), { status: 401 });
      return getMyTeamService(ctx);
    },
  },
  createTeam: authed(
    (d) => z.object({ name: z.string().trim().min(1).max(80) }).parse(d),
    createTeamService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  createCheckoutSession: authed(
    (d) => createCheckoutSessionInputSchema.parse(d),
    createCheckoutSessionService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  createBillingPortalSession: authed(
    (d) => createBillingPortalSessionInputSchema.parse(d),
    createBillingPortalSessionService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  applyProjectBlueprint: authed(
    (d) => applyProjectBlueprintInputSchema.parse(d),
    applyProjectBlueprintService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  inviteMember: authed(
    (d) =>
      z
        .object({
          email: z.string().trim().toLowerCase().email().max(200),
          role: z.enum(["admin", "member"]).default("member"),
          origin: z.string().url().max(300).optional(),
        })
        .parse(d),
    inviteMemberService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  revokeInvite: authed(
    (d) => z.object({ inviteId: z.string().uuid() }).parse(d),
    revokeInviteService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  removeMember: authed(
    (d) => z.object({ memberId: z.string().uuid() }).parse(d),
    removeMemberService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  updateMemberRole: authed(
    (d) =>
      z
        .object({
          memberId: z.string().uuid(),
          role: z.enum(["admin", "member"]),
        })
        .parse(d),
    updateMemberRoleService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  leaveTeam: {
    handle: async (ctx) => {
      if (!ctx) throw Object.assign(new Error("Unauthorized"), { status: 401 });
      return leaveTeamService(ctx);
    },
  },
  lookupInvite: pub(
    (d) => z.object({ token: z.string().min(10).max(200) }).parse(d),
    lookupInviteService as (data: never) => Promise<unknown>,
  ),
  acceptInvite: authed(
    (d) => z.object({ token: z.string().min(10).max(200) }).parse(d),
    acceptInviteService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  acceptInviteSignup: pub(
    (d) =>
      z
        .object({
          token: z.string().min(10).max(200),
          fullName: z.string().trim().min(1).max(120),
          password: z.string().min(8).max(200),
        })
        .parse(d),
    acceptInviteSignupService as (data: never) => Promise<unknown>,
  ),
  resendInvite: authed(
    (d) =>
      z
        .object({
          inviteId: z.string().uuid(),
          origin: z.string().url().max(300).optional(),
        })
        .parse(d),
    resendInviteService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  getTeamActivity: {
    handle: async (ctx) => {
      if (!ctx) throw Object.assign(new Error("Unauthorized"), { status: 401 });
      return getTeamActivityService(ctx);
    },
  },
  getProjectContributors: authed(
    (d) => z.object({ projectId: z.string().uuid() }).parse(d),
    getProjectContributorsService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  listProjectGroups: {
    handle: async (ctx) => {
      if (!ctx) throw Object.assign(new Error("Unauthorized"), { status: 401 });
      return listProjectGroupsService(ctx);
    },
  },
  getProjectGroup: authed(
    (d) => z.object({ groupId: z.string().uuid() }).parse(d),
    getProjectGroupService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  createProjectGroup: authed(
    (d) =>
      z
        .object({
          name: z.string().trim().min(1).max(120),
          description: z.string().max(500).optional().nullable(),
          projectIds: z.array(z.string().uuid()).optional().default([]),
        })
        .parse(d),
    createProjectGroupService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  updateProjectGroup: authed(
    (d) =>
      z
        .object({
          id: z.string().uuid(),
          name: z.string().trim().min(1).max(120).optional(),
          description: z.string().max(500).nullable().optional(),
        })
        .parse(d),
    updateProjectGroupService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  deleteProjectGroup: authed(
    (d) => z.object({ id: z.string().uuid() }).parse(d),
    deleteProjectGroupService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  setGroupProjects: authed(
    (d) =>
      z
        .object({
          groupId: z.string().uuid(),
          projectIds: z.array(z.string().uuid()),
        })
        .parse(d),
    setGroupProjectsService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  addProjectToGroup: authed(
    (d) =>
      z
        .object({
          groupId: z.string().uuid(),
          projectId: z.string().uuid(),
        })
        .parse(d),
    addProjectToGroupService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  createWalkthroughSession: authed(
    (d) =>
      z
        .object({
          projectId: z.string().uuid(),
          title: z.string().min(1).max(160),
        })
        .parse(d),
    createWalkthroughSessionService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  saveWalkthroughPhoto: authed(
    (d) =>
      z
        .object({
          projectId: z.string().uuid(),
          walkthroughId: z.string().uuid(),
          storagePath: z.string().min(1).max(500),
          sizeBytes: z.number().int().nonnegative(),
          caption: z.string().min(1).max(255),
          offsetSeconds: z.number().int().nonnegative().default(0),
          position: z.number().int().nonnegative().default(0),
          takenAt: z.string().min(1),
          latitude: z.number().nullable().optional(),
          longitude: z.number().nullable().optional(),
        })
        .parse(d),
    saveWalkthroughPhotoService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  finishWalkthroughSession: authed(
    (d) =>
      z
        .object({
          walkthroughId: z.string().uuid(),
          durationSeconds: z.number().int().positive(),
          liveTranscript: z.string().max(100_000).optional(),
        })
        .parse(d),
    finishWalkthroughSessionService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  ensureWalkthroughPhotoLinks: authed(
    (d) =>
      z
        .object({
          walkthroughId: z.string().uuid(),
          photos: z
            .array(
              z.object({
                photoId: z.string().uuid(),
                offsetSeconds: z.number().int().nonnegative().default(0),
                position: z.number().int().nonnegative().default(0),
              }),
            )
            .max(200),
        })
        .parse(d),
    ensureWalkthroughPhotoLinksService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  updateWalkthroughVideoPath: authed(
    (d) =>
      z
        .object({
          walkthroughId: z.string().uuid(),
          videoPath: z.string().min(1).max(500),
          videoMimeType: z.string().min(1).max(100),
        })
        .parse(d),
    updateWalkthroughVideoPathService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  setWalkthroughStatus: authed(
    (d) =>
      z
        .object({
          walkthroughId: z.string().uuid(),
          status: z.enum(["recording", "generating", "ready", "failed"]),
        })
        .parse(d),
    setWalkthroughStatusService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  listProjectWalkthroughs: authed(
    (d) => z.object({ projectId: z.string().uuid() }).parse(d),
    listProjectWalkthroughsService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  transcribeWalkthrough: authed(
    (d) =>
      z
        .object({
          walkthroughId: z.string().uuid(),
          audioBase64: z.string().min(1),
          mimeType: z.string().min(1).max(100),
        })
        .parse(d),
    transcribeWalkthroughService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  generateWalkthroughReport: authed(
    (d) => z.object({ walkthroughId: z.string().uuid() }).parse(d),
    generateWalkthroughReportService as (ctx: ServiceContext, data: never) => Promise<unknown>,
    { idempotent: true },
  ),
  setWalkthroughShare: authed(
    (d) =>
      z
        .object({
          walkthroughId: z.string().uuid(),
          enable: z.boolean(),
        })
        .parse(d),
    setWalkthroughShareService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  getPublicWalkthrough: pub(
    (d) => z.object({ token: z.string().uuid() }).parse(d),
    getPublicWalkthroughService as (data: never) => Promise<unknown>,
  ),
  createReportFromWalkthrough: authed(
    (d) => z.object({ walkthroughId: z.string().uuid() }).parse(d),
    createReportFromWalkthroughService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  listNotifications: authed(
    (d) => listNotificationsInputSchema.parse(d),
    listNotificationsService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  getUnreadNotificationCount: {
    handle: async (ctx) => {
      if (!ctx) throw new AuthError("Unauthorized");
      return getUnreadNotificationCountService(ctx);
    },
  },
  markNotificationRead: authed(
    (d) => markNotificationReadInputSchema.parse(d),
    markNotificationReadService as (ctx: ServiceContext, data: never) => Promise<unknown>,
  ),
  markAllNotificationsRead: {
    handle: async (ctx) => {
      if (!ctx) throw new AuthError("Unauthorized");
      return markAllNotificationsReadService(ctx);
    },
  },
};

export const PUBLIC_RPC_OPS = new Set(
  Object.entries(rpcRegistry)
    .filter(([, entry]) => entry.public)
    .map(([name]) => name),
);

const rpcBodySchema = z.object({
  op: z.string().min(1),
  data: z.unknown().optional(),
});

export { rpcBodySchema };
