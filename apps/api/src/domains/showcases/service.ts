import { z } from "zod";
import { sanitizeCaption } from "@sitepix/shared";
import type { AuthedContext } from "../../lib/user-context";
import { getSupabaseAdmin } from "../../lib/supabase";

export interface ShowcaseSummary {
  id: string;
  title: string;
  tagline: string | null;
  layout: string;
  share_token: string;
  revoked_at: string | null;
  item_count: number;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShowcaseItemDetail {
  id: string;
  photo_id: string;
  caption: string | null;
  position: number;
  image_url: string;
}

export interface ShowcaseDetail {
  id: string;
  title: string;
  tagline: string | null;
  layout: string;
  share_token: string;
  revoked_at: string | null;
  items: ShowcaseItemDetail[];
}

async function myTeamId(ctx: AuthedContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("team_members" as any)
    .select("team_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return (data as any)?.team_id ?? null;
}

async function resolvePhotoUrls(
  photoIds: string[],
): Promise<Map<string, { image_url: string; storage_path: string }>> {
  const admin = getSupabaseAdmin();
  const out = new Map<string, { image_url: string; storage_path: string }>();
  if (!photoIds.length) return out;
  const { data } = await admin
    .from("photos")
    .select("id, storage_path, image_url")
    .in("id", photoIds);
  const rows = (data as Array<{ id: string; storage_path: string; image_url: string | null }>) ?? [];
  const needSign = rows.filter((r) => !r.image_url);
  let signedMap: Record<string, string> = {};
  if (needSign.length) {
    const { data: signed } = await admin.storage
      .from("site-photos")
      .createSignedUrls(
        needSign.map((r) => r.storage_path),
        60 * 60,
      );
    signed?.forEach((s, i) => {
      if (s.signedUrl) signedMap[needSign[i].storage_path] = s.signedUrl;
    });
  }
  rows.forEach((r) => {
    out.set(r.id, {
      image_url: r.image_url ?? signedMap[r.storage_path] ?? "",
      storage_path: r.storage_path,
    });
  });
  return out;
}

export async function listShowcasesService(ctx: AuthedContext): Promise<{ showcases: ShowcaseSummary[] }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) return { showcases: [] };
  const { data } = await (ctx.supabase as any)
    .from("showcases")
    .select("id, title, tagline, layout, share_token, revoked_at, cover_photo_id, created_at, updated_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false });
  const rows = (data as any[]) ?? [];

  const [{ data: countRows }, urlMap] = await Promise.all([
    (ctx.supabase as any)
      .from("showcase_items")
      .select("showcase_id")
      .in("showcase_id", rows.map((r) => r.id)),
    resolvePhotoUrls(rows.map((r) => r.cover_photo_id).filter(Boolean)),
  ]);
  const countByShowcase = new Map<string, number>();
  ((countRows as any[]) ?? []).forEach((r) => {
    countByShowcase.set(r.showcase_id, (countByShowcase.get(r.showcase_id) ?? 0) + 1);
  });

  return {
    showcases: rows.map((r) => ({
      id: r.id,
      title: r.title,
      tagline: r.tagline,
      layout: r.layout,
      share_token: r.share_token,
      revoked_at: r.revoked_at,
      item_count: countByShowcase.get(r.id) ?? 0,
      cover_image_url: r.cover_photo_id ? urlMap.get(r.cover_photo_id)?.image_url ?? null : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  };
}

export const getShowcaseInputSchema = z.object({ id: z.string().uuid() });

export async function getShowcaseService(
  ctx: AuthedContext,
  data: z.infer<typeof getShowcaseInputSchema>,
): Promise<ShowcaseDetail | null> {
  const { data: row } = await (ctx.supabase as any)
    .from("showcases")
    .select("id, title, tagline, layout, share_token, revoked_at")
    .eq("id", data.id)
    .maybeSingle();
  if (!row) return null;

  const { data: itemRows } = await (ctx.supabase as any)
    .from("showcase_items")
    .select("id, photo_id, caption, position")
    .eq("showcase_id", data.id)
    .order("position", { ascending: true });
  const items = (itemRows as any[]) ?? [];
  const urlMap = await resolvePhotoUrls(items.map((i) => i.photo_id));

  return {
    id: row.id,
    title: row.title,
    tagline: row.tagline,
    layout: row.layout,
    share_token: row.share_token,
    revoked_at: row.revoked_at,
    items: items.map((i) => ({
      id: i.id,
      photo_id: i.photo_id,
      caption: sanitizeCaption(i.caption),
      position: i.position,
      image_url: urlMap.get(i.photo_id)?.image_url ?? "",
    })),
  };
}

export const createShowcaseInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  tagline: z.string().max(300).optional().nullable(),
});

export async function createShowcaseService(
  ctx: AuthedContext,
  data: z.infer<typeof createShowcaseInputSchema>,
): Promise<{ id: string }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) throw Object.assign(new Error("No team"), { status: 400 });
  const { data: row, error } = await (ctx.supabase as any)
    .from("showcases")
    .insert({ team_id: teamId, created_by: ctx.userId, title: data.title, tagline: data.tagline ?? null })
    .select("id")
    .single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return { id: row.id };
}

