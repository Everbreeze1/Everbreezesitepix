import { jsonError, jsonOk } from "../../lib/errors";
import { verifyCronSecret } from "../../lib/cron-auth";
import { getSupabaseAdmin } from "../../lib/supabase";
import { chunk, mutateIn, selectIn } from "../../lib/chunked-in";
import { allPhotoObjectPaths } from "@sitepix/shared";

export async function handlePurgeTrash(request: Request): Promise<Response> {
  if (!(await verifyCronSecret(request))) {
    return jsonError(401, "unauthorized", "Unauthorized");
  }

  try {
    const admin = getSupabaseAdmin();
    const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString();

    const { data: expiredPhotos } = await admin
      .from("photos")
      .select("id, storage_path, thumb_path")
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff)
      .limit(2000);
    const photoRows =
      (expiredPhotos as Array<{ id: string; storage_path: string; thumb_path: string | null }>) ??
      [];
    // Each photo owns two objects now: the original and its stored thumbnail.
    const photoPaths = allPhotoObjectPaths(photoRows);
    const photoIds = photoRows.map((r) => r.id);

    let photosPurged = 0;
    if (photoIds.length) {
      // Chunked: the `.limit(2000)` above means this routinely exceeded the ~398
      // id ceiling where PostgREST's echoed Content-Location header overflows
      // Node's 16 KB header limit, so the delete threw and 60-day retention
      // never actually ran. `mutateIn` also throws instead of the old
      // `if (!delErr)`, which reported `photosPurged: 0` alongside `ok: true` —
      // a cron that looks healthy while doing nothing is worse than one that fails.
      await mutateIn(
        photoIds,
        (idChunk) => admin.from("photos").delete().in("id", idChunk),
        "purge expired photos",
      );
      photosPurged = photoIds.length;
      for (const pathChunk of chunk(photoPaths, 500)) {
        await admin.storage.from("site-photos").remove(pathChunk).catch(() => {});
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
      // Same chunking, same reason — `.limit(1000)` above.
      const remaining = await selectIn<{ storage_path: string; thumb_path: string | null }>(
        projectIds,
        (idChunk) =>
          admin.from("photos").select("storage_path, thumb_path").in("project_id", idChunk) as any,
        "expired project photos",
      );
      // Blobs first: once the project row is gone the cascade takes the photo
      // rows with it, and there is nothing left to find these paths by.
      for (const pathChunk of chunk(allPhotoObjectPaths(remaining), 500)) {
        await admin.storage.from("site-photos").remove(pathChunk).catch(() => {});
      }

      await mutateIn(
        projectIds,
        (idChunk) => admin.from("projects").delete().in("id", idChunk),
        "purge expired projects",
      );
      projectsPurged = projectIds.length;
    }

    return jsonOk({ ok: true, photosPurged, projectsPurged, cutoff });
  } catch (e) {
    console.error("purge-trash error", e);
    return jsonError(500, "internal_error", "Internal error");
  }
}
