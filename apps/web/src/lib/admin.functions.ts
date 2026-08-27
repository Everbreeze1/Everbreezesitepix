import { rpcOp } from "./everlumen-api";

export interface AdminMetrics {
  totalUsers: number;
  totalTeams: number;
  teamsByPlan: { starter: number; pro: number; team: number };
  subscriptions: { active: number; inactive: number };
  totalProjects: number;
  /** Live projects with no team. Null when the team_id migration has not run. */
  unattributedProjects: number | null;
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

export const checkIsPlatformAdmin = rpcOp<undefined, { isAdmin: boolean; role: AdminRole | null }>(
  "checkIsPlatformAdmin",
);

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
  { cursor?: string; limit?: number; includeViews?: boolean; action?: string; actorId?: string },
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
  adminRole: AdminRole | null;
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
    isInternal: boolean;
    role: string;
    isOwner: boolean;
    /** How many people a plan change on this team would affect. */
    memberCount: number;
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
  feedback: Array<{
    id: string;
    kind: string;
    status: string;
    description: string | null;
    createdAt: string;
  }>;
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
    message: string | null;
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

// ---------------------------------------------------------------------------
// User directory
//
// Mirrors apps/api/src/domains/admin/user-directory.ts. The list is filtered,
// sorted, counted and paginated in SQL, so these inputs are passed through
// rather than applied client-side.
// ---------------------------------------------------------------------------

export const USER_STATUSES = [
  "active",
  "unconfirmed",
  "suspended",
  "no_team",
  "dormant",
  "admin",
] as const;
export type UserStatusFilter = (typeof USER_STATUSES)[number];

export type UserSort = "joined" | "last_seen" | "name" | "storage" | "projects" | "activity";

export interface DirectoryUser {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  createdAt: string;
  team: { id: string; name: string; plan: string; role: string } | null;
  teamCount: number;
  isPlatformAdmin: boolean;
  adminRole: AdminRole | null;
  emailConfirmed: boolean;
  suspended: boolean;
  lastSignInAt: string | null;
  lastSeenAt: string | null;
  requests30d: number;
  projectCount: number;
  storageBytes: number;
  feedbackCount: number;
}

export interface UserDirectoryFilters {
  search?: string;
  plan?: "starter" | "pro" | "team";
  status?: UserStatusFilter;
  sort?: UserSort;
  desc?: boolean;
}

export const listUserDirectory = rpcOp<
  UserDirectoryFilters & { limit?: number; offset?: number },
  { users: DirectoryUser[]; total: number; offset: number; limit: number; degraded: boolean }
>("listUserDirectory");

export const setAdminRole = rpcOp<
  { userId: string; role: AdminRole | null; reason: string },
  { ok: true; role: AdminRole | null }
>("setAdminRole");

export interface UserNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string | null; name: string | null; email: string | null };
}

export const listUserNotes = rpcOp<
  { userId: string },
  { notes: UserNote[]; unavailable: string | null }
>("listUserNotes");

export const addUserNote = rpcOp<{ userId: string; body: string }, { ok: true }>("addUserNote");

export const setUserTeamRole = rpcOp<
  { userId: string; teamId: string; role: string; reason: string },
  { ok: true }
>("setUserTeamRole");

export const runBulkUserAction = rpcOp<
  {
    userIds: string[];
    action: "suspend" | "reinstate" | "resend_confirmation";
    reason: string;
    /** So a resend from a preview or local build links back to that build. */
    origin?: string;
  },
  { succeeded: number; failed: Array<{ userId: string; reason: string }> }
>("runBulkUserAction");

// ---------------------------------------------------------------------------
// Creating an account from the console
//
// Mirrors apps/api/src/domains/admin/create-user.ts.
// ---------------------------------------------------------------------------

/** Owner is transferred rather than assigned, so it is never offered here. */
export type CreatableTeamRole = "admin" | "manager" | "standard" | "restricted";

export interface CreatePlatformUserInput {
  email: string;
  fullName?: string;
  company?: string;
  team?: { teamId: string; role: CreatableTeamRole; overSeatLimit: boolean };
  /** Omitted means "mail them a link to choose their own". */
  password?: string;
  /** Required by the server whenever a team is attached. */
  note?: string;
  origin?: string;
}

export interface CreatePlatformUserResult {
  userId: string;
  email: string;
  emailSent: boolean;
  emailReason: string | null;
  /** The one-shot set-password link, for handing over when mail fails. */
  setupLink: string | null;
  team: { id: string; name: string; role: CreatableTeamRole; overSeatLimit: boolean } | null;
}

export const createPlatformUser = rpcOp<CreatePlatformUserInput, CreatePlatformUserResult>(
  "createPlatformUser",
  /*
   * Keyed so a network-level retry of one request cannot mint two accounts.
   *
   * It does NOT collapse a double-click: `rpcOp` mints a fresh key per call,
   * so two clicks are two requests with two keys. The submit button being
   * disabled while the mutation is in flight is what handles that, and the
   * server's 409 on an address that already has an account is the backstop.
   */
  { idempotent: true },
);

export const exportUsers = rpcOp<
  UserDirectoryFilters & { max?: number },
  { csv: string; rows: number; truncated: boolean }
>("exportUsers");

// ---------------------------------------------------------------------------
// Team directory
//
// Mirrors apps/api/src/domains/admin/team-directory.ts. Same shape as the user
// directory: filtered, sorted, counted and paged in SQL.
// ---------------------------------------------------------------------------

export const TEAM_STATUSES = [
  "active",
  "past_due",
  "canceled",
  "internal",
  "unpaid_plan",
  "no_profile",
  "dormant",
] as const;
export type TeamStatusFilter = (typeof TEAM_STATUSES)[number];

export type TeamSort = "created" | "name" | "members" | "projects" | "storage" | "activity";

export interface DirectoryTeam {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  isInternal: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  owner: { name: string | null; email: string | null };
  memberCount: number;
  projectCount: number;
  photoCount: number;
  storageBytes: number;
  lastActivityAt: string | null;
  industry: string | null;
  teamSize: string | null;
  profileCompletedAt: string | null;
}

export interface TeamDirectoryFilters {
  search?: string;
  plan?: "starter" | "pro" | "team";
  status?: TeamStatusFilter;
  sort?: TeamSort;
  desc?: boolean;
}

export const listTeamDirectory = rpcOp<
  TeamDirectoryFilters & { limit?: number; offset?: number },
  { teams: DirectoryTeam[]; total: number; offset: number; limit: number; degraded: boolean }
>("listTeamDirectory");

export const getTeamIndustryMix = rpcOp<
  undefined,
  {
    mix: Array<{ industry: string; count: number }>;
    totalTeams: number;
    answered: number;
    unavailable: boolean;
  }
>("getTeamIndustryMix");

export const exportTeams = rpcOp<
  TeamDirectoryFilters & { max?: number },
  { csv: string; rows: number; truncated: boolean }
>("exportTeams");
