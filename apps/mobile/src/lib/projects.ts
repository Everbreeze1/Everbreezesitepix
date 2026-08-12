import { supabase } from "./supabase";

export type ProjectListItem = {
  id: string;
  name: string;
  status: string;
  location: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  updated_at: string;
};

export type PhotoListItem = {
  id: string;
  caption: string | null;
  storage_path: string;
  image_url: string | null;
  created_at: string;
  phase: string | null;
};

function formatAddress(p: Pick<ProjectListItem, "street" | "city" | "state" | "zip" | "location">) {
  const line = [p.street, [p.city, p.state].filter(Boolean).join(", "), p.zip]
    .filter(Boolean)
    .join(" · ");
  return line || p.location || null;
}

export { formatAddress };

/** Active projects visible under SitePix RLS. */
export async function listProjects(): Promise<ProjectListItem[]> {
  // deleted_at exists in product DB but is not yet in generated Database types
  const { data, error } = await (supabase as any)
    .from("projects")
    .select("id, name, status, location, street, city, state, zip, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as ProjectListItem[]) ?? [];
}

export async function getProject(id: string): Promise<ProjectListItem | null> {
  const { data, error } = await (supabase as any)
    .from("projects")
    .select("id, name, status, location, street, city, state, zip, updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ProjectListItem) ?? null;
}

export async function listProjectPhotos(projectId: string, limit = 40): Promise<PhotoListItem[]> {
  const { data, error } = await supabase
    .from("photos")
    .select("id, caption, storage_path, image_url, created_at, phase")
    .eq("project_id", projectId)
    // Walkthrough captures included — same photo library the web app shows.
    // The trash is not part of that library, and `deleted_at` has no RLS
    // predicate behind it, so this read has to exclude it by hand like the rest.
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data as PhotoListItem[]) ?? [];
}

export async function signPhotoUrls(
  photos: PhotoListItem[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const needSign: { id: string; path: string }[] = [];

  for (const p of photos) {
    if (p.image_url) out[p.id] = p.image_url;
    else needSign.push({ id: p.id, path: p.storage_path });
  }

  if (!needSign.length) return out;

  const { data } = await supabase.storage
    .from("site-photos")
    .createSignedUrls(
      needSign.map((n) => n.path),
      60 * 60,
    );

  data?.forEach((s, i) => {
    if (s?.signedUrl) out[needSign[i].id] = s.signedUrl;
  });

  return out;
}
