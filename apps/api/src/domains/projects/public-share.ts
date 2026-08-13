import { z } from "zod";
import { thumbPathFor } from "@sitepix/shared";
import { getSupabaseAdmin } from "../../lib/supabase";
import type { AuthedContext } from "../../lib/user-context";

/**
 * The public link behind a project's QR code.
 *
 * A QR code printed on a job site is scanned by whoever is standing in front of
 * it — the homeowner, an inspector, a sub, the next crew. None of them have an
 * account, and the previous code encoded `/projects/<id>`, so every scan hit the
 * login wall. This is the read side of a link that doesn't.
 *
 * What an anonymous visitor gets is deliberately narrower than the app's project
 * page: the job's identity, and the photographic record. No tasks, no documents,
 * no checklists, no team, no description — the crew's working notes are not what
 * a client asked to see, and a code taped to a door is not a credential anyone
 * chose to hand out.
 *
 * Every guard mirrors `getPublicChecklistService` (field-records.ts), for the
 * same reasons:
 *   - the token is the only credential, so nothing is trusted from the caller
 *   - `share_revoked_at` is the owner's off switch, and it starts ON
 *   - a trashed project takes its link down with it
 *   - trashed photos never reach the page — a photo is often deleted precisely
 *     because someone asked for it to be
 */

const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Ceiling on how many photos one anonymous request can pull.
 *
 * Every photo past this point costs a signed URL, and this endpoint takes no
 * credential — an unbounded project is an unbounded response to anyone holding
 * a link. Newest first, so the cap trims the oldest history rather than the
 * work that was just done.
 */
const MAX_PUBLIC_PHOTOS = 300;

export interface PublicProjectSharePhoto {
  id: string;
  /** Full-size URL — the copy a client zooms into. */
  url: string;
  /** Grid-sized URL, falling back to the full-size object when no thumb exists. */
  thumbUrl: string;
  caption: string | null;
  phase: string | null;
  takenAt: string;
}

