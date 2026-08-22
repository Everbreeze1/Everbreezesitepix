import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import type { AuthedContext } from "../../lib/user-context";

export interface AdminAuditLogRow {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string | null; email: string | null } | null;
}

/** Best-effort - never let a logging failure block the admin action it's recording. */
export async function logAdminAction(
  admin: ReturnType<typeof getSupabaseAdmin>,
  params: {
    actorId: string;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    await (admin as any).from("admin_audit_log").insert({
      actor_id: params.actorId,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      metadata: params.metadata ?? null,
    });
  } catch {
    // Swallow - audit logging is best-effort, not a correctness dependency.
  }
}

/**
 * Record that an admin *looked at* a customer's data.
 *
 * The log used to hold four actions, all of them writes. But the risk this
 * console carries is not mostly write-shaped: an admin opening one company's
 * workspace, reading their projects and their feedback, is a privacy event, and
 * it left no trace at all. "Who looked at this account, and when" was
 * unanswerable, which is exactly the question that gets asked after a
 * complaint.
 *
 * Same best-effort contract as `logAdminAction` - a logging failure must never
 * block the read it is recording.
 */
export async function logAdminRead(
  admin: ReturnType<typeof getSupabaseAdmin>,
  params: {
    actorId: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  await logAdminAction(admin, {
    actorId: params.actorId,
    action: `view_${params.targetType}`,
    targetType: params.targetType,
    targetId: params.targetId,
    metadata: params.metadata ?? null,
  });
}

export const listAdminAuditLogInputSchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export async function listAdminAuditLogService(
  ctx: AuthedContext,
  data: z.infer<typeof listAdminAuditLogInputSchema>,
): Promise<{ entries: AdminAuditLogRow[]; nextCursor: string | null }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  let query = (admin as any)
    .from("admin_audit_log")
    .select("id, actor_id, action, target_type, target_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(data.limit + 1);
  if (data.cursor) query = query.lt("created_at", data.cursor);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const list = (rows as any[]) ?? [];
  const hasMore = list.length > data.limit;
  const page = hasMore ? list.slice(0, data.limit) : list;

  const actorIds = Array.from(new Set(page.map((r) => r.actor_id)));
  const { data: profileRows } = actorIds.length
    ? await (admin as any).from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const profileById = new Map(((profileRows as any[]) ?? []).map((p) => [p.id, p]));

  return {
    entries: page.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      metadata: r.metadata,
      createdAt: r.created_at,
      actor: profileById.has(r.actor_id)
        ? {
            id: r.actor_id,
            name: profileById.get(r.actor_id).full_name,
            email: profileById.get(r.actor_id).email,
          }
        : null,
    })),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  };
}
