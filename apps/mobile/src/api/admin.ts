import { randomUUID } from "expo-crypto";
import { api } from "@/lib/api";
import { readAdminAccess, type AdminAccess, type AdminRole } from "@/lib/access";
import {
  feedbackStatusCounts,
  normaliseFeedbackReport,
  type AdminShareKind,
  type FeedbackReport,
  type FeedbackStatus,
  type Plan,
} from "./admin-view";

/**
 * Platform admin: the triage half.
 *
 * Every op here runs `requirePlatformAdmin` server-side and then works with the
 * service role. Membership of `platform_admins` has **no client access at all**
 * by design, so the phone cannot read it directly and does not try: it asks
 * `checkIsPlatformAdmin` and believes the answer.
 *
 * That is also why the gate below is a real question and not a convenience. A
 * customer must never see the console row on Account, and the only thing that
 * can tell the app whether to draw it is the server.
 */

/**
 * Whether this person is staff.
 *
 * Defaults to **false** on any unexpected shape or failure. Getting this wrong
 * in the permissive direction shows a customer a support queue full of other
 * customers' reports; getting it wrong the other way hides a menu row from a
 * staff member, who can open the web console. The asymmetry decides the default.
 */
export async function checkIsPlatformAdmin(): Promise<boolean> {
  return (await getAdminAccess()).isAdmin;
}

/**
 * The same question with the role, which the console needs to decide what to
 * offer (a `support` admin is not shown the billing controls as if they work).
 * Fails closed exactly as above.
 */
export async function getAdminAccess(): Promise<AdminAccess> {
  try {
    return readAdminAccess(await api.rpc("checkIsPlatformAdmin"));
  } catch {
    return { isAdmin: false, role: null };
  }
}

export type FeedbackPage = {
  reports: FeedbackReport[];
  nextCursor: string | null;
};

export async function listFeedback(args: {
  status?: FeedbackStatus;
  cursor?: string;
}): Promise<FeedbackPage> {
  const result = await api.rpc<Partial<FeedbackPage>>("listFeedback", {
    ...(args.status ? { status: args.status } : {}),
    ...(args.cursor ? { cursor: args.cursor } : {}),
    limit: 30,
  });
  return {
    reports: (result?.reports ?? []).map(normaliseFeedbackReport),
    nextCursor: result?.nextCursor ?? null,
  };
}

/** Counts per status, read from `byStatus`, the field the service sends. */
export async function getFeedbackSummary(): Promise<{
  status: Partial<Record<FeedbackStatus, number>>;
}> {
  return { status: feedbackStatusCounts(await api.rpc("getFeedbackSummary")) };
}

/**
 * Move one or more reports.
 *
 * The op takes an array because the web queue does bulk moves. The phone sends
 * one at a time: bulk selection on a touch list is a interaction cost that buys
 * nothing for somebody triaging three reports on a train.
 */
export async function setFeedbackStatus(
  reportIds: string[],
  status: FeedbackStatus,
): Promise<void> {
  await api.rpc("setFeedbackStatus", { reportIds, status });
}

/**
 * Answer a report, optionally moving it at the same time.
 *
 * Delivered as a notification rather than an email, because the reporter may
 * have typed no address. It lands in the same inbox the app already has.
 */
export async function replyToFeedback(args: {
  reportId: string;
  message: string;
  status?: FeedbackStatus;
}): Promise<void> {
  await api.rpc(
    "replyToFeedback",
    {
      reportId: args.reportId,
      message: args.message,
      ...(args.status ? { status: args.status } : {}),
    },
    // Reaches the person who reported the problem. Twice is worse than once.
    { idempotencyKey: randomUUID() },
  );
}

/*
 * ---------------------------------------------------------------------------
 * The rest of the console: the ops the web's admin pages call, one for one.
 * Every write carries a reason for the audit log, and every op marked
 * idempotent in the registry is sent a fresh key per tap.
 * ---------------------------------------------------------------------------
 */

