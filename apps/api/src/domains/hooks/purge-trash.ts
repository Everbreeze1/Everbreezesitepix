import { jsonError, jsonOk } from "../../lib/errors";
import { verifyCronSecret } from "../../lib/cron-auth";
import { getSupabaseAdmin } from "../../lib/supabase";

export async function handlePurgeTrash(request: Request): Promise<Response> {
  if (!(await verifyCronSecret(request))) {
    return jsonError(401, "unauthorized", "Unauthorized");
  }

  try {
    const admin = getSupabaseAdmin();
    const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();

    const { data: expiredPhotos } = await admin
      .from("photos")
      .select("id, storage_path")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .limit(2000);
    const photoRows =
      (expiredPhotos as Array<{ id: string; storage_path: string }>) ?? [];
    const photoPaths = photoRows.map((r) => r.storage_path);
    const photoIds = photoRows.map((r) => r.id);

    let photosPurged = 0;
    if (photoIds.length) {
      const { error: delErr } = await admin.from("photos").delete().in("id", photoIds);
      if (!delErr) photosPurged = photoIds.length;
      for (let i = 0; i < photoPaths.length; i += 500) {
        await admin.storage
          .from("site-photos")
          .remove(photoPaths.slice(i, i + 500))
          .catch(() => {});
      }
    }

    const { data: expiredProjects } = await admin
      .from("projects")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .limit(1000);
    const projectIds = ((expiredProjects as Array<{ id: string }>) ?? []).map(
      (r) => r.id,
    );

    let projectsPurged = 0;
    if (projectIds.length) {
      const { data: remainingPhotos } = await admin
        .from("photos")
        .select("storage_path")
        .in("project_id", projectIds);
      const remainingPaths = (
        (remainingPhotos as Array<{ storage_path: string }>) ?? []
      ).map((r) => r.storage_path);
      for (let i = 0; i < remainingPaths.length; i += 500) {
        await admin.storage
          .from("site-photos")
          .remove(remainingPaths.slice(i, i + 500))
          .catch(() => {});
      }

      const { error: delErr } = await admin
        .from("projects")
        .delete()
        .in("id", projectIds);
      if (!delErr) projectsPurged = projectIds.length;
    }

    return jsonOk({ ok: true, photosPurged, projectsPurged, cutoff });
  } catch (e) {
    console.error("purge-trash error", e);
    return jsonError(500, "internal_error", "Internal error");
  }
}
