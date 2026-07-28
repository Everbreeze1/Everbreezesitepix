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
    target:
      | { type: "all" }
      | { type: "team"; teamId: string }
      | { type: "user"; userId: string };
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
}

export interface PlatformTeamDetail {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
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

export const syncTeamBilling = rpcOp<{ teamId: string }, { subscriptionStatus: string; plan: string }>(
  "syncTeamBilling",
);

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