export type AdminMetrics = {
  totalUsers: number;
  totalTeams: number;
  teamsByPlan: { starter: number; pro: number; team: number };
  subscriptions: { active: number; inactive: number };
  totalProjects: number;
  unattributedProjects: number | null;
  totalPhotos: number;
  signupsLast30Days: { date: string; count: number }[];
  recentTeams: {
    id: string;
    name: string;
    plan: string;
    subscriptionStatus: string;
    createdAt: string;
  }[];
};

export async function getAdminMetrics(): Promise<AdminMetrics> {
  return api.rpc<AdminMetrics>("getAdminMetrics");
}

export type DirectoryUser = {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  createdAt: string;
  team: { id: string; name: string; plan: string; role: string } | null;
  isPlatformAdmin: boolean;
  adminRole: AdminRole | null;
  emailConfirmed: boolean;
  suspended: boolean;
  lastSeenAt: string | null;
  projectCount: number;
  storageBytes: number;
};

export type DirectoryFilters = {
  search?: string;
  plan?: Plan;
  status?: string;
};

export async function listUserDirectory(
  filters: DirectoryFilters & { offset?: number; limit?: number },
): Promise<{ users: DirectoryUser[]; total: number }> {
  const result = await api.rpc<{ users?: DirectoryUser[]; total?: number }>("listUserDirectory", {
    ...clean(filters),
    limit: filters.limit ?? 30,
    offset: filters.offset ?? 0,
  });
  return { users: result?.users ?? [], total: result?.total ?? 0 };
}

export type PlatformUserDetail = {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  jobTitle: string | null;
  createdAt: string;
  isPlatformAdmin: boolean;
  adminRole: AdminRole | null;
  auth: {
    emailConfirmedAt: string | null;
    lastSignInAt: string | null;
    provider: string | null;
    bannedUntil: string | null;
  } | null;
  teams: {
    id: string;
    name: string;
    plan: string;
    subscriptionStatus: string;
    isInternal: boolean;
    role: string;
    isOwner: boolean;
    memberCount: number;
  }[];
  projects: {
    id: string;
    name: string;
    status: string;
    photoCount: number;
    deletedAt: string | null;
  }[];
  totals: { projects: number; photos: number; storageBytes: number; feedbackReports: number };
  feedback: {
    id: string;
    kind: string;
    status: string;
    description: string | null;
    createdAt: string;
  }[];
};

export async function getPlatformUserDetail(userId: string): Promise<PlatformUserDetail> {
  return api.rpc<PlatformUserDetail>("getPlatformUserDetail", { userId });
}

export type UserSupportAction =
  | "send_password_reset"
  | "resend_confirmation"
  | "suspend"
  | "reinstate";

export async function runUserSupportAction(
  userId: string,
  action: UserSupportAction,
  reason: string,
): Promise<string> {
  const result = await api.rpc<{ message?: string }>(
    "runUserSupportAction",
    { userId, action, reason },
    { idempotencyKey: randomUUID() },
  );
  return result?.message ?? "Done.";
}

export async function deletePlatformUser(
  userId: string,
  reason: string,
  confirmEmail: string,
): Promise<number> {
  const result = await api.rpc<{ orphanedProjects?: number }>(
    "deletePlatformUser",
    { userId, reason, confirmEmail },
    { idempotencyKey: randomUUID() },
  );
  return result?.orphanedProjects ?? 0;
}

export async function setAdminRole(
  userId: string,
  role: AdminRole | null,
  reason: string,
): Promise<void> {
  await api.rpc("setAdminRole", { userId, role, reason }, { idempotencyKey: randomUUID() });
}

export type UserNote = {
  id: string;
  body: string;
  createdAt: string;
  author: { name: string | null; email: string | null };
};

export async function listUserNotes(userId: string): Promise<UserNote[]> {
  const result = await api.rpc<{ notes?: UserNote[] }>("listUserNotes", { userId });
  return result?.notes ?? [];
}

