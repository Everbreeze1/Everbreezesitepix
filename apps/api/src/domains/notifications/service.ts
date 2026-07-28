import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceContext } from "../../lib/user-context";

export interface Notification {
  id: string;
  recipientId: string;
  actorId: string | null;
  type:
    | "task_assigned"
    | "checklist_assigned"
    | "photo_comment_mention"
    | "team_invite_accepted"
    | "admin_announcement";
  title: string;
  body: string | null;
  linkPath: string | null;
  projectId: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

type NotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  type: Notification["type"];
  title: string;
  body: string | null;
  link_path: string | null;
  project_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
};

function shape(row: NotificationRow): Notification {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    actorId: row.actor_id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkPath: row.link_path,
    projectId: row.project_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export const listNotificationsInputSchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export async function listNotificationsService(
  ctx: ServiceContext,
  data: z.infer<typeof listNotificationsInputSchema>,
) {
  let query = ctx.supabase
    .from("notifications" as never)
    .select("*")
    .eq("recipient_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(data.limit + 1);
  if (data.cursor) query = query.lt("created_at", data.cursor);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const list = (rows ?? []) as NotificationRow[];
  const hasMore = list.length > data.limit;
  const page = hasMore ? list.slice(0, data.limit) : list;
  return {
    notifications: page.map(shape),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  };
}

export async function getUnreadNotificationCountService(ctx: ServiceContext) {
  const { count, error } = await ctx.supabase
    .from("notifications" as never)
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", ctx.userId)
    .is("read_at", null);
  if (error) throw new Error(error.message);
  return { count: count ?? 0 };
}

export const markNotificationReadInputSchema = z.object({
  notificationId: z.string().uuid(),
});

export async function markNotificationReadService(
  ctx: ServiceContext,
  data: z.infer<typeof markNotificationReadInputSchema>,
) {
  const { error } = await ctx.supabase
    .from("notifications" as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq("id", data.notificationId)
    .eq("recipient_id", ctx.userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function markAllNotificationsReadService(ctx: ServiceContext) {
  const { error } = await ctx.supabase
    .from("notifications" as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq("recipient_id", ctx.userId)
    .is("read_at", null);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/**
 * Server-side notification insert for event sources that already run through the
 * service layer (photo comment mentions, team invite acceptance) rather than a DB
 * trigger. Uses the service-role client, so it bypasses RLS by design — callers are
 * trusted server code, not user input.
 */
export async function insertNotification(
  admin: SupabaseClient,
  params: {
    recipientId: string;
    actorId: string | null;
    type: Notification["type"];
    title: string;
    body?: string | null;
    linkPath?: string | null;
    projectId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  },
) {
  if (!params.recipientId || params.recipientId === params.actorId) return;
  const { error } = await admin.from("notifications" as never).insert({
    recipient_id: params.recipientId,
    actor_id: params.actorId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link_path: params.linkPath ?? null,
    project_id: params.projectId ?? null,
    entity_type: params.entityType ?? null,
    entity_id: params.entityId ?? null,
  } as never);
  if (error) console.error("[notifications] insert failed", error.message);
}
