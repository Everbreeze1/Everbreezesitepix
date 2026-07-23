import { z } from "zod";
import type { ServiceContext } from "../../lib/user-context";

export const TRASH_RETENTION_DAYS = 60;

function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return TRASH_RETENTION_DAYS;
  const purgeAt = new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * 86400_000;
  const left = Math.ceil((purgeAt - Date.now()) / 86400_000);
  return Math.max(0, left);
}

export const listTrashedPhotosInputSchema = z.object({ projectId: z.string().uuid() });
export const restorePhotosInputSchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1),
});
export const purgePhotosInputSchema = z.object({
  photoIds: z.array(z.string().uuid()).min(1),
});
export const softDeleteProjectInputSchema = z.object({ projectId: z.string().uuid() });
export const restoreProjectInputSchema = z.object({ projectId: z.string().uuid() });
export const purgeProjectInputSchema = z.object({ projectId: z.string().uuid() });

export async function listTrashedPhotosService(
  ctx: ServiceContext,
  data: z.infer<typeof listTrashedPhotosInputSchema>,
) {
  const { data: rows, error } = await (ctx.supabase as any)
    .from("photos")
    .select("id, storage_path, image_url, caption, tags, taken_at, created_at, deleted_at")
    .eq("project_id", data.projectId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const list = (rows as Array<{
    id: string;
    storage_path: string;
    image_url: string | null;
    caption: string | null;
    tags: string[] | null;
    taken_at: string | null;
    created_at: string;
    deleted_at: string;
  }>) ?? [];

  const toSign = list.filter((r) => !r.image_url).map((r) => r.storage_path);
  const signedMap: Record<string, string> = {};
  if (toSign.length) {
    const { data: signed } = await ctx.supabase.storage
      .from("site-photos")
      .createSignedUrls(toSign, 60 * 60);
    signed?.forEach((s, i) => {
      if (s.signedUrl) signedMap[toSign[i]] = s.signedUrl;
    });
  }
  return {
    photos: list.map((r) => ({
      id: r.id,
      storage_path: r.storage_path,
      url: r.image_url ?? signedMap[r.storage_path] ?? "",
      caption: r.caption,
      tags: (r.tags ?? []) as string[],
      deleted_at: r.deleted_at,
      days_left: daysLeft(r.deleted_at),
    })),
  };
}

export async function restorePhotosService(
  ctx: ServiceContext,
  data: z.infer<typeof restorePhotosInputSchema>,
) {
  const { error } = await (ctx.supabase as any)
    .from("photos")
    .update({ deleted_at: null })
    .in("id", data.photoIds);
  if (error) throw new Error(error.message);
  return { restored: data.photoIds.length };
}

export async function purgePhotosService(
  ctx: ServiceContext,
  data: z.infer<typeof purgePhotosInputSchema>,
) {
  const { data: rows, error: selErr } = await (ctx.supabase as any)
    .from("photos")
    .select("id, storage_path")
    .in("id", data.photoIds);
  if (selErr) throw new Error(selErr.message);
  const paths = ((rows as Array<{ id: string; storage_path: string }>) ?? []).map(
    (r) => r.storage_path,
  );
  const ids = ((rows as Array<{ id: string }>) ?? []).map((r) => r.id);
  if (!ids.length) return { purged: 0 };

  const { error: delErr } = await (ctx.supabase as any)
    .from("photos")
    .delete()
    .in("id", ids);
  if (delErr) throw new Error(delErr.message);
  if (paths.length) {
    await ctx.supabase.storage.from("site-photos").remove(paths).catch(() => {});
  }
  return { purged: ids.length };
}

export async function listTrashedProjectsService(ctx: ServiceContext) {
  const { data: rows, error } = await (ctx.supabase as any)
    .from("projects")
    .select(
      "id, name, description, street, city, state, zip, status, deleted_at, updated_at, owner_id",
    )
    .eq("owner_id", ctx.userId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(error.message);

  const list = (rows as Array<{
    id: string;
    name: string;
    description: string | null;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    status: string;
    deleted_at: string;
  }>) ?? [];
  const ids = list.map((r) => r.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: ph } = await (ctx.supabase as any)
      .from("photos")
      .select("project_id")
      .in("project_id", ids);
    ((ph as Array<{ project_id: string }>) ?? []).forEach((p) => {
      counts[p.project_id] = (counts[p.project_id] ?? 0) + 1;
    });
  }
  return {
    projects: list.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      location: [r.street, r.city, r.state, r.zip].filter(Boolean).join(", "),
      status: r.status,
      deleted_at: r.deleted_at,
      days_left: daysLeft(r.deleted_at),
      photo_count: counts[r.id] ?? 0,
    })),
  };
}

export async function softDeleteProjectService(
  ctx: ServiceContext,
  data: z.infer<typeof softDeleteProjectInputSchema>,
) {
  const { error } = await (ctx.supabase as any)
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", data.projectId)
    .eq("owner_id", ctx.userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function restoreProjectService(
  ctx: ServiceContext,
  data: z.infer<typeof restoreProjectInputSchema>,
) {
  const { error } = await (ctx.supabase as any)
    .from("projects")
    .update({ deleted_at: null })
    .eq("id", data.projectId)
    .eq("owner_id", ctx.userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function purgeProjectService(
  ctx: ServiceContext,
  data: z.infer<typeof purgeProjectInputSchema>,
) {
  const { data: proj } = await (ctx.supabase as any)
    .from("projects")
    .select("id, owner_id")
    .eq("id", data.projectId)
    .maybeSingle();
  if (!proj || (proj as { owner_id: string }).owner_id !== ctx.userId) {
    throw new Error("Project not found");
  }

  const { data: photos } = await (ctx.supabase as any)
    .from("photos")
    .select("storage_path")
    .eq("project_id", data.projectId);
  const paths = ((photos as Array<{ storage_path: string }>) ?? []).map((p) => p.storage_path);
  if (paths.length) {
    for (let i = 0; i < paths.length; i += 500) {
      await ctx.supabase.storage
        .from("site-photos")
        .remove(paths.slice(i, i + 500))
        .catch(() => {});
    }
  }

  const { error } = await (ctx.supabase as any)
    .from("projects")
    .delete()
    .eq("id", data.projectId)
    .eq("owner_id", ctx.userId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getTrashCountsService(ctx: ServiceContext) {
  const [{ count: projectsCount }, { count: photosCount }] = await Promise.all([
    (ctx.supabase as any)
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ctx.userId)
      .not("deleted_at", "is", null),
    (ctx.supabase as any)
      .from("photos")
      .select("id", { count: "exact", head: true })
      .not("deleted_at", "is", null),
  ]);
  return {
    projects: (projectsCount as number) ?? 0,
    photos: (photosCount as number) ?? 0,
  };
}