export async function addUserNote(userId: string, body: string): Promise<void> {
  await api.rpc("addUserNote", { userId, body }, { idempotencyKey: randomUUID() });
}

export async function setUserTeamRole(
  userId: string,
  teamId: string,
  role: string,
  reason: string,
): Promise<void> {
  await api.rpc(
    "setUserTeamRole",
    { userId, teamId, role, reason },
    { idempotencyKey: randomUUID() },
  );
}

export async function overrideTeamPlan(args: {
  teamId: string;
  plan?: Plan;
  isInternal?: boolean;
  reason: string;
}): Promise<void> {
  await api.rpc(
    "overrideTeamPlan",
    { teamId: args.teamId, plan: args.plan, isInternal: args.isInternal, reason: args.reason },
    { idempotencyKey: randomUUID() },
  );
}

export type CreateUserInput = {
  email: string;
  fullName?: string;
  company?: string;
  team?: { teamId: string; role: string; overSeatLimit: boolean };
  note?: string;
};

export async function createPlatformUser(
  input: CreateUserInput,
): Promise<{ email: string; emailSent: boolean; setupLink: string | null }> {
  const result = await api.rpc<{ email?: string; emailSent?: boolean; setupLink?: string | null }>(
    "createPlatformUser",
    clean(input),
    { idempotencyKey: randomUUID() },
  );
  return {
    email: result?.email ?? input.email,
    emailSent: result?.emailSent === true,
    setupLink: result?.setupLink ?? null,
  };
}

/** The CSV the web downloads. The phone hands it to the share sheet instead. */
export async function exportUsers(
  filters: DirectoryFilters,
): Promise<{ csv: string; rows: number }> {
  const result = await api.rpc<{ csv?: string; rows?: number }>("exportUsers", clean(filters));
  return { csv: result?.csv ?? "", rows: result?.rows ?? 0 };
}

export type DirectoryTeam = {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  isInternal: boolean;
  stripeCustomerId: string | null;
  createdAt: string;
  owner: { name: string | null; email: string | null };
  memberCount: number;
  projectCount: number;
  storageBytes: number;
  lastActivityAt: string | null;
};

export async function listTeamDirectory(
  filters: DirectoryFilters & { offset?: number; limit?: number },
): Promise<{ teams: DirectoryTeam[]; total: number }> {
  const result = await api.rpc<{ teams?: DirectoryTeam[]; total?: number }>("listTeamDirectory", {
    ...clean(filters),
    limit: filters.limit ?? 30,
    offset: filters.offset ?? 0,
  });
  return { teams: result?.teams ?? [], total: result?.total ?? 0 };
}

export async function exportTeams(
  filters: DirectoryFilters,
): Promise<{ csv: string; rows: number }> {
  const result = await api.rpc<{ csv?: string; rows?: number }>("exportTeams", clean(filters));
  return { csv: result?.csv ?? "", rows: result?.rows ?? 0 };
}

export async function getTeamIndustryMix(): Promise<{
  mix: { industry: string; count: number }[];
  totalTeams: number;
  answered: number;
}> {
  const result = await api.rpc<{
    mix?: { industry: string; count: number }[];
    totalTeams?: number;
    answered?: number;
  }>("getTeamIndustryMix");
  return {
    mix: result?.mix ?? [],
    totalTeams: result?.totalTeams ?? 0,
    answered: result?.answered ?? 0,
  };
}

export type BillingReconciliation = {
  paidWithoutSubscription: { id: string; name: string; plan: string; subscriptionStatus: string }[];
  statusMismatch: {
    id: string;
    name: string;
    localStatus: string;
    stripeStatus: string;
    plan: string;
  }[];
  checkedAgainstStripe: number;
  stripeError: string | null;
};

