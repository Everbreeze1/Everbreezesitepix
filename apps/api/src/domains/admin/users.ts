import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

export interface PlatformUser {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  createdAt: string;
  team: { id: string; name: string; plan: string; role: string } | null;
  isPlatformAdmin: boolean;
}

export const listPlatformUsersInputSchema = z.object({
  search: z.string().trim().max(200).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export async function listPlatformUsersService(
  ctx: AuthedContext,
  data: z.infer<typeof listPlatformUsersInputSchema>,
): Promise<{ users: PlatformUser[]; nextCursor: string | null }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  let query = (admin as any)
    .from("profiles")
    .select("id, full_name, email, company, created_at")
    .order("created_at", { ascending: false })
    .limit(data.limit + 1);
  if (data.cursor) query = query.lt("created_at", data.cursor);
  if (data.search) {
    const like = `%${data.search}%`;
    query = query.or(`full_name.ilike.${like},email.ilike.${like},company.ilike.${like}`);
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const list = (rows as any[]) ?? [];
  const hasMore = list.length > data.limit;
  const page = hasMore ? list.slice(0, data.limit) : list;
  const userIds = page.map((r) => r.id);

  const [{ data: memberships }, { data: adminRows }] = await Promise.all([
    userIds.length
      ? (admin as any)
          .from("team_members")
          .select("user_id, role, team:teams(id, name, plan)")
          .in("user_id", userIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? (admin as any).from("platform_admins").select("user_id").in("user_id", userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const teamByUser = new Map<string, PlatformUser["team"]>();
  ((memberships as any[]) ?? []).forEach((m) => {
    if (m.team) teamByUser.set(m.user_id, { id: m.team.id, name: m.team.name, plan: m.team.plan, role: m.role });
  });
  const adminSet = new Set(((adminRows as any[]) ?? []).map((r) => r.user_id));

  return {
    users: page.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      email: r.email,
      company: r.company,
      createdAt: r.created_at,
      team: teamByUser.get(r.id) ?? null,
      isPlatformAdmin: adminSet.has(r.id),
    })),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  };
}

export const setPlatformAdminInputSchema = z.object({
  userId: z.string().uuid(),
  isAdmin: z.boolean(),
});

export async function setPlatformAdminService(
  ctx: AuthedContext,
  data: z.infer<typeof setPlatformAdminInputSchema>,
): Promise<{ ok: true }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  if (data.isAdmin) {
    const { error } = await (admin as any)
      .from("platform_admins")
      .upsert({ user_id: data.userId, granted_by: ctx.userId }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await (admin as any).from("platform_admins").delete().eq("user_id", data.userId);
    if (error) throw new Error(error.message);
  }

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: data.isAdmin ? "grant_platform_admin" : "revoke_platform_admin",
    targetType: "user",
    targetId: data.userId,
  });

  return { ok: true };
}