export const updateShowcaseInputSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160).optional(),
  tagline: z.string().max(300).nullable().optional(),
  layout: z.enum(["grid", "masonry", "featured"]).optional(),
  coverPhotoId: z.string().uuid().nullable().optional(),
});

export async function updateShowcaseService(
  ctx: AuthedContext,
  data: z.infer<typeof updateShowcaseInputSchema>,
): Promise<{ ok: true }> {
  const patch: Record<string, unknown> = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.tagline !== undefined) patch.tagline = data.tagline;
  if (data.layout !== undefined) patch.layout = data.layout;
  if (data.coverPhotoId !== undefined) patch.cover_photo_id = data.coverPhotoId;
  const { error } = await (ctx.supabase as any).from("showcases").update(patch).eq("id", data.id);
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return { ok: true };
}

export const deleteShowcaseInputSchema = z.object({ id: z.string().uuid() });

export async function deleteShowcaseService(
  ctx: AuthedContext,
  data: z.infer<typeof deleteShowcaseInputSchema>,
): Promise<{ ok: true }> {
  const { error } = await (ctx.supabase as any).from("showcases").delete().eq("id", data.id);
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return { ok: true };
}

export const setShowcaseItemsInputSchema = z.object({
  showcaseId: z.string().uuid(),
  items: z
    .array(
      z.object({
        photoId: z.string().uuid(),
        caption: z.string().max(500).optional().nullable(),
      }),
    )
    .max(200),
});

export async function setShowcaseItemsService(
  ctx: AuthedContext,
  data: z.infer<typeof setShowcaseItemsInputSchema>,
): Promise<{ ok: true }> {
  await (ctx.supabase as any).from("showcase_items").delete().eq("showcase_id", data.showcaseId);
  if (data.items.length) {
    const rows = data.items.map((it, i) => ({
      showcase_id: data.showcaseId,
      photo_id: it.photoId,
      caption: it.caption ?? null,
      position: i,
    }));
    const { error } = await (ctx.supabase as any).from("showcase_items").insert(rows);
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
  }
  return { ok: true };
}

export const setShowcaseShareInputSchema = z.object({
  id: z.string().uuid(),
  enable: z.boolean(),
});

export async function setShowcaseShareService(
  ctx: AuthedContext,
  data: z.infer<typeof setShowcaseShareInputSchema>,
): Promise<{ ok: true }> {
  const { error } = await (ctx.supabase as any)
    .from("showcases")
    .update({ revoked_at: data.enable ? null : new Date().toISOString() })
    .eq("id", data.id);
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return { ok: true };
}

export const publicShowcaseInputSchema = z.object({ token: z.string().uuid() });

export interface PublicShowcase {
  status: "ok" | "not_found" | "revoked";
  showcase: {
    title: string;
    tagline: string | null;
    layout: string;
    items: Array<{ photo_id: string; caption: string | null; image_url: string }>;
  } | null;
  company: { name: string | null; logo_url: string | null } | null;
}

export async function getPublicShowcaseService(
  data: z.infer<typeof publicShowcaseInputSchema>,
): Promise<PublicShowcase> {
  const admin = getSupabaseAdmin();
  const { data: row } = await (admin as any)
    .from("showcases")
    .select("id, title, tagline, layout, revoked_at, created_by")
    .eq("share_token", data.token)
    .maybeSingle();
  if (!row) return { status: "not_found", showcase: null, company: null };
  if (row.revoked_at) return { status: "revoked", showcase: null, company: null };

  const [{ data: itemRows }, { data: profile }] = await Promise.all([
    (admin as any)
      .from("showcase_items")
      .select("photo_id, caption, position")
      .eq("showcase_id", row.id)
      .order("position", { ascending: true }),
    admin.from("profiles").select("company, company_logo_url").eq("id", row.created_by).maybeSingle(),
  ]);
  const items = (itemRows as any[]) ?? [];
  const urlMap = await resolvePhotoUrls(items.map((i) => i.photo_id));

  return {
    status: "ok",
    showcase: {
      title: row.title,
      tagline: row.tagline,
      layout: row.layout,
      items: items.map((i) => ({
        photo_id: i.photo_id,
        caption: sanitizeCaption(i.caption),
        image_url: urlMap.get(i.photo_id)?.image_url ?? "",
      })),
    },
    company: profile ? { name: (profile as any).company, logo_url: (profile as any).company_logo_url } : null,
  };
}
