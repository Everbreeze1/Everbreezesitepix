import { supabase } from "@/lib/supabase";
import { signPhotoUrls, type PhotoListItem } from "./photos";
import {
  embeddedCount,
  groupStrips,
  STRIP_SIZE,
  type ProjectCardExtras,
} from "./project-cards-view";

/**
 * Photos, counts and stages for every card on the Projects tab, in one read.
 *
 * The web Projects page reads every photo row of every project and counts them
 * in the browser. On a phone that is thousands of rows over site data to draw
 * four thumbnails a card, and PostgREST caps a read at 1000 rows anyway, so
 * the counts would be wrong on exactly the busiest workspaces.
 *
 * Instead the photos are embedded under each project: the newest four per job
 * (`limit` on the embed is per parent) and a `count` of the rest, filtered to
 * live photos. One request per 200 jobs, then one batch to sign the strips.
 * The foreign key is named because `photo_comments` also links photos to
 * projects, and an unnamed embed would be ambiguous.
 *
 * If that embed is refused (an older PostgREST, a renamed key), the strips
 * fall back to a flat newest-first read and the counts are left unknown rather
 * than guessed. The list still draws either way: pictures are context, and an
 * error here must never stand between somebody and their jobs.
 */

const IN_CHUNK = 200;

type PhotoRow = {
  id: string;
  storage_path: string;
  thumb_path: string | null;
  image_url: string | null;
  created_at: string;
};

type EmbedRow = {
  id: string;
  pipeline_stage_id: string | null;
  recent: PhotoRow[] | null;
  total: unknown;
};

const PHOTO_COLUMNS = "id, storage_path, thumb_path, image_url, created_at";

async function readEmbedded(ids: string[]): Promise<EmbedRow[]> {
  const rows: EmbedRow[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("projects")
      .select(
        `id, pipeline_stage_id, recent:photos!photos_project_id_fkey(${PHOTO_COLUMNS}), total:photos!photos_project_id_fkey(count)`,
      )
      .in("id", slice)
      .is("recent.deleted_at", null)
      .is("total.deleted_at", null)
      .order("created_at", { referencedTable: "recent", ascending: false })
      .limit(STRIP_SIZE, { referencedTable: "recent" });
    if (error) throw new Error(error.message);
    rows.push(...((data as unknown as EmbedRow[]) ?? []));
  }
  return rows;
}

/** The fallback: newest photos flat, grouped here, no counts. */
async function readFlat(ids: string[]): Promise<EmbedRow[]> {
  const flat: (PhotoRow & { project_id: string })[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const slice = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("photos")
      .select(`project_id, ${PHOTO_COLUMNS}`)
      .in("project_id", slice)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    flat.push(...((data as typeof flat) ?? []));
  }
  const grouped = groupStrips(flat);
  return ids.map((id) => ({ id, pipeline_stage_id: null, recent: grouped[id] ?? [], total: null }));
}

export async function listProjectCardExtras(
  projectIds: string[],
): Promise<Record<string, ProjectCardExtras>> {
  if (projectIds.length === 0) return {};

  let rows: EmbedRow[];
  try {
    rows = await readEmbedded(projectIds);
  } catch (error) {
    console.warn(
      `[project-cards] embedded read refused, falling back: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    rows = await readFlat(projectIds);
  }

  const photos = rows.flatMap((row) => row.recent ?? []);
  const signed = await signPhotoUrls(
    photos.map((photo) => ({
      ...photo,
      caption: null,
      taken_at: null,
      phase: null,
      tags: null,
    })) as PhotoListItem[],
  );

  const out: Record<string, ProjectCardExtras> = {};
  for (const row of rows) {
    const recent = row.recent ?? [];
    out[row.id] = {
      urls: recent.map((photo) => signed[photo.id]).filter((url): url is string => Boolean(url)),
      count: embeddedCount(row.total),
      latestAt: recent[0]?.created_at ?? null,
      stageId: row.pipeline_stage_id ?? null,
    };
  }
  return out;
}
