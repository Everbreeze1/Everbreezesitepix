import { z } from "zod";
import { sanitizeCaption } from "@sitepix/shared";
import { getSupabaseAdmin } from "../../lib/supabase";

export const publicProjectReportInputSchema = z.object({ token: z.string().uuid() });

export interface PublicReportPhoto {
  id: string;
  caption: string | null;
  phase: string | null;
  tags: string[];
  taken_at: string | null;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
  image_url: string;
}

export interface PublicReportSection {
  id: string;
  position: number;
  title: string;
  body: string | null;
  photos: Array<{ photo_id: string; caption: string; image_url: string }>;
}

export interface PublicProjectReport {
  status: "ok" | "not_found" | "revoked";
  report: {
    id: string;
    title: string;
    summary: string | null;
    subtitle: string | null;
    created_at: string;
    allow_download: boolean;
    include_project_info: boolean;
    cover_enabled: boolean;
    cover_show_project_name: boolean;
    cover_show_address: boolean;
    cover_show_date: boolean;
    cover_show_author: boolean;
    photos_per_page: number;
    cover_photos: Array<{ photo_id: string; caption: string; image_url: string }>;
  } | null;
  project: {
    name: string;
    description: string | null;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    status: string;
  } | null;
  company: {
    name: string | null;
    logo_url: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  author: { name: string | null } | null;
  sections: PublicReportSection[];
  photos: PublicReportPhoto[];
}

export async function getPublicProjectReportService(
  data: z.infer<typeof publicProjectReportInputSchema>,
): Promise<PublicProjectReport> {
  const supabaseAdmin = getSupabaseAdmin();

  const empty = (status: PublicProjectReport["status"]): PublicProjectReport => ({
    status,
    report: null,
    project: null,
    company: null,
    author: null,
    sections: [],
    photos: [],
  });

  const { data: report } = await (supabaseAdmin as any)
    .from("project_reports")
    .select(
      "id, project_id, created_by, title, summary, subtitle, photo_ids, include_project_info, allow_download, revoked_at, created_at, cover_enabled, cover_show_project_name, cover_show_address, cover_show_date, cover_show_author, photos_per_page, cover_photo_ids",
    )
    .eq("share_token", data.token)
    .maybeSingle();
  if (!report) return empty("not_found");
  if (report.revoked_at) return empty("revoked");

  const [{ data: project }, { data: profile }, { data: sectionRows }] = await Promise.all([
    supabaseAdmin
      .from("projects")
      .select("name, description, street, city, state, zip, status")
      .eq("id", report.project_id)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("full_name, company, company_logo_url, company_phone, company_address")
      .eq("id", report.created_by)
      .maybeSingle(),
    (supabaseAdmin as any)
      .from("project_report_sections")
      .select("id, position, title, body, photos")
      .eq("report_id", report.id)
      .order("position", { ascending: true }),
  ]);

  const sectionList: Array<{
    id: string;
    position: number;
    title: string | null;
    body: string | null;
    photos: Array<{ photo_id?: string; caption?: string }> | null;
  }> = (sectionRows as typeof sectionList) ?? [];
  const photoIdSet = new Set<string>();
  sectionList.forEach((s) =>
    (s.photos ?? []).forEach((p) => p?.photo_id && photoIdSet.add(p.photo_id)),
  );
  const coverPhotoIds: string[] = Array.isArray(report.cover_photo_ids)
    ? report.cover_photo_ids
    : [];
  coverPhotoIds.forEach((id) => photoIdSet.add(id));
  const legacyIds: string[] = report.photo_ids ?? [];
  legacyIds.forEach((id) => photoIdSet.add(id));

  const urlById = new Map<string, string>();
  const metaById = new Map<string, {
    id: string;
    caption: string | null;
    phase: string | null;
    tags: string[] | null;
    taken_at: string | null;
    created_at: string;
    latitude: number | null;
    longitude: number | null;
    storage_path: string;
    image_url: string | null;
  }>();
  if (photoIdSet.size) {
    const { data: rows } = await supabaseAdmin
      .from("photos")
      .select(
        "id, storage_path, image_url, caption, phase, tags, taken_at, created_at, latitude, longitude",
      )
      .in("id", Array.from(photoIdSet));
    const list = (rows as Array<{
      id: string;
      storage_path: string;
      image_url: string | null;
      caption: string | null;
      phase: string | null;
      tags: string[] | null;
      taken_at: string | null;
      created_at: string;
      latitude: number | null;
      longitude: number | null;
    }>) ?? [];
    for (const r of list) metaById.set(r.id, { ...r, caption: sanitizeCaption(r.caption) });
    await Promise.all(
      list.map(async (r) => {
        if (r.image_url) {
          urlById.set(r.id, r.image_url);
          return;
        }
        const { data: s } = await supabaseAdmin.storage
          .from("site-photos")
          .createSignedUrl(r.storage_path, 60 * 60);
        urlById.set(r.id, s?.signedUrl ?? "");
      }),
    );
  }

  const sections: PublicReportSection[] = sectionList.map((s) => ({
    id: s.id,
    position: s.position,
    title: s.title ?? "",
    body: s.body ?? null,
    photos: (s.photos ?? []).map((p) => ({
      photo_id: p.photo_id!,
      caption: sanitizeCaption(p.caption),
      image_url: urlById.get(p.photo_id!) ?? "",
    })),
  }));

  let photos: PublicReportPhoto[] = [];
  if (sections.length === 0 && legacyIds.length) {
    photos = legacyIds
      .map((id) => {
        const m = metaById.get(id);
        if (!m) return null;
        return {
          id: m.id,
          caption: m.caption,
          phase: m.phase,
          tags: m.tags ?? [],
          taken_at: m.taken_at,
          created_at: m.created_at,
          latitude: m.latitude,
          longitude: m.longitude,
          image_url: urlById.get(id) ?? "",
        };
      })
      .filter(Boolean) as PublicReportPhoto[];
  }

  return {
    status: "ok",
    report: {
      id: report.id,
      title: report.title,
      summary: report.summary,
      subtitle: report.subtitle ?? null,
      created_at: report.created_at,
      allow_download: report.allow_download,
      include_project_info: report.include_project_info,
      cover_enabled: report.cover_enabled ?? true,
      cover_show_project_name: report.cover_show_project_name ?? true,
      cover_show_address: report.cover_show_address ?? true,
      cover_show_date: report.cover_show_date ?? true,
      cover_show_author: report.cover_show_author ?? true,
      photos_per_page: Math.min(4, Math.max(1, Number(report.photos_per_page ?? 2))),
      cover_photos: coverPhotoIds.map((id) => ({
        photo_id: id,
        caption: metaById.get(id)?.caption ?? "",
        image_url: urlById.get(id) ?? "",
      })),
    },
    project:
      report.include_project_info && project
        ? {
            name: project.name,
            description: project.description,
            street: project.street,
            city: project.city,
            state: project.state,
            zip: project.zip,
            status: project.status,
          }
        : null,
    company: profile
      ? {
          name: profile.company,
          logo_url: profile.company_logo_url,
          phone: profile.company_phone,
          address: profile.company_address,
        }
      : null,
    author: profile ? { name: profile.full_name ?? null } : null,
    sections,
    photos,
  };
}
