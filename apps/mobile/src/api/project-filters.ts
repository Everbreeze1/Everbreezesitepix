import { supabase } from "@/lib/supabase";
import type { ProjectFacts } from "./project-filters-view";

/**
 * What the Projects filters read beyond the list row: dates, creator, stage,
 * tags and recent photo contributors.
 *
 * The same tables the web's projects page reads for its Filters popover
 * (`projects`, `project_tags` joined to `tags`, `tags`, and `photos` for who
 * uploaded to each job), asked for only once a refinement or the filter sheet
 * needs them, so the everyday list costs nothing extra. Kept apart from
 * `listProjects`, whose columns five other screens share.
 */

export type ProjectTag = { id: string; name: string; color: string | null };

export type ProjectFilterFacts = {
  byProject: Record<string, ProjectFacts>;
  tags: ProjectTag[];
};

/** How many uploaders per job the contributor filter keeps, as on the web. */
const CONTRIBUTORS_PER_PROJECT = 4;
const IN_CHUNK = 150;

type FactRow = {
  id: string;
  created_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  pipeline_stage_id?: string | null;
};

async function readProjects(): Promise<FactRow[]> {
  const base = "id, created_at, updated_at, created_by, pipeline_stage_id";
  const read = (columns: string) =>
    supabase.from("projects").select(columns).is("deleted_at", null);
  let { data, error } = await read(`${base}, completed_at`);
  // An older database has no completed_at; the date filter then falls back to
  // last activity, which is what the web does for an open job anyway.
  if (error && /completed_at/.test(error.message)) ({ data, error } = await read(base));
  if (error) throw new Error(error.message);
  return (data as unknown as FactRow[]) ?? [];
}

async function readContributors(ids: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("photos")
      .select("project_id, uploaded_by")
      .in("project_id", slice)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5000);
    // People are a refinement; a failed read leaves only the creators to match.
    if (error) continue;
    for (const row of (data as { project_id: string; uploaded_by: string | null }[]) ?? []) {
      if (!row.uploaded_by) continue;
      const list = (out[row.project_id] ??= []);
      if (list.length < CONTRIBUTORS_PER_PROJECT && !list.includes(row.uploaded_by)) {
        list.push(row.uploaded_by);
      }
    }
  }
  return out;
}

export async function listProjectFilterFacts(): Promise<ProjectFilterFacts> {
  const [projects, joins, tags] = await Promise.all([
    readProjects(),
    supabase.from("project_tags").select("project_id, tag:tags(id, name, color)"),
    supabase.from("tags").select("id, name, color").order("name", { ascending: true }),
  ]);

  const tagsByProject: Record<string, string[]> = {};
  for (const row of (joins.data as unknown as {
    project_id: string;
    tag: ProjectTag | null;
  }[]) ?? []) {
    if (!row.tag) continue;
    (tagsByProject[row.project_id] ??= []).push(row.tag.id);
  }

  const contributors = await readContributors(projects.map((p) => p.id));

  const byProject: Record<string, ProjectFacts> = {};
  for (const row of projects) {
    byProject[row.id] = {
      created_at: row.created_at ?? null,
      completed_at: row.completed_at ?? null,
      updated_at: row.updated_at ?? null,
      created_by: row.created_by ?? null,
      pipeline_stage_id: row.pipeline_stage_id ?? null,
      tagIds: tagsByProject[row.id] ?? [],
      contributorIds: contributors[row.id] ?? [],
    };
  }

  return { byProject, tags: (tags.data as ProjectTag[] | null) ?? [] };
}
