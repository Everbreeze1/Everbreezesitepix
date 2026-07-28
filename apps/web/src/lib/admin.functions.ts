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

export const checkIsPlatformAdmin = rpcOp<undefined, { isAdmin: boolean }>("checkIsPlatformAdmin");

export const getAdminMetrics = rpcOp<undefined, AdminMetrics>("getAdminMetrics");
