import { rpcOp } from "./sitepix-api";

export interface AdminMetrics {
  totalUsers: number;
  totalTeams: number;
  teamsByPlan: { starter: number; pro: number; team: number };
  subscriptions: { active: number; inactive: number };
  totalProjects: number;
  totalPhotos: number;
  signupsLast30Days: Array<{ date: string; count: number }>;
  recentTeams: Array<{
    id: string;
    name: string;
    plan: string;
    subscriptionStatus: string;
    createdAt: string;
  }>;
}

export interface PlatformUser {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  createdAt: string;
  team: { id: string; name: string; plan: string; role: string } | null;
  isPlatformAdmin: boolean;
}

export interface AdminNotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  createdAt: string;
  readAt: string | null;
  recipient: { id: string; name: string | null; email: string | null } | null;
}

export const checkIsPlatformAdmin = rpcOp<undefined, { isAdmin: boolean }>("checkIsPlatformAdmin");

export const getAdminMetrics = rpcOp<undefined, AdminMetrics>("getAdminMetrics");

export const listPlatformUsers = rpcOp<
  { search?: string; cursor?: string; limit?: number },
  { users: PlatformUser[]; nextCursor: string | null }
>("listPlatformUsers");

export const setPlatformAdmin = rpcOp<{ userId: string; isAdmin: boolean }, { ok: true }>(
  "setPlatformAdmin",
);

export const listAllNotifications = rpcOp<
  { cursor?: string; limit?: number },
  { notifications: AdminNotificationRow[]; nextCursor: string | null }
>("listAllNotifications");

export const sendAdminNotification = rpcOp<
  {
    title: string;
    body?: string | null;
    linkPath?: string | null;
    target: { type: "all" } | { type: "team"; teamId: string } | { type: "user"; userId: string };
  },
  { sentTo: number }
>("sendAdminNotification");

export interface PlatformTeam {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  isInternal: boolean;
  memberCount: number;
  projectCount: number;
  photoCount: number;
  storageBytes: number;
  createdAt: string;
  /**
   * The business profile from the account setup wizard, mirroring
   * `PlatformTeam` in apps/api/src/domains/admin/teams.ts. Ids rather than
   * labels - the admin table resolves them through the same packages/shared
   * lists the wizard renders, so relabelling an industry needs no backfill.
   *
   * All null or empty until a company answers, which is itself the number
   * worth knowing: how many signups never told us what they do.
   */
  industry: string | null;
  trades: string[];
  teamSize: string | null;
  projectVolume: string | null;
  goals: string[];
  heardFrom: string | null;
  serviceArea: string | null;
  profileCompletedAt: string | null;
}

/**
 * One company's setup answers, as the detail view reads them.
 *
 * Mirrors `businessProfile` on `PlatformTeamDetail` in
 * apps/api/src/domains/admin/teams.ts. `goals` is the one that earns this
 * panel: it is the only column recording what a customer's actual problem is,
 * and a list-level industry count cannot show it.
 */
export interface PlatformBusinessProfile {
  industry: string | null;
  trades: string[];
  teamSize: string | null;
  projectVolume: string | null;
  goals: string[];
  heardFrom: string | null;
  serviceArea: string | null;
  completedAt: string | null;
}

export interface PlatformTeamDetail {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  businessProfile: PlatformBusinessProfile;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  isInternal: boolean;
  createdAt: string;
  members: Array<{ id: string; fullName: string | null; email: string | null; role: string }>;
  projects: Array<{
    id: string;
    name: string;
    status: string;
    photoCount: number;
    storageBytes: number;
    updatedAt: string;
  }>;
}

export const listPlatformTeams = rpcOp<
  { search?: string; cursor?: string; limit?: number },
  { teams: PlatformTeam[]; nextCursor: string | null }
>("listPlatformTeams");

export const getPlatformTeamDetail = rpcOp<{ teamId: string }, PlatformTeamDetail>(
  "getPlatformTeamDetail",
);

export const syncTeamBilling = rpcOp<
  { teamId: string },
  { subscriptionStatus: string; plan: string }
>("syncTeamBilling");

export interface AdminAuditLogRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string | null; email: string | null } | null;
}

export const listAdminAuditLog = rpcOp<
  { cursor?: string; limit?: number },
  { entries: AdminAuditLogRow[]; nextCursor: string | null }
>("listAdminAuditLog");

// ---------------------------------------------------------------------------
// Feedback triage
//
// Mirrors apps/api/src/domains/admin/feedback.ts. `issue_reports` has been
// collecting in-product feedback since 20260803020000 with nothing on the read
// side, so these are the first callers that table has ever had.
// ---------------------------------------------------------------------------

export const FEEDBACK_STATUSES = ["new", "triaged", "resolved", "dismissed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface FeedbackReport {
  id: string;
  status: string;
  kind: string;
  sentiment: string | null;
  source: string;
  feature: string | null;
  description: string | null;
  url: string | null;
  userAgent: string | null;
  attachments: string[];
  createdAt: string;
  projectId: string | null;
  reporter: { id: string | null; name: string | null; email: string | null };
}

export interface FeedbackSummary {
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  topFeatures: Array<{ feature: string; count: number }>;
}

export const listFeedback = rpcOp<
  {
    status?: FeedbackStatus;
    kind?: "bug" | "idea" | "praise";
    source?: "page" | "prompt";
    feature?: string;
    search?: string;
    cursor?: string;
    limit?: number;
  },
  { reports: FeedbackReport[]; nextCursor: string | null }
>("listFeedback");

export const getFeedbackSummary = rpcOp<undefined, FeedbackSummary>("getFeedbackSummary");

export const setFeedbackStatus = rpcOp<
  { reportIds: string[]; status: FeedbackStatus },
  { updated: number }
>("setFeedbackStatus");

export const replyToFeedback = rpcOp<
  { reportId: string; message: string; status?: FeedbackStatus },
  { ok: true }
>("replyToFeedback");
