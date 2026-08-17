import type { AuthedContext } from "../../lib/user-context";

/**
 * What a new document is called before anyone renames it.
 *
 * Every route that creates a `project_pages` row used to invent its own default
 * and none of them named the project: a template page took `template.name`
 * verbatim, an AI document took "Daily Log - 8/17/2026", a blank page took
 * "Untitled". So "HVAC Service Call Report" was at once the row in Templates →
 * Documents, the row in this project's Documents tab and the row in every other
 * project's, and two jobs' daily logs from the same morning were the same
 * string twice.
 *
 * It does not stay inside the app either. `renderPagePdf` builds the download
 * filename out of this title, so a customer received `HVAC_Service_Call_Report.pdf`
 * and `Daily_Log_-_8_17_2026.pdf` no matter which site they were about, and the
 * share dialog and browser tab read the same. The client: "it confusingly saves
 * under that project under generic template name and forces the user to change
 * the name to stay organized."
 *
 * One rule in one place, so the four creation routes cannot drift back apart.
 * None of this is binding - the title is editable from the moment the document
 * opens, and this only decides where it starts.
 */

/** `project_pages.title` is capped at 200 by every page input schema. */
const MAX_PAGE_TITLE = 200;
const TITLE_SEPARATOR = " - ";
/** Under this a truncated prefix is initials, not a hint. Drop it instead. */
const MIN_PREFIX = 8;

/** The project's name, then what the document is. */
export function projectDocumentTitle(
  projectName: string | null | undefined,
  documentName: string,
): string {
  const name = documentName.trim() || "Untitled document";
  const project = (projectName ?? "").trim();
  if (!project) return name.slice(0, MAX_PAGE_TITLE);
  /*
   * Already says which job it is. Templates named after the project they were
   * saved from are the ordinary round trip rather than an edge case
   * (`savePageAsTemplate` defaults its name to the document's title, which has
   * been through here), and prefixing those again gives
   * "Willow Street - Willow Street Punch List".
   */
  if (name.toLowerCase().startsWith(project.toLowerCase())) return name.slice(0, MAX_PAGE_TITLE);

  const room = MAX_PAGE_TITLE - name.length - TITLE_SEPARATOR.length;
  // The document's own name is the half that says what this IS, so it is never
  // the half that gets cut.
  if (room < MIN_PREFIX) return name.slice(0, MAX_PAGE_TITLE);
  const prefix = project.length > room ? project.slice(0, room).trimEnd() : project;
  return `${prefix}${TITLE_SEPARATOR}${name}`;
}

/**
 * `desired`, numbered if the project already holds a document by that name.
 *
 * The same sheet is filled in on the same job more than once - a second service
 * call, a re-inspection after a fix, two daily logs in one day, a blank page
 * started and abandoned - and two rows reading exactly alike is the confusion
 * this whole rule is about, moved one level in.
 *
 * Deliberately not `nextCopyName`: "(copy)" claims the second visit is a
 * duplicate of the first, which is the one thing it is not.
 */
export function uniqueDocumentTitle(desired: string, taken: Iterable<string>): string {
  const used = new Set<string>();
  for (const t of taken) used.add(t.trim().toLowerCase());
  if (!used.has(desired.trim().toLowerCase())) return desired;

  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const base =
      desired.length + suffix.length > MAX_PAGE_TITLE
        ? desired.slice(0, MAX_PAGE_TITLE - suffix.length).trimEnd()
        : desired;
    const candidate = `${base}${suffix}`;
    // `used` is finite and every n gives a distinct candidate, so this ends.
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * What a duplicate of `sourceTitle` is called.
 *
 * The cap is the whole reason this is a function. "Copy of " is eight characters in
 * front of a title that is itself allowed to be 200, and `project_pages.title` is
 * plain `text` with no length constraint - so the write succeeded and produced a
 * 208 character title that `updateProjectPageInputSchema` then refused.
 *
 * That is not cosmetic. The editor sends the title with every autosave, so once a
 * document carried an over-long one, every body edit on it failed validation and
 * the user's typing was dropped with nothing on screen to say why: duplicating a
 * document with a long name produced a document that could never be edited again.
 *
 * The source title is the half that gets cut, because "Copy of" is the half that
 * says what this row is.
 */
export function copyDocumentTitle(sourceTitle: string | null | undefined): string {
  const prefix = "Copy of ";
  const name = (sourceTitle ?? "").trim() || "Untitled document";
  const room = MAX_PAGE_TITLE - prefix.length;
  return `${prefix}${name.length > room ? name.slice(0, room).trimEnd() : name}`;
}

/** Titles already in use inside one project, for `uniqueDocumentTitle`. */
export async function existingPageTitles(ctx: AuthedContext, projectId: string): Promise<string[]> {
  const { data } = await (ctx.supabase as any)
    .from("project_pages")
    .select("title")
    .eq("project_id", projectId);
  return ((data as { title: string }[]) ?? []).map((p) => p.title);
}

/**
 * The project's name and the titles already used inside it, together, so a
 * caller that needs both spends one round trip on them.
 */
export async function titleContext(
  ctx: AuthedContext,
  projectId: string,
): Promise<{ project: { name: string | null } | null; taken: string[] }> {
  const [{ data: project }, taken] = await Promise.all([
    (ctx.supabase as any).from("projects").select("name").eq("id", projectId).maybeSingle(),
    existingPageTitles(ctx, projectId),
  ]);
  return {
    // Null is "no such project, or not yours" - RLS answers both the same way.
    // A real project with an empty name is a row with `name: null` inside it.
    project: project ? { name: (project.name as string | null) ?? null } : null,
    taken,
  };
}
