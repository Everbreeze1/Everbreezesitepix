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

// ---------------------------------------------------------------------------
// Support console, billing ops, share links, observability, usage
//
// Mirrors apps/api/src/domains/admin/{user-detail,billing,shares,health,usage}.ts.
// ---------------------------------------------------------------------------

export type AdminRole = "support" | "billing" | "superadmin";

export interface PlatformUserDetail {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  createdAt: string;
  isPlatformAdmin: boolean;
  auth: {
    emailConfirmedAt: string | null;
    lastSignInAt: string | null;
    provider: string | null;
    bannedUntil: string | null;
    createdAt: string | null;
  } | null;
  teams: Array<{
    id: string;
    name: string;
    plan: string;
    subscriptionStatus: string;
    role: string;
    isOwner: boolean;
  }>;
  projects: Array<{
    id: string;
    name: string;
    status: string;
    photoCount: number;
    storageBytes: number;
    updatedAt: string;
    deletedAt: string | null;
  }>;
  totals: { projects: number; photos: number; storageBytes: number; feedbackReports: number };
  recentActivity: Array<{
    id: string;
    route: string;
    op: string | null;
    httpStatus: number;
    durationMs: number | null;
    errorCode: string | null;
    createdAt: string;
  }>;
}

export const getPlatformUserDetail = rpcOp<{ userId: string }, PlatformUserDetail>(
  "getPlatformUserDetail",
);

export type UserSupportAction =
  | "send_password_reset"
  | "resend_confirmation"
  | "suspend"
  | "reinstate";

export const runUserSupportAction = rpcOp<
  { userId: string; action: UserSupportAction; reason: string; origin?: string },
  { ok: true; message: string }
>("runUserSupportAction");

export const deletePlatformUser = rpcOp<
  { userId: string; reason: string; confirmEmail: string },
  { ok: true; orphanedProjects: number }
>("deletePlatformUser");

export interface TeamBillingDetail {
  teamId: string;
  plan: string;
  subscriptionStatus: string;
  isInternal: boolean;
  memberLimit: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripe: {
    status: string;
    quantity: number | null;
    currentPeriodEnd: string | null;
    trialEnd: string | null;
    cancelAtPeriodEnd: boolean;
    priceId: string | null;
    unavailableReason?: string;
  } | null;
  invoices: Array<{
    id: string;
    number: string | null;
    status: string | null;
    amountDue: number;
    amountPaid: number;
    currency: string;
    created: string;
    hostedUrl: string | null;
  }>;
}

export const getTeamBilling = rpcOp<{ teamId: string }, TeamBillingDetail>("getTeamBilling");

export const overrideTeamPlan = rpcOp<
  { teamId: string; plan?: "starter" | "pro" | "team"; isInternal?: boolean; reason: string },
  { ok: true; plan: string; isInternal: boolean }
>("overrideTeamPlan");

export const manageTeamSubscription = rpcOp<
  {
    teamId: string;
    action: "cancel_at_period_end" | "resume" | "cancel_now" | "extend_trial";
    trialDays?: number;
    reason: string;
  },
  { ok: true; status: string; message: string }
>("manageTeamSubscription");

export interface BillingReconciliation {
  paidWithoutSubscription: Array<{
    id: string;
    name: string;
    plan: string;
    subscriptionStatus: string;
    isInternal: boolean;
    createdAt: string;
  }>;
  statusMismatch: Array<{
    id: string;
    name: string;
    localStatus: string;
    stripeStatus: string;
    plan: string;
  }>;
  checkedAgainstStripe: number;
  stripeError: string | null;
}

export const getBillingReconciliation = rpcOp<undefined, BillingReconciliation>(
  "getBillingReconciliation",
);

export type ShareKind = "walkthrough" | "walkthrough_summary" | "showcase" | "project";

export interface ShareLink {
  kind: ShareKind;
  id: string;
  title: string;
  token: string;
  createdAt: string | null;
  updatedAt: string | null;
  revokedAt: string | null;
  publicPath: string;
}

export const listShareLinks = rpcOp<
  { kind?: ShareKind; includeRevoked?: boolean; limit?: number },
  { links: ShareLink[]; counts: Record<string, number>; unavailable: string[] }
>("listShareLinks");

export const revokeShareLinks = rpcOp<
  { kind: ShareKind; ids: string[]; reason: string },
  { revoked: number }
>("revokeShareLinks");

export interface ApiHealth {
  windowHours: number;
  totals: {
    requests: number;
    errors4xx: number;
    errors5xx: number;
    errorRate: number;
    distinctUsers: number;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
  };
  ops: Array<{
    op: string;
    requests: number;
    errors: number;
    errorRate: number;
    p50Ms: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  }>;
  timeseries: Array<{ bucket: string; requests: number; errors: number }>;
  recentFailures: Array<{
    id: string;
    route: string;
    op: string | null;
    httpStatus: number;
    errorCode: string | null;
    durationMs: number | null;
    requestId: string | null;
    createdAt: string;
    user: { id: string; name: string | null; email: string | null } | null;
  }>;
  unavailable: string | null;
}

export const getApiHealth = rpcOp<{ windowHours?: number }, ApiHealth>("getApiHealth");

export interface JobRunSummary {
  job: string;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastDurationMs: number | null;
  lastRowsAffected: number | null;
  lastError: string | null;
  runs24h: number;
  failures24h: number;
}

export const listJobRuns = rpcOp<undefined, { jobs: JobRunSummary[]; unavailable: string | null }>(
  "listJobRuns",
);

export interface UsageRow {
  teamId: string | null;
  teamName: string;
  photoAnalyses: number;
  walkthroughSummaries: number;
  autoReports: number;
  photoCount: number;
  storageBytes: number;
  estimatedAiCostUsd: number;
}

export interface PlatformUsage {
  windowDays: number;
  rows: UsageRow[];
  totals: {
    photoAnalyses: number;
    walkthroughSummaries: number;
    autoReports: number;
    storageBytes: number;
    estimatedAiCostUsd: number;
  };
  unavailable: string[];
}

export const getPlatformUsage = rpcOp<{ windowDays?: number }, PlatformUsage>("getPlatformUsage");

export interface ContentLibraryEntry {
  kind: string;
  table: string;
  total: number;
  global: number;
  available: boolean;
}

export const getContentLibrary = rpcOp<undefined, { entries: ContentLibraryEntry[] }>(
  "getContentLibrary",
);
