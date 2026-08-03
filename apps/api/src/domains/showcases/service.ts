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

export interface ShowcaseSectionDetail {
  id: string;
  project_id: string | null;
  project_name: string | null;
  title: string | null;
  body_html: string | null;
  position: number;
  items: ShowcaseItemDetail[];
}

export interface ShowcaseDetail {
  id: string;
  title: string;
  tagline: string | null;
  layout: string;
  share_token: string;
  revoked_at: string | null;
  intro_html: string | null;
  outro_html: string | null;
  accent_color: string | null;
  show_contact: boolean;
  cover_photo_id: string | null;
  cover_image_url: string | null;
  sections: ShowcaseSectionDetail[];
}

/** Company details rendered in a showcase's masthead + contact block. */
export interface ShowcaseCompany {
  name: string | null;
  logo_url: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
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
  // A photo whose row is missing entirely (deleted, or the id never existed —
  // showcase_items.photo_id has no FK) never reaches `rows`, so it silently
  // has no entry in `out` and the caller's `?? ""` fallback kicks in. That's
  // fine; what must not happen is one bad `storage_path` poisoning every
  // *other* photo's signed URL in the same batch call.
  const needSign = rows.filter((r) => !r.image_url && r.storage_path);
  let signedMap: Record<string, string> = {};
  if (needSign.length) {
    const { data: signed, error } = await admin.storage
      .from("site-photos")
      .createSignedUrls(
        needSign.map((r) => r.storage_path),
        60 * 60,
      );
    if (error) {
      console.error("[showcases] failed to sign photo URLs", {
        error: error.message,
        count: needSign.length,
      });
    }
    signed?.forEach((s, i) => {
      if (s.signedUrl) signedMap[needSign[i].storage_path] = s.signedUrl;
      else if (s.error) {
        console.error("[showcases] failed to sign one photo URL", {
          storagePath: needSign[i].storage_path,
          error: s.error,
        });
      }
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

/**
 * Loads a showcase's sections with their photos, using whichever client is
 * passed (the caller's for the authed builder, the admin one for the public
 * page). Items written before the brochure migration have `section_id = NULL`;
 * they come back as one implicit untitled section so an old showcase keeps
 * rendering until it is next edited.
 */
async function loadSections(
  db: any,
  showcaseId: string,
): Promise<ShowcaseSectionDetail[]> {
  const [{ data: sectionRows }, { data: itemRows }] = await Promise.all([
    db
      .from("showcase_sections")
      .select("id, project_id, title, body_html, position")
      .eq("showcase_id", showcaseId)
      .order("position", { ascending: true }),
    db
      .from("showcase_items")
      .select("id, photo_id, caption, position, section_id")
      .eq("showcase_id", showcaseId)
      .order("position", { ascending: true }),
  ]);

  const sections = (sectionRows as any[]) ?? [];
  const items = (itemRows as any[]) ?? [];
  const urlMap = await resolvePhotoUrls(items.map((i) => i.photo_id));

  // Project names are looked up separately rather than via a PostgREST embed —
  // `project_id` is deliberately not a FK (see the migration), so an embed
  // cannot be resolved and would silently return nothing.
  const projectIds = Array.from(new Set(sections.map((s) => s.project_id).filter(Boolean)));
  const projectNames = new Map<string, string>();
  if (projectIds.length) {
    const { data: projectRows } = await getSupabaseAdmin()
      .from("projects")
      .select("id, name")
      .in("id", projectIds);
    ((projectRows as any[]) ?? []).forEach((p) => projectNames.set(p.id, p.name ?? ""));
  }

  const toDetail = (i: any): ShowcaseItemDetail => ({
    id: i.id,
    photo_id: i.photo_id,
    caption: sanitizeCaption(i.caption),
    position: i.position,
    image_url: urlMap.get(i.photo_id)?.image_url ?? "",
  });

  const out: ShowcaseSectionDetail[] = sections.map((s) => ({
    id: s.id,
    project_id: s.project_id ?? null,
    project_name: s.project_id ? (projectNames.get(s.project_id) ?? null) : null,
    title: s.title ?? null,
    body_html: s.body_html ?? null,
    position: s.position,
    items: items.filter((i) => i.section_id === s.id).map(toDetail),
  }));

  const ungrouped = items.filter((i) => !i.section_id);
  if (ungrouped.length) {
    out.push({
      id: "legacy-ungrouped",
      project_id: null,
      project_name: null,
      title: null,
      body_html: null,
      position: out.length,
      items: ungrouped.map(toDetail),
    });
  }
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

  const { data: countRows } = await (ctx.supabase as any)
    .from("showcase_items")
    .select("showcase_id, photo_id, position")
    .in("showcase_id", rows.map((r) => r.id))
    .order("position", { ascending: true });

  const countByShowcase = new Map<string, number>();
  const firstPhotoByShowcase = new Map<string, string>();
  ((countRows as any[]) ?? []).forEach((r) => {
    countByShowcase.set(r.showcase_id, (countByShowcase.get(r.showcase_id) ?? 0) + 1);
    if (!firstPhotoByShowcase.has(r.showcase_id) && r.photo_id) {
      firstPhotoByShowcase.set(r.showcase_id, r.photo_id);
    }
  });

  // Thumbnails fall back to the showcase's first photo when no explicit cover
  // was chosen — otherwise every card renders as an empty grey placeholder,
  // since nothing in the builder sets cover_photo_id.
  const thumbIdByShowcase = new Map<string, string>();
  rows.forEach((r) => {
    const id = r.cover_photo_id ?? firstPhotoByShowcase.get(r.id);
    if (id) thumbIdByShowcase.set(r.id, id);
  });
  const urlMap = await resolvePhotoUrls(Array.from(new Set(thumbIdByShowcase.values())));

  return {
    showcases: rows.map((r) => ({
      id: r.id,
      title: r.title,
      tagline: r.tagline,
      layout: r.layout,
      share_token: r.share_token,
      revoked_at: r.revoked_at,
      item_count: countByShowcase.get(r.id) ?? 0,
      cover_image_url: (() => {
        const thumbId = thumbIdByShowcase.get(r.id);
        return thumbId ? (urlMap.get(thumbId)?.image_url || null) : null;
      })(),
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
    .select(
      "id, title, tagline, layout, share_token, revoked_at, intro_html, outro_html, accent_color, show_contact, cover_photo_id",
    )
    .eq("id", data.id)
    .maybeSingle();
  if (!row) return null;

  const [sections, coverMap] = await Promise.all([
    loadSections(ctx.supabase, data.id),
    resolvePhotoUrls(row.cover_photo_id ? [row.cover_photo_id] : []),
  ]);

  return {
    id: row.id,
    title: row.title,
    tagline: row.tagline,
    layout: row.layout,
    share_token: row.share_token,
    revoked_at: row.revoked_at,
    intro_html: row.intro_html ?? null,
    outro_html: row.outro_html ?? null,
    accent_color: row.accent_color ?? null,
    show_contact: row.show_contact ?? true,
    cover_photo_id: row.cover_photo_id ?? null,
    cover_image_url: row.cover_photo_id
      ? (coverMap.get(row.cover_photo_id)?.image_url ?? null)
      : null,
    sections,
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
  introHtml: z.string().max(20_000).nullable().optional(),
  outroHtml: z.string().max(20_000).nullable().optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Accent colour must be a #rrggbb hex value")
    .nullable()
    .optional(),
  showContact: z.boolean().optional(),
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
  if (data.introHtml !== undefined) patch.intro_html = data.introHtml;
  if (data.outroHtml !== undefined) patch.outro_html = data.outroHtml;
  if (data.accentColor !== undefined) patch.accent_color = data.accentColor;
  if (data.showContact !== undefined) patch.show_contact = data.showContact;
  if (!Object.keys(patch).length) return { ok: true };
  const { error } = await (ctx.supabase as any).from("showcases").update(patch).eq("id", data.id);
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return { ok: true };
}

export const setShowcaseSectionsInputSchema = z.object({
  showcaseId: z.string().uuid(),
  sections: z
    .array(
      z.object({
        projectId: z.string().uuid().nullable().optional(),
        title: z.string().max(200).nullable().optional(),
        bodyHtml: z.string().max(20_000).nullable().optional(),
        items: z
          .array(
            z.object({
              photoId: z.string().uuid(),
              caption: z.string().max(500).nullable().optional(),
            }),
          )
          .max(200),
      }),
    )
    .max(50),
});

/**
 * Replace-all write of a showcase's whole body (sections + their photos) —
 * the same delete-then-insert shape as setShowcaseItems, so the builder can
 * save reordering, regrouping and removal in one round trip rather than
 * diffing on the client.
 *
 * Deleting the sections cascades their items away; the separate items delete
 * clears any pre-migration rows that still carry `section_id = NULL`.
 */
export async function setShowcaseSectionsService(
  ctx: AuthedContext,
  data: z.infer<typeof setShowcaseSectionsInputSchema>,
): Promise<{ ok: true }> {
  const db = ctx.supabase as any;
  await db.from("showcase_sections").delete().eq("showcase_id", data.showcaseId);
  await db.from("showcase_items").delete().eq("showcase_id", data.showcaseId);

  for (const [index, section] of data.sections.entries()) {
    const { data: sectionRow, error: sectionErr } = await db
      .from("showcase_sections")
      .insert({
        showcase_id: data.showcaseId,
        project_id: section.projectId ?? null,
        title: section.title ?? null,
        body_html: section.bodyHtml ?? null,
        position: index,
      })
      .select("id")
      .single();
    if (sectionErr) throw Object.assign(new Error(sectionErr.message), { status: 400 });
    if (!section.items.length) continue;

    const { error: itemsErr } = await db.from("showcase_items").insert(
      section.items.map((it, i) => ({
        showcase_id: data.showcaseId,
        section_id: sectionRow.id,
        photo_id: it.photoId,
        caption: it.caption ?? null,
        position: i,
      })),
    );
    if (itemsErr) throw Object.assign(new Error(itemsErr.message), { status: 400 });
  }
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
    intro_html: string | null;
    outro_html: string | null;
    accent_color: string | null;
    show_contact: boolean;
    cover_image_url: string | null;
    sections: ShowcaseSectionDetail[];
  } | null;
  company: ShowcaseCompany | null;
}

export async function getPublicShowcaseService(
  data: z.infer<typeof publicShowcaseInputSchema>,
): Promise<PublicShowcase> {
  const admin = getSupabaseAdmin();
  const { data: row } = await (admin as any)
    .from("showcases")
    .select(
      "id, title, tagline, layout, revoked_at, created_by, intro_html, outro_html, accent_color, show_contact, cover_photo_id",
    )
    .eq("share_token", data.token)
    .maybeSingle();
  if (!row) return { status: "not_found", showcase: null, company: null };
  if (row.revoked_at) return { status: "revoked", showcase: null, company: null };

  const [sections, { data: profile }, coverMap] = await Promise.all([
    loadSections(admin, row.id),
    admin
      .from("profiles")
      .select("company, company_logo_url, company_phone, company_address, email")
      .eq("id", row.created_by)
      .maybeSingle(),
    resolvePhotoUrls(row.cover_photo_id ? [row.cover_photo_id] : []),
  ]);

  // Fall back to the first photo in the showcase so the masthead always has a
  // hero image, even when no explicit cover was chosen.
  const firstPhoto = sections.flatMap((s) => s.items).find((i) => i.image_url)?.image_url ?? null;
  const coverImageUrl = row.cover_photo_id
    ? (coverMap.get(row.cover_photo_id)?.image_url || firstPhoto)
    : firstPhoto;

  const p = profile as any;
  return {
    status: "ok",
    showcase: {
      title: row.title,
      tagline: row.tagline,
      layout: row.layout,
      intro_html: row.intro_html ?? null,
      outro_html: row.outro_html ?? null,
      accent_color: row.accent_color ?? null,
      show_contact: row.show_contact ?? true,
      cover_image_url: coverImageUrl,
      sections,
    },
    company: p
      ? {
          name: p.company ?? null,
          logo_url: p.company_logo_url ?? null,
          phone: p.company_phone ?? null,
          address: p.company_address ?? null,
          email: p.email ?? null,
        }
      : null,
  };
}