export interface PublicProjectShare {
  status: "ok" | "not_found" | "revoked";
  project: {
    name: string;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    status: string;
    /** Total photos on the project, which may exceed the number returned. */
    photoCount: number;
    /** Oldest and newest capture in the returned set, for the date range line. */
    firstPhotoAt: string | null;
    lastPhotoAt: string | null;
  } | null;
  company: {
    name: string | null;
    logo_url: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  photos: PublicProjectSharePhoto[];
}

const empty = (status: PublicProjectShare["status"]): PublicProjectShare => ({
  status,
  project: null,
  company: null,
  photos: [],
});

/**
 * "That project isn't yours, or isn't there" — as a client error, not a crash.
 *
 * 404 rather than 403 for both cases deliberately: RLS filters a foreign row out
 * of the result set rather than erroring, so the two are genuinely
 * indistinguishable here, and answering 403 would confirm to a prober that a
 * project with that id exists.
 *
 * The `status` property is what `jsonFromUnknownError` (lib/errors.ts) reads to
 * emit a real 404 `not_found`. Without it an ownership rejection reaches the
 * client as a 500 `internal_error` — the wrong status for retries, and a
 * permission check that reads like a server fault in the logs.
 */
const notYours = () => Object.assign(new Error("Project not found"), { status: 404 });

// ============================================================
// Owner side — read and flip the switch
// ============================================================

export const getProjectShareInputSchema = z.object({ projectId: z.string().uuid() });
export const setProjectShareInputSchema = z.object({
  projectId: z.string().uuid(),
  enable: z.boolean(),
});

export interface ProjectShareState {
  shareToken: string;
  /** ISO timestamp when the link was switched off, or null while it is live. */
  revokedAt: string | null;
}

/**
 * Reads the project's link without changing it.
 *
 * Goes through `ctx.supabase` — the caller's RLS-scoped client — so the token
 * only ever comes back to someone the `projects` policies already let read the
 * row. `as any` because packages/db's generated types predate these two columns.
 */
export async function getProjectShareService(
  ctx: AuthedContext,
  data: z.infer<typeof getProjectShareInputSchema>,
): Promise<ProjectShareState> {
  const { data: row, error } = await (ctx.supabase as any)
    .from("projects")
    .select("share_token, share_revoked_at")
    .eq("id", data.projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw notYours();
  return { shareToken: row.share_token as string, revokedAt: row.share_revoked_at ?? null };
}

/**
 * Turns the public link on or off.
 *
 * The token is minted by the column default and never rotated here, so turning a
 * link off and on again resurrects the same URL — which is what someone who has
 * already printed and hung a QR sheet needs. Rotating on re-enable would silently
 * kill every code already taped to a door.
 */
export async function setProjectShareService(
  ctx: AuthedContext,
  data: z.infer<typeof setProjectShareInputSchema>,
): Promise<ProjectShareState> {
  const { data: rows, error } = await (ctx.supabase as any)
    .from("projects")
    .update({ share_revoked_at: data.enable ? null : new Date().toISOString() })
    .eq("id", data.projectId)
    .select("share_token, share_revoked_at");
  if (error) throw new Error(error.message);
  const row = ((rows as any[]) ?? [])[0];
  // RLS filters an UPDATE to zero rows rather than erroring, so "not yours" and
  // "doesn't exist" arrive here identically — and are answered identically.
  if (!row) throw notYours();
  return { shareToken: row.share_token as string, revokedAt: row.share_revoked_at ?? null };
}

// ============================================================
// Public side — no credential but the token
// ============================================================

export const publicProjectShareInputSchema = z.object({ token: z.string().uuid() });

export async function getPublicProjectShareService(
  data: z.infer<typeof publicProjectShareInputSchema>,
): Promise<PublicProjectShare> {
  const admin = getSupabaseAdmin();

  const { data: project } = await (admin as any)
    .from("projects")
    .select("id, created_by, name, street, city, state, zip, status, share_revoked_at, deleted_at")
    .eq("share_token", data.token)
    .maybeSingle();
  if (!project) return empty("not_found");
  if (project.share_revoked_at) return empty("revoked");
  // Trashing the job has to take its public link down with it. `deleted_at` is a
  // 60-day window and nothing schedules the purge, so without this the link
  // outlives the project it describes — indefinitely.
  if (project.deleted_at) return empty("revoked");

  const [{ data: photoRows, count }, { data: profile }] = await Promise.all([
    (admin as any)
      .from("photos")
      .select("id, storage_path, thumb_path, image_url, caption, phase, taken_at, created_at", {
        count: "exact",
      })
      .eq("project_id", project.id)
      .is("deleted_at", null)
      .order("taken_at", { ascending: false, nullsFirst: false })
      .limit(MAX_PUBLIC_PHOTOS),
    admin
      .from("profiles")
      .select("company, company_logo_url, company_phone, company_address, watermark_enabled")
      .eq("id", project.created_by)
      .maybeSingle(),
  ]);

  type PhotoRow = {
    id: string;
    storage_path: string;
    thumb_path: string | null;
    image_url: string | null;
    caption: string | null;
    phase: string | null;
    taken_at: string | null;
    created_at: string;
  };
  const rows = ((photoRows as PhotoRow[]) ?? []).filter((r) => r.storage_path || r.image_url);

  /*
   * One batched signing call for both sizes, not one per row.
   *
   * A 300-photo project is 600 sequential round trips the singular
   * `createSignedUrl` way, on a request that anyone with the link can make.
   * `createSignedUrls` signs the whole array in one.
   */
  const fullPaths = rows.filter((r) => !r.image_url).map((r) => r.storage_path);
  const thumbPaths = rows.map((r) => r.thumb_path || thumbPathFor(r.storage_path));
  const signed = new Map<string, string>();
  const toSign = Array.from(new Set([...fullPaths, ...thumbPaths].filter(Boolean)));
  if (toSign.length) {
    const { data: urls } = await admin.storage
      .from("site-photos")
      .createSignedUrls(toSign, SIGNED_URL_TTL_SECONDS);
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
    }
  }

  const photos: PublicProjectSharePhoto[] = [];
  for (const r of rows) {
    const url = r.image_url ?? signed.get(r.storage_path) ?? "";
    if (!url) continue;
    // A thumbnail is an optimisation, never a gate: photos predating thumbnails
    // — and any upload whose thumb generation failed — fall back to the full
    // object rather than dropping out of the grid.
    const thumbUrl = signed.get(r.thumb_path || thumbPathFor(r.storage_path)) ?? url;
    photos.push({
      id: r.id,
      url,
      thumbUrl,
      caption: r.caption,
      phase: r.phase,
      takenAt: r.taken_at ?? r.created_at,
    });
  }

  const times = photos.map((p) => new Date(p.takenAt).getTime()).filter((t) => !Number.isNaN(t));

  const prof = profile as {
    company: string | null;
    company_logo_url: string | null;
    company_phone: string | null;
    company_address: string | null;
    watermark_enabled: boolean | null;
  } | null;

  return {
    status: "ok",
    project: {
      name: project.name,
      street: project.street ?? null,
      city: project.city ?? null,
      state: project.state ?? null,
      zip: project.zip ?? null,
      status: project.status,
      photoCount: count ?? photos.length,
      firstPhotoAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
      lastPhotoAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
    },
    company: prof
      ? {
          name: prof.company ?? null,
          // Same rule the photo share uses: the logo is letterhead, and a
          // company that switched branding off does not get branded anyway.
          logo_url: prof.watermark_enabled !== false ? (prof.company_logo_url ?? null) : null,
          phone: prof.company_phone ?? null,
          address: prof.company_address ?? null,
        }
      : null,
    photos,
  };
}
