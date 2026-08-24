import { z } from "zod";
import { allPhotoObjectPaths } from "@everlumen/shared";
import type { ServiceContext } from "../../lib/user-context";
import { chunk, mutateIn, selectIn } from "../../lib/chunked-in";

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
  const list =
    (rows as Array<{
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
  // Chunked: a single `.in()` over ~398+ ids dies on PostgREST's echoed
  // Content-Location header, which made "Select all" in Trash a guaranteed 500.
  await mutateIn(
    data.photoIds,
    (idChunk) =>
      (ctx.supabase as any).from("photos").update({ deleted_at: null }).in("id", idChunk),
    "restore photos",
  );
  return { restored: data.photoIds.length };
}

export async function purgePhotosService(
  ctx: ServiceContext,
  data: z.infer<typeof purgePhotosInputSchema>,
) {
  // Chunked for the same reason as restore. RLS still scopes both statements to
  // what the caller may touch - this runs on ctx.supabase, not the service role.
  const rows = await selectIn<{ id: string; storage_path: string; thumb_path: string | null }>(
    data.photoIds,
    (idChunk) =>
      (ctx.supabase as any).from("photos").select("id, storage_path, thumb_path").in("id", idChunk),
    "purge photos lookup",
  );
  // Originals and their stored thumbnails - a thumbnail left behind is
  // unreachable once its row is gone, same as an orphaned original.
  const paths = allPhotoObjectPaths(rows);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { purged: 0 };

  await mutateIn(
    ids,
    (idChunk) => (ctx.supabase as any).from("photos").delete().in("id", idChunk),
    "purge photos",
  );
  // Storage removal is best-effort and also batched: `remove()` takes the whole
  // path list in one request body, but a few thousand paths is a large payload,
  // and a rejection here would otherwise strand the blobs with no DB row left to
  // find them by.
  for (const pathChunk of chunk(paths)) {
    await ctx.supabase.storage
      .from("site-photos")
      .remove(pathChunk)
      .catch(() => {});
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

  const list =
    (rows as Array<{
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

  /*
   * Delete the children explicitly instead of trusting ON DELETE CASCADE.
   *
   * `photos`, `videos` and `ai_analyses` predate the migrations folder - nothing
   * in supabase/migrations creates them - and in this database they carry no
   * foreign key to `projects`. So the project row went away, the cascade never
   * ran, and their rows survived with their blobs already deleted: permanent
   * dead tiles in the Gallery that no UI can remove, because the project they
   * point at no longer exists.
   *
   * Doing this explicitly is correct whether or not the FK is there - with a
   * cascade it is a harmless no-op that runs microseconds earlier.
   *
   * Videos were worse than photos: their blobs were never removed at all, so
   * every purge leaked the entire `site-videos` object for that project.
   */
  const [{ data: photos }, { data: videos }] = await Promise.all([
    (ctx.supabase as any)
      .from("photos")
      .select("storage_path, thumb_path")
      .eq("project_id", data.projectId),
    (ctx.supabase as any).from("videos").select("storage_path").eq("project_id", data.projectId),
  ]);

  const removeAll = async (bucket: string, paths: string[]) => {
    for (const pathChunk of chunk(paths.filter(Boolean), 500)) {
      await ctx.supabase.storage
        .from(bucket)
        .remove(pathChunk)
        .catch(() => {});
    }
  };
  // Photos carry a second object each - their stored thumbnail.
  await removeAll("site-photos", allPhotoObjectPaths(photos ?? []));
  await removeAll(
    "site-videos",
    ((videos ?? []) as Array<{ storage_path: string }>).map((r) => r.storage_path),
  );

  // Rows before the parent, so a failure here leaves the project in Trash to be
  // retried rather than an unreachable project id scattered across three tables.
  for (const table of ["photos", "videos", "ai_analyses"]) {
    const { error: childErr } = await (ctx.supabase as any)
      .from(table)
      .delete()
      .eq("project_id", data.projectId);
    // `ai_analyses` may not be project-scoped in every database; a missing table
    // or column must not block the purge.
    if (childErr && !/PGRST20[45]|42P01|42703/.test(childErr.code ?? "")) {
      throw new Error(`${table}: ${childErr.message}`);
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
