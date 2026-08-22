import { jsonError, jsonOk } from "../../lib/errors";
import { verifyCronSecret } from "../../lib/cron-auth";
import { getSupabaseAdmin, requireSitepixSupabaseUrl } from "../../lib/supabase";
import { recordJobRun } from "../../lib/job-run";

/**
 * Off unless `PHOTO_ARCHIVE_ENABLED` is truthy.
 *
 * This job downscales six-month-old originals in place through Storage's
 * `render/image` endpoint - which is metered by *distinct origin image per
 * billing cycle*, 100 on the Pro plan. It therefore spends the resource the
 * organization is out of (transformations: 170% of quota) to reclaim the one it
 * has in surplus (storage: 0.012 of 100 GB used), at up to 50 images per run.
 * That trade is backwards at the current scale, so it stays disabled until
 * storage is actually the constraint.
 *
 * Kept rather than deleted: the logic is correct and will be worth running once
 * there is enough stored data to justify it.
 *
 * `photos.archived` IS NOT THE ARCHIVE THE TEMPLATE PAGES OFFER. There it is a
 * user's decision, with a toggle and a "Show archived" filter. Here it means
 * only "this original has already been downscaled" - same row, same
 * storage_path, fewer bytes, nothing about it hidden. The scan below is the one
 * correct use of the column: finding the photos this job has not processed yet.
 *
 * No READ may use it to exclude a photo from a user-facing surface. Five did -
 * the gallery, its total count, the calendar, the activity heatmap and the
 * showcase builder - which meant enabling this job would have quietly started
 * emptying users' older photos out of their own gallery. Those are gone; see
 * the note in GalleryPage's loadPhotos.
 */
function archiveEnabled(): boolean {
  const raw = process.env.PHOTO_ARCHIVE_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export async function handleArchiveOldPhotos(request: Request): Promise<Response> {
  if (!(await verifyCronSecret(request))) {
    return jsonError(401, "unauthorized", "Unauthorized");
  }

  if (!archiveEnabled()) {
    return jsonOk({
      ok: true,
      skipped: "disabled",
      reason:
        "PHOTO_ARCHIVE_ENABLED is not set. This job consumes Storage image-transformation quota to save storage; see the note in archive-old-photos.ts.",
      scanned: 0,
      processed: 0,
      bytesSaved: 0,
      failures: [],
    });
  }

  try {
    const summary = await recordJobRun("archive-old-photos", async () => {
      const admin = getSupabaseAdmin();
      const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6).toISOString();
      const { data: photos, error } = await admin
        .from("photos")
        .select("id, storage_path, size_bytes")
        .eq("archived", false)
        .lt("created_at", cutoff)
        .limit(50);
      if (error) throw new Error(error.message);

      let processed = 0;
      let bytesSaved = 0;
      const failures: { id: string; reason: string }[] = [];

      for (const p of photos ?? []) {
        try {
          const renderUrl = `${requireSitepixSupabaseUrl()}/storage/v1/render/image/authenticated/site-photos/${p.storage_path}?width=1280&quality=70&resize=contain`;
          const resp = await fetch(renderUrl, {
            headers: {
              Authorization: `Bearer ${process.env.SITEPIX_SUPABASE_SERVICE_ROLE_KEY}`,
            },
          });
          if (!resp.ok) {
            failures.push({ id: p.id, reason: `render ${resp.status}` });
            continue;
          }
          const buf = new Uint8Array(await resp.arrayBuffer());
          if (buf.byteLength === 0) {
            failures.push({ id: p.id, reason: "empty render" });
            continue;
          }
          const { error: upErr } = await admin.storage
            .from("site-photos")
            .upload(p.storage_path, buf, {
              contentType: "image/jpeg",
              upsert: true,
            });
          if (upErr) {
            failures.push({ id: p.id, reason: upErr.message });
            continue;
          }
          const before = Number(p.size_bytes ?? 0);
          const after = buf.byteLength;
          bytesSaved += Math.max(0, before - after);
          await admin
            .from("photos")
            .update({
              archived: true,
              archived_at: new Date().toISOString(),
              size_bytes: after,
            })
            .eq("id", p.id);
          processed++;
        } catch (e: unknown) {
          failures.push({
            id: p.id,
            reason: e instanceof Error ? e.message : "unknown",
          });
        }
      }

      return {
        result: { scanned: photos?.length ?? 0, processed, bytesSaved, failures },
        rowsAffected: processed,
        meta: { scanned: photos?.length ?? 0, bytesSaved, failureCount: failures.length },
      };
    });

    return jsonOk({ ok: true, ...summary });
  } catch (e) {
    console.error("archive-old-photos error", e);
    return jsonError(500, "internal_error", "Internal error");
  }
}
