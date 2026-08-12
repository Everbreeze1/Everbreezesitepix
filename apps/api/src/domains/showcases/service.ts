import { z } from "zod";
import { sanitizeCaption } from "@sitepix/shared";
import type { AuthedContext } from "../../lib/user-context";
import { getSupabaseAdmin } from "../../lib/supabase";
import { signPhotoUrls } from "../../lib/photo-urls";
import { slugify, uniqueSlug } from "../portfolio/slug";

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
  /** Portfolio-site state, so the list can show and toggle it inline. */
  slug: string | null;
  service_type: string | null;
  city: string | null;
  state: string | null;
  on_site: boolean;
  featured: boolean;
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
  show_reviews: boolean;
  cover_photo_id: string | null;
  cover_image_url: string | null;
  sections: ShowcaseSectionDetail[];
  /** Portfolio-site metadata — edited separately via updateShowcaseSite. */
  slug: string | null;
  service_type: string | null;
  products_used: string[];
  summary: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  on_site: boolean;
  featured: boolean;
  completed_on: string | null;
}

/** Company details rendered in a showcase's masthead + contact block. */
export interface ShowcaseCompany {
  name: string | null;
  logo_url: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
}

/**
 * Showcase photos render up to full viewport width (the lead image bleeds edge
 * to edge), so this has to stay generous — the win is not serving thumbnails,
 * it is not serving 4000px camera originals.
 */
export const SHOWCASE_PHOTO_WIDTH = 1400;
/** List-page cover thumbnails are ~400px on screen; 800 covers retina. */
export const CARD_THUMB_WIDTH = 800;

