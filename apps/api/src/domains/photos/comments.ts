import { z } from "zod";
import type { ServiceContext } from "../../lib/user-context";
import { getSupabaseAdmin } from "../../lib/supabase";
import { insertNotification } from "../notifications/service";

export interface PhotoComment {
  id: string;
  photoId: string;
  projectId: string;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
}

async function enrichAuthors(rows: Array<{ author_id: string }>): Promise<Map<string, {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}>> {
  const ids = Array.from(new Set(rows.map((r) => r.author_id).filter(Boolean)));
  if (ids.length === 0) return new Map();
  const supabaseAdmin = getSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("profiles" as never)
    .select("id, full_name, email, avatar_url")
    .in("id", ids);
  const map = new Map<string, {
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  }>();
  for (const p of (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  }>) {
    map.set(p.id, p);
  }
  return map;
}

function shape(
  row: {
    id: string;
    photo_id: string;
    project_id: string;
    author_id: string;
    body: string;
    mentions: string[] | null;
    created_at: string;
  },
  profile:
    | { full_name?: string | null; email?: string | null; avatar_url?: string | null }
    | undefined,
): PhotoComment {
  return {
    id: row.id,
    photoId: row.photo_id,
    projectId: row.project_id,
    authorId: row.author_id,
    authorName: profile?.full_name ?? null,
    authorEmail: profile?.email ?? null,
    authorAvatarUrl: profile?.avatar_url ?? null,
    body: row.body,
    mentions: (row.mentions ?? []) as string[],
    createdAt: row.created_at,
  };
}

export const listPhotoCommentsInputSchema = z.object({ photoId: z.string().uuid() });
export const getPhotoCommentInputSchema = z.object({ commentId: z.string().uuid() });
export const createPhotoCommentInputSchema = z.object({
  photoId: z.string().uuid(),
  projectId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
  mentions: z.array(z.string().uuid()).default([]),
});
export const deletePhotoCommentInputSchema = z.object({ commentId: z.string().uuid() });

export async function listPhotoCommentsService(
  ctx: ServiceContext,
  data: z.infer<typeof listPhotoCommentsInputSchema>,
) {
  const { data: rows, error } = await ctx.supabase
    .from("photo_comments" as never)
    .select("id, photo_id, project_id, author_id, body, mentions, created_at")
    .eq("photo_id", data.photoId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const list = (rows ?? []) as Array<{
    id: string;
    photo_id: string;
    project_id: string;
    author_id: string;
    body: string;
    mentions: string[] | null;
    created_at: string;
  }>;
  const profiles = await enrichAuthors(list);
  return {
    comments: list.map((r) => shape(r, profiles.get(r.author_id))),
  };
}

export async function getPhotoCommentService(
  ctx: ServiceContext,
  data: z.infer<typeof getPhotoCommentInputSchema>,
) {
  const { data: row } = await ctx.supabase
    .from("photo_comments" as never)
    .select("id, photo_id, project_id, author_id, body, mentions, created_at")
    .eq("id", data.commentId)
    .maybeSingle();
  if (!row) return { comment: null as PhotoComment | null };
  const typed = row as {
    id: string;
    photo_id: string;
    project_id: string;
    author_id: string;
    body: string;
    mentions: string[] | null;
    created_at: string;
  };
  const profiles = await enrichAuthors([typed]);
  return { comment: shape(typed, profiles.get(typed.author_id)) };
}

export async function createPhotoCommentService(
  ctx: ServiceContext,
  data: z.infer<typeof createPhotoCommentInputSchema>,
) {
  const { data: row, error } = await ctx.supabase
    .from("photo_comments" as never)
    .insert({
      photo_id: data.photoId,
      project_id: data.projectId,
      author_id: ctx.userId,
      body: data.body,
      mentions: data.mentions,
    } as never)
    .select("id, photo_id, project_id, author_id, body, mentions, created_at")
    .single();
  if (error) throw new Error(error.message);
  const typed = row as {
    id: string;
    photo_id: string;
    project_id: string;
    author_id: string;
    body: string;
    mentions: string[] | null;
    created_at: string;
  };
  const profiles = await enrichAuthors([typed]);
  const author = profiles.get(typed.author_id);
  const authorName = author?.full_name ?? author?.email ?? "Someone";

  const mentioned = (typed.mentions ?? []).filter((id) => id !== ctx.userId);
  if (mentioned.length > 0) {
    const admin = getSupabaseAdmin();
    await Promise.all(
      mentioned.map((userId) =>
        insertNotification(admin, {
          recipientId: userId,
          actorId: ctx.userId,
          type: "photo_comment_mention",
          title: `${authorName} mentioned you`,
          body: typed.body,
          linkPath: `/projects/${typed.project_id}`,
          projectId: typed.project_id,
          entityType: "photo_comment",
          entityId: typed.id,
        }),
      ),
    );
  }

  return { comment: shape(typed, author) };
}

export async function deletePhotoCommentService(
  ctx: ServiceContext,
  data: z.infer<typeof deletePhotoCommentInputSchema>,
) {
  const { error } = await ctx.supabase
    .from("photo_comments" as never)
    .delete()
    .eq("id", data.commentId);
  if (error) throw new Error(error.message);
  return { ok: true };
}
