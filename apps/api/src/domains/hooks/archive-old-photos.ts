import { jsonError, jsonOk } from "../../lib/errors";
import { verifyCronSecret } from "../../lib/cron-auth";
import { getSupabaseAdmin, requireSitepixSupabaseUrl } from "../../lib/supabase";

export async function handleArchiveOldPhotos(
  request: Request,
): Promise<Response> {
  if (!(await verifyCronSecret(request))) {
    return jsonError(401, "unauthorized", "Unauthorized");
  }

  try {
    const admin = getSupabaseAdmin();
    const cutoff = new Date(
      Date.now() - 1000 * 60 * 60 * 24 * 30 * 6,
    ).toISOString();
    const { data: photos, error } = await admin
      .from("photos")
      .select("id, storage_path, size_bytes")
      .eq("archived", false)
      .lt("created_at", cutoff)
      .limit(50);
    if (error) return jsonError(500, "query_failed", error.message);

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

    return jsonOk({
      ok: true,
      scanned: photos?.length ?? 0,
      processed,
      bytesSaved,
      failures,
    });
  } catch (e) {
    console.error("archive-old-photos error", e);
    return jsonError(500, "internal_error", "Internal error");
  }
}