export async function getBillingReconciliation(): Promise<BillingReconciliation> {
  const result = await api.rpc<Partial<BillingReconciliation>>("getBillingReconciliation");
  return {
    paidWithoutSubscription: result?.paidWithoutSubscription ?? [],
    statusMismatch: result?.statusMismatch ?? [],
    checkedAgainstStripe: result?.checkedAgainstStripe ?? 0,
    stripeError: result?.stripeError ?? null,
  };
}

export async function syncTeamBilling(
  teamId: string,
): Promise<{ plan: string; subscriptionStatus: string }> {
  const result = await api.rpc<{ plan?: string; subscriptionStatus?: string }>(
    "syncTeamBilling",
    { teamId },
    { idempotencyKey: randomUUID() },
  );
  return { plan: result?.plan ?? "", subscriptionStatus: result?.subscriptionStatus ?? "" };
}

export type PlatformTeamDetail = {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  isInternal: boolean;
  createdAt: string;
  businessProfile: {
    industry: string | null;
    trades: string[];
    teamSize: string | null;
    goals: string[];
    heardFrom: string | null;
    serviceArea: string | null;
  } | null;
  members: { id: string; fullName: string | null; email: string | null; role: string }[];
  projects: {
    id: string;
    name: string;
    status: string;
    photoCount: number;
    storageBytes: number;
  }[];
};

export async function getPlatformTeamDetail(teamId: string): Promise<PlatformTeamDetail> {
  return api.rpc<PlatformTeamDetail>("getPlatformTeamDetail", { teamId });
}

export type TeamBilling = {
  plan: string;
  subscriptionStatus: string;
  isInternal: boolean;
  memberLimit: number | null;
  stripeSubscriptionId: string | null;
  stripe: {
    status: string;
    currentPeriodEnd: string | null;
    trialEnd: string | null;
    cancelAtPeriodEnd: boolean;
    unavailableReason?: string;
  } | null;
  invoices: {
    id: string;
    number: string | null;
    status: string | null;
    amountDue: number;
    amountPaid: number;
    currency: string;
    created: string;
    hostedUrl: string | null;
  }[];
};

export async function getTeamBilling(teamId: string): Promise<TeamBilling> {
  return api.rpc<TeamBilling>("getTeamBilling", { teamId });
}

export type SubscriptionAction = "cancel_at_period_end" | "resume" | "cancel_now" | "extend_trial";

export async function manageTeamSubscription(args: {
  teamId: string;
  action: SubscriptionAction;
  trialDays?: number;
  reason: string;
}): Promise<string> {
  const result = await api.rpc<{ message?: string }>(
    "manageTeamSubscription",
    { teamId: args.teamId, action: args.action, trialDays: args.trialDays, reason: args.reason },
    { idempotencyKey: randomUUID() },
  );
  return result?.message ?? "Done.";
}

export type AdminNotificationRow = {
  id: string;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
  recipient: { name: string | null; email: string | null } | null;
};

export async function listAllNotifications(
  cursor?: string,
): Promise<{ notifications: AdminNotificationRow[]; nextCursor: string | null }> {
  const result = await api.rpc<{
    notifications?: AdminNotificationRow[];
    nextCursor?: string | null;
  }>("listAllNotifications", { ...(cursor ? { cursor } : {}), limit: 30 });
  return { notifications: result?.notifications ?? [], nextCursor: result?.nextCursor ?? null };
}

export type NotificationTarget =
  | { type: "all" }
  | { type: "team"; teamId: string }
  | { type: "user"; userId: string };

export async function sendAdminNotification(args: {
  title: string;
  body: string | null;
  linkPath: string | null;
  target: NotificationTarget;
}): Promise<number> {
  const result = await api.rpc<{ sentTo?: number }>(
    "sendAdminNotification",
    { title: args.title, body: args.body, linkPath: args.linkPath, target: args.target },
    { idempotencyKey: randomUUID() },
  );
  return result?.sentTo ?? 0;
}

