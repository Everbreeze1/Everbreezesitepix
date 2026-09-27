import { newProjectName } from "@everlumen/shared";
import { api } from "@/lib/api";
import type { ProjectPatch } from "./project-patch";
import { supabase } from "@/lib/supabase";

export type ProjectListItem = {
  id: string;
  name: string;
  status: string;
  /*
   * Starred and archived are read by the web list as filters. They are here so
   * the phone can show and set the same state rather than inventing a second
   * notion of "important" that nothing else understands.
   */
  starred: boolean | null;
  archived: boolean | null;
  client_name: string | null;
  location: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  updated_at: string;
  /*
   * Workspace labels by name (`projects.labels`, a text array). The colours
   * live in the `labels` catalog, looked up by name, which is how the web
   * project list draws the same chips.
   */
  labels?: string[] | null;
  /** Read by `getProject` only: the list has no use for either. */
  description?: string | null;
  pipeline_stage_id?: string | null;
};

const PROJECT_FIELDS =
  "id, name, status, starred, archived, client_name, location, street, city, state, zip, latitude, longitude, updated_at, labels";

/**
 * The detail screen's extra columns.
 *
 * The description sits under the title and the stage drives the status chip,
 * the two places the web project header shows them. Kept off the list select
 * so the five screens sharing `PROJECT_FIELDS` do not pay for them.
 */
const PROJECT_DETAIL_FIELDS = `${PROJECT_FIELDS}, description, pipeline_stage_id`;

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

export type NewProjectInput = {
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  clientName: string;
  latitude: number | null;
  longitude: number | null;
  /** The web form's collapsed Job details: email or phone, and a job number. */
  clientContact?: string;
  projectNumber?: string;
};

/**
 * Turn a typed address into coordinates.
 *
 * Geocoding needs a Google key, so it goes through `/v1/rpc` rather than being
 * called from the phone. Returns null on any failure: a project with no pin is
 * still a project, and refusing to create one because an address could not be
 * matched would strand a crew standing on the site.
 */
export async function geocodeAddress(
  address: string,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const result = await api.rpc<{
      latitude?: number;
      longitude?: number;
      lat?: number;
      lng?: number;
    }>("geocodeAddress", { address });

    const latitude = result?.latitude ?? result?.lat ?? null;
    const longitude = result?.longitude ?? result?.lng ?? null;
    if (typeof latitude === "number" && typeof longitude === "number") {
      return { latitude, longitude };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create a project from the field.
 *
 * The name comes from `newProjectName` in `@everlumen/shared`, which is the
 * single place the product mints one. That matters: the bare "Untitled project"
 * constant is what once filled workspaces with interchangeable rows, and the
 * Move destination list is where it hurt, because picking the wrong one moves
 * photos. Mobile inventing its own fallback would put those rows back.
 */
export async function createProject(input: NewProjectInput): Promise<{ id: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not signed in");

  const name = newProjectName(
    { name: input.name, street: input.street, client_name: input.clientName },
    new Date(),
  );

  const row: Record<string, unknown> = {
    created_by: userId,
    name,
    street: input.street.trim() || null,
    city: input.city.trim() || null,
    state: input.state.trim() || null,
    zip: input.zip.trim() || null,
    latitude: input.latitude,
    longitude: input.longitude,
    status: "active",
    client_name: input.clientName.trim() || null,
  };
  const contact = input.clientContact?.trim();
  const number = input.projectNumber?.trim();
  if (contact) row.client_contact = contact;
  if (number) row.project_number = number;

  const insert = (values: Record<string, unknown>) =>
    supabase
      .from("projects")
      .insert(values as never)
      .select("id")
      .single();

  let { data, error } = await insert(row);
  /*
   * Retried without the two job-detail columns when this database predates
   * them, as the web's `writeWithNewColumns` does: creating a job must never
   * fail over optional fields somebody may not even have filled in.
   */
  if (error && (contact || number) && /client_contact|project_number/.test(error.message)) {
    const rest = { ...row };
    delete rest.client_contact;
    delete rest.project_number;
    ({ data, error } = await insert(rest));
  }

  if (error || !data) throw new Error(error?.message ?? "Could not create the project");
  return { id: (data as { id: string }).id };
}

export async function getProject(id: string): Promise<ProjectListItem | null> {
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_DETAIL_FIELDS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ProjectListItem) ?? null;
}

/**
 * Apply an edit to a project.
 *
 * The same direct RLS update the web list uses for starring and archiving, so
 * a row written from the phone is indistinguishable from one written in a
 * browser. Errors throw: a silent failure here means the list shows a name the
 * database does not have.
 */
export async function applyProjectPatch(projectId: string, patch: ProjectPatch): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update(patch as never)
    .eq("id", projectId);

  if (error) throw new Error(error.message);
}
