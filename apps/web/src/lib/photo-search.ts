/**
 * Photo Library text search, as data.
 *
 * Import-free so it can be tested. A search matches a photo's caption or the
 * name or address of the job it belongs to, which is what people type ("roof",
 * "Fisher Circle"). The same rule runs twice: on the server, so the 200-photo
 * page is 200 matches rather than 200 recent photos filtered down to three, and
 * on the client, so a calendar day (loaded separately) narrows the same way.
 */

export type SearchableProject = {
  id: string;
  name: string;
  location?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

/** Trimmed, lower-cased, and empty when there is nothing worth searching for. */
export function normalizeSearch(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

function projectText(p: SearchableProject): string {
  return [p.name, p.street, p.city, p.state, p.zip, p.location]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Ids of the jobs whose name or address contains the term. */
export function matchingProjectIds(term: string, projects: SearchableProject[]): string[] {
  const needle = normalizeSearch(term);
  if (!needle) return [];
  return projects.filter((p) => projectText(p).includes(needle)).map((p) => p.id);
}

const MAX_PROJECT_IDS = 100;

/**
 * The PostgREST `or=` expression for a search, or null for an empty one.
 *
 * Characters that are syntax inside `or=(...)` (comma, parentheses, double
 * quote, backslash) and the `%`/`*` wildcards are dropped from the term rather
 * than escaped: nobody searches photo captions for them, and a stray comma must
 * not split the filter into a second, unintended condition.
 *
 * Project ids are capped so a very broad term ("a") cannot build a URL past
 * what a proxy will accept; the caption half still matches.
 */
export function photoSearchOrFilter(term: string, projects: SearchableProject[]): string | null {
  const needle = normalizeSearch(term)
    .replace(/[,()%*\\"]/g, " ")
    .trim();
  if (!needle) return null;
  const parts = [`caption.ilike.%${needle}%`];
  const ids = matchingProjectIds(term, projects).slice(0, MAX_PROJECT_IDS);
  if (ids.length) parts.push(`project_id.in.(${ids.join(",")})`);
  return parts.join(",");
}

/** The client-side twin of `photoSearchOrFilter`. */
export function photoMatchesSearch(
  photo: { caption: string | null; project_id: string },
  term: string,
  projectsById: Map<string, SearchableProject>,
): boolean {
  const needle = normalizeSearch(term);
  if (!needle) return true;
  if ((photo.caption ?? "").toLowerCase().includes(needle)) return true;
  const project = projectsById.get(photo.project_id);
  return !!project && projectText(project).includes(needle);
}