export type ApiHealth = {
  totals: {
    requests: number;
    errors4xx: number;
    errors5xx: number;
    errorRate: number;
    distinctUsers: number;
    p50Ms: number | null;
    p95Ms: number | null;
  };
  ops: { op: string; requests: number; errors: number; errorRate: number; p95Ms: number | null }[];
  recentFailures: {
    id: string;
    op: string | null;
    route: string;
    httpStatus: number;
    errorCode: string | null;
    createdAt: string;
    message: string | null;
  }[];
  unavailable: string | null;
};

export async function getApiHealth(windowHours: number): Promise<ApiHealth> {
  return api.rpc<ApiHealth>("getApiHealth", { windowHours });
}

export type JobRun = {
  job: string;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  runs24h: number;
  failures24h: number;
};

export async function listJobRuns(): Promise<{ jobs: JobRun[]; unavailable: string | null }> {
  const result = await api.rpc<{ jobs?: JobRun[]; unavailable?: string | null }>("listJobRuns");
  return { jobs: result?.jobs ?? [], unavailable: result?.unavailable ?? null };
}

export type PlatformUsage = {
  rows: {
    teamId: string | null;
    teamName: string;
    photoAnalyses: number;
    walkthroughSummaries: number;
    autoReports: number;
    storageBytes: number;
    estimatedAiCostUsd: number;
  }[];
  totals: {
    photoAnalyses: number;
    walkthroughSummaries: number;
    autoReports: number;
    storageBytes: number;
    estimatedAiCostUsd: number;
  };
  unavailable: string[];
};

export async function getPlatformUsage(windowDays: number): Promise<PlatformUsage> {
  return api.rpc<PlatformUsage>("getPlatformUsage", { windowDays });
}

export async function getContentLibrary(): Promise<
  { kind: string; total: number; global: number; available: boolean }[]
> {
  const result = await api.rpc<{
    entries?: { kind: string; total: number; global: number; available: boolean }[];
  }>("getContentLibrary");
  return result?.entries ?? [];
}

export type AdminShareLink = {
  kind: AdminShareKind;
  id: string;
  title: string;
  createdAt: string | null;
  revokedAt: string | null;
  publicPath: string;
};

export async function listShareLinks(
  kind?: AdminShareKind,
): Promise<{ links: AdminShareLink[]; counts: Record<string, number>; unavailable: string[] }> {
  const result = await api.rpc<{
    links?: AdminShareLink[];
    counts?: Record<string, number>;
    unavailable?: string[];
  }>("listShareLinks", { ...(kind ? { kind } : {}), limit: 200 });
  return {
    links: result?.links ?? [],
    counts: result?.counts ?? {},
    unavailable: result?.unavailable ?? [],
  };
}

export async function revokeShareLinks(
  kind: AdminShareKind,
  ids: string[],
  reason: string,
): Promise<number> {
  const result = await api.rpc<{ revoked?: number }>(
    "revokeShareLinks",
    { kind, ids, reason },
    { idempotencyKey: randomUUID() },
  );
  return result?.revoked ?? 0;
}

export type AuditEntry = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { name: string | null; email: string | null } | null;
};

export async function listAdminAuditLog(args: {
  cursor?: string;
  includeViews: boolean;
  action?: string;
}): Promise<{ entries: AuditEntry[]; nextCursor: string | null }> {
  const result = await api.rpc<{ entries?: AuditEntry[]; nextCursor?: string | null }>(
    "listAdminAuditLog",
    {
      limit: 50,
      includeViews: args.includeViews,
      ...(args.cursor ? { cursor: args.cursor } : {}),
      ...(args.action ? { action: args.action } : {}),
    },
  );
  return { entries: result?.entries ?? [], nextCursor: result?.nextCursor ?? null };
}

/** Drops empty strings and undefined, which the ops' zod schemas would reject or misread. */
function clean<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === "" || value === "all") continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
