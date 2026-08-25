import { supabase } from "@/lib/supabase";

export type ProjectListItem = {
  id: string;
  name: string;
  status: string;
  location: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  updated_at: string;
};

const PROJECT_FIELDS =
  "id, name, status, location, street, city, state, zip, latitude, longitude, updated_at";

export function formatAddress(
  project: Pick<ProjectListItem, "street" | "city" | "state" | "zip" | "location">,
) {
  const line = [
    project.street,
    [project.city, project.state].filter(Boolean).join(", "),
    project.zip,
  ]
    .filter(Boolean)
    .join(" · ");
  return line || project.location || null;
}

/** Coordinates for a project, or null when it has no geocoded address. */
export function projectCoords(project: ProjectListItem | null) {
  if (!project) return null;
  if (project.latitude === null || project.longitude === null) return null;
  return { latitude: project.latitude, longitude: project.longitude };
}

/** Active projects visible under Everlumen RLS. */
export async function listProjects(): Promise<ProjectListItem[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_FIELDS)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data as ProjectListItem[]) ?? [];
}

export async function getProject(id: string): Promise<ProjectListItem | null> {
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_FIELDS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ProjectListItem) ?? null;
}
