import { z } from "zod";
import type { ServiceContext } from "../../lib/user-context";
import { getSupabaseAdmin } from "../../lib/supabase";

export const createPhotoShareInputSchema = z.object({
  photoId: z.string().uuid(),
  expiresInHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 365),
  allowDownload: z.boolean(),
});

export const listPhotoSharesInputSchema = z.object({ photoId: z.string().uuid() });
export const revokePhotoShareInputSchema = z.object({ shareId: z.string().uuid() });
export const publicPhotoShareInputSchema = z.object({ token: z.string().uuid() });

export interface PublicPhotoShare {
  status: "ok" | "not_found" | "expired" | "revoked";
  photo: {
    id: string;
    caption: string | null;
    phase: string | null;
    tags: string[];
    taken_at: string | null;
    created_at: string;
    latitude: number | null;
    longitude: number | null;
    image_url: string;
  } | null;
  project: {
    name: string;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  } | null;
  company: {
    name: string | null;
    logo_url: string | null;
  } | null;
  allowDownload: boolean;
  expiresAt: string | null;
}

export async function createPhotoShareService(
  ctx: ServiceContext,
  data: z.infer<typeof createPhotoShareInputSchema>,
) {
  const { data: photo, error: pErr } = await ctx.supabase
    .from("photos")
    .select("id")
    .eq("id", data.photoId)
    .maybeSingle();
  if (pErr || !photo) throw new Error("Photo not found or not yours");

  const expires_at =
    data.expiresInHours > 0
      ? new Date(Date.now() + data.expiresInHours * 3_600_000).toISOString()
      : null;

  const { data: row, error } = await ctx.supabase
    .from("photo_shares")
    .insert({
      photo_id: data.photoId,
      created_by: ctx.userId,
      allow_download: data.allowDownload,
      expires_at,
    })
    .select("id, token, expires_at, allow_download, created_at, revoked_at")
    .single();
  if (error || !row) throw new Error(error?.message ?? "Could not create share");
  return row;
}

export async function listPhotoSharesService(
  ctx: ServiceContext,
  data: z.infer<typeof listPhotoSharesInputSchema>,
) {
  const { data: rows, error } = await ctx.supabase
    .from("photo_shares")
    .select("id, token, expires_at, allow_download, created_at, revoked_at")
    .eq("photo_id", data.photoId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return rows ?? [];
}

export async function revokePhotoShareService(
  ctx: ServiceContext,
  data: z.infer<typeof revokePhotoShareInputSchema>,
) {
  const { error } = await ctx.supabase
    .from("photo_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", data.shareId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getPublicPhotoShareService(
  data: z.infer<typeof publicPhotoShareInputSchema>,
): Promise<PublicPhotoShare> {
  const supabaseAdmin = getSupabaseAdmin();

  const empty = (status: PublicPhotoShare["status"]): PublicPhotoShare => ({
    status,
    photo: null,
    project: null,
    company: null,
    allowDownload: false,
    expiresAt: null,
  });

  const { data: share } = await supabaseAdmin
    .from("photo_shares")
    .select("id, photo_id, allow_download, expires_at, revoked_at, created_by")
    .eq("token", data.token)
    .maybeSingle();
  if (!share) return empty("not_found");
  if (share.revoked_at) return empty("revoked");
  if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) {
    return empty("expired");
  }

  // `as any`: packages/db/src/database.ts is stale and does not know about
  // `photos.deleted_at` / `projects.deleted_at`, though both columns are live
  // (the trash flow writes them). Same escape hatch used elsewhere in the API.
  const { data: photo } = await (supabaseAdmin as any)
    .from("photos")
    .select(
      "id, project_id, storage_path, image_url, caption, phase, tags, taken_at, created_at, latitude, longitude, deleted_at",
    )
    .eq("id", share.photo_id)
    .maybeSingle();
  if (!photo) return empty("not_found");
  /*
   * Trashing must take the public link down with it.
   *
   * Deleting a photo did not touch its shares, and nothing here filtered
   * `deleted_at`, so a contractor who removed a photo - often precisely because
   * a client asked them to, or because it showed something it shouldn't - kept
   * serving it in full to anyone holding the link. Trash is a 60-day window, and
   * with no scheduler running the purge hook (see LAUNCH.md §4.4) it is
   * effectively forever.
   *
   * Reported as "revoked" rather than "not_found": the share genuinely did exist
   * and was withdrawn, and that is the more useful thing for the recipient to
   * see.
   */
  if (photo.deleted_at) return empty("revoked");

  let imageUrl = photo.image_url as string | null;
  if (!imageUrl) {
    const { data: signed } = await supabaseAdmin.storage
      .from("site-photos")
      .createSignedUrl(photo.storage_path, 60 * 60);
    imageUrl = signed?.signedUrl ?? "";
  }

  const { data: project } = await (supabaseAdmin as any)
    .from("projects")
    .select("name, street, city, state, zip, deleted_at")
    .eq("id", photo.project_id)
    .maybeSingle();
  // Trashing the whole project has to revoke its photos' links too.
  if (project?.deleted_at) return empty("revoked");

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company, company_logo_url, watermark_enabled")
    .eq("id", share.created_by)
    .maybeSingle();

  return {
    status: "ok",
    photo: {
      id: photo.id,
      caption: photo.caption,
      phase: photo.phase,
      tags: photo.tags ?? [],
      taken_at: photo.taken_at,
      created_at: photo.created_at,
      latitude: photo.latitude,
      longitude: photo.longitude,
      image_url: imageUrl ?? "",
    },
    project: project
      ? {
          name: project.name,
          street: project.street ?? null,
          city: project.city ?? null,
          state: project.state ?? null,
          zip: project.zip ?? null,
        }
      : null,
    company: profile
      ? {
          name: profile.company ?? null,
          logo_url: profile.watermark_enabled !== false ? (profile.company_logo_url ?? null) : null,
        }
      : null,
    allowDownload: share.allow_download,
    expiresAt: share.expires_at,
  };
}
