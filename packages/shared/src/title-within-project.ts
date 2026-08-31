/**
 * A document's title, as it should read *inside* the job it belongs to.
 *
 * Reports and pages are auto-named after the project they were made from, so a
 * job's Documents list came out as five rows of
 *
 *     20 Charlcote Crescent - Site visit ...
 *     20 Charlcote Crescent - Site visit ...
 *     20 Charlcote Crescent - Site visit ...
 *
 * The part that tells them apart - "Report - 8/14/2026", "HVAC Installation &
 * Start-Up Report" - is at the end, and the title has two lines before it
 * truncates. So every row looked the same and nobody could pick one out. The
 * same shape showed up on the project's Reports list.
 *
 * The prefix is dropped for display only. The stored title keeps the project
 * name, which matters everywhere the document is seen away from its job: a
 * public link, a PDF, an email attachment, the client's inbox. This is only for
 * lists rendered inside the project, where the name is already the screen's own
 * heading and repeating it costs the row its meaning.
 */

/**
 * Separators these titles actually use between the job name and the rest.
 *
 * The em dash is the escape `\u2014` rather than the character, which is the
 * repo rule for the one case where it is legitimate: MATCHING an em dash in
 * text somebody else wrote, rather than emitting one. `tests/no-em-dash.test.ts`
 * enforces that across every tracked file, and the literal here was failing it.
 *
 * A plain space is last, and is deliberate. Reports are named
 * `"{job} report - 8/1/2026"`, with nothing but a space before "report", so
 * without it the Reports list stayed unreadable after Documents was fixed. That
 * list is the one that needs it most: every report on a job carries the same
 * subtitle ("1 photo, no write-up yet, shared, 2w ago"), so the date in the
 * title is the only thing telling one from another.
 *
 * Safe in last position because the job name has to match in full first. With a
 * job called "Job A", the title "Job Alpha Report" leaves "lpha Report", which
 * begins with a letter rather than a separator, so nothing is stripped.
 */
const SEPARATORS = [" - ", " – ", " \u2014 ", " · ", ": ", " | ", " "];

export function titleWithinProject(
  title: string | null | undefined,
  projectName: string | null | undefined,
): string {
  const full = String(title ?? "").trim();
  const project = String(projectName ?? "").trim();
  if (!full || !project) return full;
  if (full.toLowerCase() === project.toLowerCase()) return full;
  if (!full.toLowerCase().startsWith(project.toLowerCase())) return full;

  const rest = full.slice(project.length);
  for (const separator of SEPARATORS) {
    if (rest.startsWith(separator)) {
      const trimmed = rest.slice(separator.length).trim();
      /*
       * What is left has to be a title, not punctuation.
       *
       * A row whose name is only the job plus a dangling separator has nothing
       * to show: "Job A - " stripped to "-", which is worse than the repetition
       * it was meant to fix, because there is nothing left to recognise or tap
       * with intent. Empty is the same problem. Both keep the full text.
       *
       * Introduced by allowing a bare space as a separator, and caught by the
       * test for it rather than on the screen.
       */
      return /[\p{L}\p{N}]/u.test(trimmed) ? trimmed : full;
    }
  }
  return full;
}