export async function myTeamId(ctx: AuthedContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("team_members" as any)
    .select("team_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return (data as any)?.team_id ?? null;
}

export async function resolvePhotoUrls(
  photoIds: string[],
  /**
   * Retained for call-site compatibility and ignored. A showcase used to
   * transform originals down to ~1400px on read; it now serves the thumbnail
   * stored at upload time, which is sized to that same 1400px for exactly this
   * page. See `signPhotoUrls` for why transforming on read had to stop.
   */
  _width?: number,
): Promise<Map<string, { image_url: string; storage_path: string }>> {
  const admin = getSupabaseAdmin();
  const out = new Map<string, { image_url: string; storage_path: string }>();
  if (!photoIds.length) return out;
  const { data } = await admin
    .from("photos")
    .select("id, storage_path, thumb_path, image_url")
    .in("id", photoIds);
  const rows =
    (data as Array<{
      id: string;
      storage_path: string;
      thumb_path: string | null;
      image_url: string | null;
    }>) ?? [];
  // A photo whose row is missing entirely (deleted, or the id never existed —
  // showcase_items.photo_id has no FK) never reaches `rows`, so it silently
  // has no entry in `out` and the caller's `?? ""` fallback kicks in. That's
  // fine; what must not happen is one bad `storage_path` poisoning every
  // *other* photo's signed URL in the same batch call.
  const needSign = rows.filter((r) => !r.image_url && r.storage_path);
  const signedMap: Record<string, string> = {};
  if (needSign.length) {
    const signedMapped = await signPhotoUrls(
      needSign.map((r) => r.storage_path),
      {
        thumbByPath: Object.fromEntries(
          needSign.map((r) => [r.storage_path, r.thumb_path ?? null]),
        ),
      },
    );
    Object.assign(signedMap, signedMapped);
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
export async function loadSections(
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
  const urlMap = await resolvePhotoUrls(items.map((i) => i.photo_id), SHOWCASE_PHOTO_WIDTH);

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
    .select(
      "id, title, tagline, layout, share_token, revoked_at, cover_photo_id, created_at, updated_at, slug, service_type, city, state, on_site, featured, position",
    )
    .eq("team_id", teamId)
    // Site order, not creation order: this list is now also the running order
    // of the portfolio's grid, so the two must agree or reordering looks
    // broken. Matches compareCardRows — position only, newest as tie-break.
    .order("position", { ascending: true })
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
  const urlMap = await resolvePhotoUrls(Array.from(new Set(thumbIdByShowcase.values())), CARD_THUMB_WIDTH);

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
      slug: r.slug ?? null,
      service_type: r.service_type ?? null,
      city: r.city ?? null,
      state: r.state ?? null,
      on_site: r.on_site ?? true,
      featured: r.featured ?? false,
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
      "id, title, tagline, layout, share_token, revoked_at, intro_html, outro_html, accent_color, show_contact, show_reviews, cover_photo_id, slug, service_type, products_used, summary, city, state, latitude, longitude, on_site, featured, completed_on",
    )
    .eq("id", data.id)
    .maybeSingle();
  if (!row) return null;

  const [sections, coverMap] = await Promise.all([
    loadSections(ctx.supabase, data.id),
    resolvePhotoUrls(row.cover_photo_id ? [row.cover_photo_id] : [], SHOWCASE_PHOTO_WIDTH),
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
    show_reviews: row.show_reviews ?? true,
    cover_photo_id: row.cover_photo_id ?? null,
    cover_image_url: row.cover_photo_id
      ? (coverMap.get(row.cover_photo_id)?.image_url ?? null)
      : null,
    sections,
    slug: row.slug ?? null,
    service_type: row.service_type ?? null,
    products_used: row.products_used ?? [],
    summary: row.summary ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    on_site: row.on_site ?? true,
    featured: row.featured ?? false,
    completed_on: row.completed_on ?? null,
  };
}

/**
 * Reserves a per-team URL slug for a new showcase.
 *
 * Every showcase gets one at creation rather than lazily on first publish: the
 * portfolio site routes on slug, and a showcase that exists but is unreachable
 * is a bug the user can only discover by publishing and finding a 404.
 *
 * Reads the team's existing slugs in one query — a team's showcase count is
 * small and bounded in practice, so this beats probing candidates serially.
 */
async function nextShowcaseSlug(db: any, teamId: string, title: string): Promise<string> {
  const { data } = await db
    .from("showcases")
    .select("slug")
    .eq("team_id", teamId)
    .not("slug", "is", null);
  const taken = ((data as Array<{ slug: string }>) ?? []).map((r) => r.slug);
  return uniqueSlug(slugify(title), taken, "project");
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
    .insert({
      team_id: teamId,
      created_by: ctx.userId,
      title: data.title,
      tagline: data.tagline ?? null,
      slug: await nextShowcaseSlug(ctx.supabase, teamId, data.title),
    })
    .select("id")
    .single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  return { id: row.id };
}

export const createShowcaseFromProjectInputSchema = z.object({
  projectId: z.string().uuid(),
  /** Cap so a job with hundreds of photos becomes a showcase, not a dump. */
  maxPhotos: z.number().int().min(1).max(60).default(24),
});

/** Photos are already tagged before/progress/after — that ordering IS the story. */
const PHASE_SECTIONS: Array<{ phase: string; title: string; body: string }> = [
  { phase: "before", title: "Before", body: "<p>Where we started.</p>" },
  { phase: "progress", title: "The work", body: "<p>What it took to get there.</p>" },
  { phase: "after", title: "After", body: "<p>The finished result.</p>" },
];

/**
 * Builds a complete, publishable showcase from one project in a single call.
 *
 * The manual builder asks for a title, sections, photo picks and copy before
 * anything exists — which is why building one felt like assembling a report.
 * Everything it asks for is already known: the project has a name and address,
 * and its photos are already phase-tagged. So generate the finished draft and
 * let the user edit it, rather than making them author it from an empty page.
 */
export async function createShowcaseFromProjectService(
  ctx: AuthedContext,
  data: z.infer<typeof createShowcaseFromProjectInputSchema>,
): Promise<{ id: string; photoCount: number }> {
  const teamId = await myTeamId(ctx);
  if (!teamId) throw Object.assign(new Error("No team"), { status: 400 });

  const { data: project } = await (ctx.supabase as any)
    .from("projects")
    .select("id, name, street, city, state, latitude, longitude, tags")
    .eq("id", data.projectId)
    .maybeSingle();
  if (!project) throw Object.assign(new Error("Project not found"), { status: 404 });

  // Walkthrough frames are working footage, not portfolio material.
  const { data: photoRows } = await (ctx.supabase as any)
    .from("photos")
    .select("id, caption, phase, taken_at, created_at")
    .eq("project_id", data.projectId)
    .eq("archived", false)
    .or("phase.is.null,phase.neq.walkthrough")
    .order("taken_at", { ascending: true, nullsFirst: false })
    .limit(200);

  const photos = ((photoRows as any[]) ?? []).slice(0, data.maxPhotos);
  if (!photos.length) {
    throw Object.assign(new Error("This project has no photos yet."), { status: 400 });
  }

  const address = [project.street, project.city, project.state].filter(Boolean).join(", ");
  // "Completed" is the last time anyone photographed the job — the only date
  // the data actually supports. Photos are ordered ascending, so take the tail.
  const lastShot = [...photos].reverse().find((p) => p.taken_at || p.created_at);
  const completedOn =
    (lastShot?.taken_at ?? lastShot?.created_at)?.slice(0, 10) ?? null;
  const safeName = String(project.name ?? "this project")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const grouped = PHASE_SECTIONS.map((s) => ({
    ...s,
    photos: photos.filter((p) => p.phase === s.phase),
  })).filter((s) => s.photos.length > 0);

  // Untagged photos still deserve a home; if nothing is tagged at all this is
  // the only section and the showcase reads as a simple gallery.
  const untagged = photos.filter((p) => !PHASE_SECTIONS.some((s) => s.phase === p.phase));
  const sections = [
    ...grouped,
    ...(untagged.length
      ? [
          {
            title: grouped.length ? "More from this job" : "The work",
            body: grouped.length ? "" : "<p>A look at what we did on this project.</p>",
            photos: untagged,
          },
        ]
      : []),
  ];

  const { data: row, error } = await (ctx.supabase as any)
    .from("showcases")
    .insert({
      team_id: teamId,
      created_by: ctx.userId,
      title: project.name,
      tagline: address || null,
      // `featured` bleeds each section's lead photo edge to edge. That is
      // striking once or twice and relentless four times over, so it is only
      // the default for short showcases.
      layout: sections.length <= 2 ? "featured" : "grid",
      // A generated showcase should read as finished, not skeletal — an empty
      // opening and close is most of what made the first draft feel unpolished.
      // This is a starting draft the user edits, not final copy.
      intro_html: `<p>A closer look at ${safeName}. Every photo below was taken on site by our crew.</p>`,
      outro_html: `<p>Looking for work like this? Get in touch for a free estimate.</p>`,
      // The finished result is the shot that sells the job, so lead with it.
      cover_photo_id: (photos.find((p) => p.phase === "after") ?? photos[0]).id,

      // --- portfolio-site metadata -----------------------------------------
      // Denormalised from the project on purpose: a published portfolio has to
      // keep rendering (and keep its map pin) after the project is deleted.
      slug: await nextShowcaseSlug(ctx.supabase, teamId, project.name ?? "project"),
      summary: address ? `${project.name} — ${address}` : null,
      // A project's first tag is how teams already label the trade ("Roofing",
      // "Kitchen"), so it is the best available guess at a service type. The
      // user can correct it in the builder; guessing beats an empty facet that
      // leaves every card unfilterable.
      service_type: (project.tags as string[] | null)?.[0]?.trim() || null,
      city: project.city ?? null,
      state: project.state ?? null,
      latitude: project.latitude ?? null,
      longitude: project.longitude ?? null,
      completed_on: completedOn,
    })
    .select("id")
    .single();
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  const showcaseId = row.id as string;

  for (const [index, section] of sections.entries()) {
    const { data: sectionRow, error: sectionErr } = await (ctx.supabase as any)
      .from("showcase_sections")
      .insert({
        showcase_id: showcaseId,
        project_id: data.projectId,
        title: section.title,
        body_html: section.body || null,
        position: index,
      })
      .select("id")
      .single();
    if (sectionErr) throw Object.assign(new Error(sectionErr.message), { status: 400 });

    const { error: itemsErr } = await (ctx.supabase as any).from("showcase_items").insert(
      section.photos.map((p: any, i: number) => ({
        showcase_id: showcaseId,
        section_id: sectionRow.id,
        photo_id: p.id,
        caption: sanitizeCaption(p.caption) || null,
        position: i,
      })),
    );
    if (itemsErr) throw Object.assign(new Error(itemsErr.message), { status: 400 });
  }

  return { id: showcaseId, photoCount: photos.length };
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
  showReviews: z.boolean().optional(),
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
  if (data.showReviews !== undefined) patch.show_reviews = data.showReviews;
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
  /*
   * SECURITY — validate photo ownership BEFORE touching anything.
   *
   * `showcase_items.photo_id` has no foreign key, and the table's RLS only
   * asserts that the parent showcase belongs to the caller's team. It never
   * looks at the photo. `resolvePhotoUrls` then reads those ids with the
   * SERVICE-ROLE client, which bypasses the `photos` RLS that would otherwise
   * hide them — so an unvalidated id here let any authenticated user point
   * their own showcase at somebody else's photo and mint a signed URL for it,
   * renewable indefinitely. Photo ids are not secret: the public report and
   * walkthrough endpoints hand them out.
   *
   * Reading through `ctx.supabase` IS the check — it is the caller's
   * RLS-scoped client, so ids they cannot see simply do not come back.
   *
   * This runs before the delete on purpose: a rejected request must not wipe
   * the showcase's existing items on its way out.
   */
  if (data.items.length) {
    const requested = Array.from(new Set(data.items.map((it) => it.photoId)));
    const { data: visible, error: visErr } = await (ctx.supabase as any)
      .from("photos")
      .select("id")
      .in("id", requested);
    if (visErr) throw Object.assign(new Error(visErr.message), { status: 400 });
    const allowed = new Set(((visible as Array<{ id: string }>) ?? []).map((r) => r.id));
    if (requested.some((id) => !allowed.has(id))) {
      throw Object.assign(new Error("One or more of those photos aren't available to you."), {
        status: 403,
      });
    }
  }

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
    show_reviews: boolean;
    cover_image_url: string | null;
    sections: ShowcaseSectionDetail[];
  } | null;
  company: ShowcaseCompany | null;
  reviewLinks: Array<{ url: string; label: string | null; platform: string }>;
}

export async function getPublicShowcaseService(
  data: z.infer<typeof publicShowcaseInputSchema>,
): Promise<PublicShowcase> {
  const admin = getSupabaseAdmin();
  const { data: row } = await (admin as any)
    .from("showcases")
    .select(
      "id, team_id, title, tagline, layout, revoked_at, created_by, intro_html, outro_html, accent_color, show_contact, show_reviews, cover_photo_id",
    )
    .eq("share_token", data.token)
    .maybeSingle();
  if (!row) return { status: "not_found", showcase: null, company: null, reviewLinks: [] };
  if (row.revoked_at) return { status: "revoked", showcase: null, company: null, reviewLinks: [] };

  const [sections, { data: profile }, coverMap, { data: reviewRows }] = await Promise.all([
    loadSections(admin, row.id),
    admin
      .from("profiles")
      .select("company, company_logo_url, company_phone, company_address, email")
      .eq("id", row.created_by)
      .maybeSingle(),
    resolvePhotoUrls(row.cover_photo_id ? [row.cover_photo_id] : [], SHOWCASE_PHOTO_WIDTH),
    // The team's own review links (Settings → review links), so a finished-job
    // page can ask for the review at the moment the customer is looking at the
    // work. Skipped entirely when the showcase has the CTA turned off.
    row.show_reviews === false
      ? Promise.resolve({ data: [] as any[] })
      : (admin as any)
          .from("team_review_links")
          .select("platform, url, label, position")
          .eq("team_id", row.team_id)
          .order("position", { ascending: true }),
  ]);

  // Fall back to the first photo in the showcase so the masthead always has a
  // hero image, even when no explicit cover was chosen.
  const firstPhoto = sections.flatMap((s) => s.items).find((i) => i.image_url)?.image_url ?? null;
  const coverImageUrl = row.cover_photo_id
    ? (coverMap.get(row.cover_photo_id)?.image_url || firstPhoto)
    : firstPhoto;

  const p = profile as any;
  const showContact = row.show_contact ?? true;
  return {
    status: "ok",
    showcase: {
      title: row.title,
      tagline: row.tagline,
      layout: row.layout,
      intro_html: row.intro_html ?? null,
      outro_html: row.outro_html ?? null,
      accent_color: row.accent_color ?? null,
      show_contact: showContact,
      show_reviews: row.show_reviews ?? true,
      cover_image_url: coverImageUrl,
      sections,
    },
    /*
     * `show_contact` is honoured HERE, not just in the renderer.
     *
     * This is an anonymous endpoint: whatever it returns is public, whether or
     * not the page draws it. Switching contact display off still shipped the
     * owner's phone, postal address and email in the JSON to anyone who opened
     * devtools or curled the share link.
     *
     * The email is the worst of the three: `profiles.email` is the **account
     * login address**, not a business contact — there is no separate field for
     * one — so publishing it hands an attacker half of every credential-stuffing
     * attempt against this tenant. Name and logo stay regardless: they are the
     * branding on the showcase itself, and hiding them would blank the page.
     */
    company: p
      ? {
          name: p.company ?? null,
          logo_url: p.company_logo_url ?? null,
          phone: showContact ? (p.company_phone ?? null) : null,
          address: showContact ? (p.company_address ?? null) : null,
          email: showContact ? (p.email ?? null) : null,
        }
      : null,
    reviewLinks: ((reviewRows as any[]) ?? []).map((r) => ({
      url: r.url as string,
      label: (r.label as string | null) ?? null,
      platform: r.platform as string,
    })),
  };
}
