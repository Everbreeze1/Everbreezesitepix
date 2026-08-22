import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { chunk } from "../../lib/chunked-in";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

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

export const listAllNotificationsInputSchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export async function listAllNotificationsService(
  ctx: AuthedContext,
  data: z.infer<typeof listAllNotificationsInputSchema>,
): Promise<{ notifications: AdminNotificationRow[]; nextCursor: string | null }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  let query = (admin as any)
    .from("notifications")
    .select("id, recipient_id, type, title, body, link_path, created_at, read_at")
    .order("created_at", { ascending: false })
    .limit(data.limit + 1);
  if (data.cursor) query = query.lt("created_at", data.cursor);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const list = (rows as any[]) ?? [];
  const hasMore = list.length > data.limit;
  const page = hasMore ? list.slice(0, data.limit) : list;

  const recipientIds = Array.from(new Set(page.map((r) => r.recipient_id)));
  const { data: profileRows } = recipientIds.length
    ? await (admin as any).from("profiles").select("id, full_name, email").in("id", recipientIds)
    : { data: [] };
  const profileById = new Map(((profileRows as any[]) ?? []).map((p) => [p.id, p]));

  return {
    notifications: page.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      linkPath: r.link_path,
      createdAt: r.created_at,
      readAt: r.read_at,
      recipient: profileById.has(r.recipient_id)
        ? {
            id: r.recipient_id,
            name: profileById.get(r.recipient_id).full_name,
            email: profileById.get(r.recipient_id).email,
          }
        : null,
    })),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  };
}

export const sendAdminNotificationInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(1000).optional().nullable(),
  linkPath: z.string().max(300).optional().nullable(),
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("all") }),
    z.object({ type: z.literal("team"), teamId: z.string().uuid() }),
    z.object({ type: z.literal("user"), userId: z.string().uuid() }),
  ]),
});

export async function sendAdminNotificationService(
  ctx: AuthedContext,
  data: z.infer<typeof sendAdminNotificationInputSchema>,
): Promise<{ sentTo: number }> {
  await requirePlatformAdmin(ctx.userId, "support");
  const admin = getSupabaseAdmin();

  let recipientIds: string[] = [];
  if (data.target.type === "all") {
    const { data: rows, error } = await (admin as any).from("profiles").select("id");
    if (error) throw new Error(error.message);
    recipientIds = ((rows as any[]) ?? []).map((r) => r.id);
  } else if (data.target.type === "team") {
    const { data: rows, error } = await (admin as any)
      .from("team_members")
      .select("user_id")
      .eq("team_id", data.target.teamId);
    if (error) throw new Error(error.message);
    recipientIds = ((rows as any[]) ?? []).map((r) => r.user_id);
  } else {
    recipientIds = [data.target.userId];
  }

  /*
   * One batched INSERT per chunk, not one request per recipient.
   *
   * This used to be `Promise.all(recipientIds.map(insertNotification))`, which
   * opens a socket per user and fires them all at once: a broadcast to the whole
   * user base was a self-inflicted denial of service against our own database,
   * from a single HTTP request, and it got worse with every signup.
   *
   * Chunks are issued sequentially for the reason selectIn gives - a stampede of
   * parallel writes turns one admin action into everyone else's outage - and the
   * chunk size is the same 200 that `chunked-in` uses, well inside PostgREST's
   * request limits with 9 columns per row.
   *
   * Not atomic across chunks. A failure partway leaves earlier chunks delivered,
   * so the count returned below is what actually landed rather than what was
   * intended, and the error names the shortfall instead of hiding it.
   */
  const rows = recipientIds.map((recipientId) => ({
    recipient_id: recipientId,
    actor_id: null,
    type: "admin_announcement" as const,
    title: data.title,
    body: data.body ?? null,
    link_path: data.linkPath ?? null,
    project_id: null,
    entity_type: null,
    entity_id: null,
  }));

  let sent = 0;
  for (const batch of chunk(rows)) {
    const { error } = await (admin as any).from("notifications").insert(batch);
    if (error) {
      throw new Error(
        `Announcement partially sent: ${sent} of ${rows.length} delivered before the send failed (${error.message}).`,
      );
    }
    sent += batch.length;
  }

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "send_admin_notification",
    targetType: "notification_broadcast",
    targetId:
      data.target.type === "user"
        ? data.target.userId
        : data.target.type === "team"
          ? data.target.teamId
          : null,
    metadata: { target: data.target, title: data.title, sentTo: sent },
  });

  return { sentTo: sent };
}
