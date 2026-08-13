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
 *   - `share_revoked_at` is the owner's off switch, and it starts engaged: the
 *     column defaults to `now()`, so a project is not shared until its owner
 *     publishes it (20260817000000 spells out why publishing is an act)
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

/**
 * "`share_decided_at` isn't there yet" — the one error worth swallowing.
 *
 * Migrations here are applied by hand in the Supabase SQL editor, so a deploy
 * can land in front of 20260818000300 by minutes or by a day. Everything that
 * touches the new column is written to fall back to the behaviour that shipped
 * without it: the QR dialog opens on a link the owner turns on themselves, and
 * the on/off switch keeps working. Publishing on first open then starts the
 * moment the column exists, with nothing to redeploy.
 *
 * Both codes mean the same thing — Postgres does not know the column
 * (`42703`), or PostgREST's schema cache does not yet (`PGRST204`) — and this
 * file names exactly one column that could be missing.
 */
const missingDecidedColumn = (error: { code?: string } | null): boolean =>
  !!error && (error.code === "42703" || error.code === "PGRST204");

// ============================================================
// Owner side — read and flip the switch
// ============================================================

export const getProjectShareInputSchema = z.object({ projectId: z.string().uuid() });
export const ensureProjectShareInputSchema = z.object({ projectId: z.string().uuid() });
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
 * Reads the link, publishing it if nobody has ever chosen either way.
 *
 * What the QR dialog opens with. `share_revoked_at` alone cannot distinguish
 * "the owner switched this off" from "this project has never been asked about",
 * and the two deserve opposite answers: the first is a decision to respect, the
 * second is someone who just opened *QR code for this job* being asked whether
 * they meant it. `share_decided_at` is the column that tells them apart — see
 * 20260818000300 — and it is NULL only until the first answer of either kind.
 *
 * The publish is the `.is("share_decided_at", null)` filter on the UPDATE, not
 * a read followed by a write. One statement means two dialogs opened at once
 * cannot both publish, and a link its owner turned off is untouchable here no
 * matter how often anyone opens the dialog: the row simply stops matching.
 *
 * A foreign project matches zero rows for the same reason a foreign project
 * matches zero rows in `setProjectShareService` — RLS — and falls through to
 * the read, which answers 404. Opening a dialog you have no business opening
 * therefore publishes nothing.
 */
export async function ensureProjectShareService(
  ctx: AuthedContext,
  data: z.infer<typeof ensureProjectShareInputSchema>,
): Promise<ProjectShareState> {
  const { data: rows, error } = await (ctx.supabase as any)
    .from("projects")
    .update({ share_revoked_at: null, share_decided_at: new Date().toISOString() })
    .eq("id", data.projectId)
    .is("share_decided_at", null)
    .select("share_token, share_revoked_at");
  // Before the migration lands there is nothing to publish on, and this becomes
  // the plain read it used to be — see `missingDecidedColumn`.
  if (error && !missingDecidedColumn(error)) throw new Error(error.message);
  const row = error ? null : ((rows as any[]) ?? [])[0];
  if (row) {
    return { shareToken: row.share_token as string, revokedAt: row.share_revoked_at ?? null };
  }
  // Zero rows means the question is already answered — or the project is not
  // the caller's. The read tells those two apart, and answers each correctly.
  return getProjectShareService(ctx, { projectId: data.projectId });
}

/**
 * Turns the public link on or off.
 *
 * The token is minted by the column default and never rotated here, so turning a
 * link off and on again resurrects the same URL — which is what someone who has
 * already printed and hung a QR sheet needs. Rotating on re-enable would silently
 * kill every code already taped to a door.
 *
 * Either direction stamps `share_decided_at`: an owner who turns a link off has
 * decided, and that has to be the end of `ensureProjectShareService` ever
 * turning it back on for them.
 */
export async function setProjectShareService(
  ctx: AuthedContext,
  data: z.infer<typeof setProjectShareInputSchema>,
): Promise<ProjectShareState> {
  const revokedAt = data.enable ? null : new Date().toISOString();
  const write = (patch: Record<string, unknown>) =>
    (ctx.supabase as any)
      .from("projects")
      .update(patch)
      .eq("id", data.projectId)
      .select("share_token, share_revoked_at");

  let { data: rows, error } = await write({
    share_revoked_at: revokedAt,
    share_decided_at: new Date().toISOString(),
  });
  // The switch predates the column and must not start failing because of it.
  if (missingDecidedColumn(error)) {
    ({ data: rows, error } = await write({ share_revoked_at: revokedAt }));
  }
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
