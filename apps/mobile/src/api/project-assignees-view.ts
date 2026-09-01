import { personName } from "@everlumen/shared";
/**
 * Who is on a job.
 *
 * Import-free so the two rules that are easy to get subtly wrong can be tested:
 * what a tick actually changes, and who gets told about it.
 *
 * The server owns the permission answer and hands it back as `canAssign`
 * alongside the data, so nothing here re-derives it from the roster. That is
 * deliberate on the server's part and worth honouring: a client that worked the
 * gate out for itself would eventually disagree with the write, and the failure
 * mode is a button that looks live and is refused.
 */

/** A teammate who could be on the crew. */
export type CrewCandidate = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
};

/** What the server returns for a set of projects. */
export type AssigneeMap = Record<string, string[]>;

/**
 * How somebody is named in a crew list.
 *
 * The handle rather than the whole address, matching the roster: a crew row is
 * narrow and a truncated address names nobody.
 */
export function crewName(person: { fullName: string | null; email: string | null }): string {
  return personName(person.fullName, person.email, "Teammate");
}

/**
 * Flip one person in or out of the ticked set.
 *
 * Returns a new array rather than mutating, and keeps the order stable so the
 * sheet does not reshuffle under a thumb mid-tap.
 */
export function toggled(selected: string[], userId: string): string[] {
  return selected.includes(userId) ? selected.filter((id) => id !== userId) : [...selected, userId];
}

/**
 * Who is about to be notified.
 *
 * Mirrors what the service actually does: it diffs against the existing rows
 * and tells only the people who were added. Re-saving without changing anything
 * notifies nobody, so the screen must not promise otherwise.
 *
 * Worth stating in the UI before the save rather than after, because assigning
 * somebody sends them a push, and a foreman tidying a crew list at seven in the
 * morning should know how many phones that lights up.
 */
export function newlyAssigned(before: string[], after: string[]): string[] {
  const had = new Set(before);
  return after.filter((id) => !had.has(id));
}

/** Who is being taken off. Not notified, but worth showing before a save. */
export function unassigned(before: string[], after: string[]): string[] {
  const keeps = new Set(after);
  return before.filter((id) => !keeps.has(id));
}

/** Whether the ticked set differs from what is stored. */
export function hasChanges(before: string[], after: string[]): boolean {
  if (before.length !== after.length) return true;
  const had = new Set(before);
  return after.some((id) => !had.has(id));
}

/**
 * The crew, in the order a person wants to read it.
 *
 * Assigned first, then everybody else, alphabetically within each group. The
 * point is that reopening the sheet shows you the current crew without
 * scrolling, which on a roster of thirty is the difference between glancing and
 * hunting.
 */
export function sortedRoster(people: CrewCandidate[], selected: string[]): CrewCandidate[] {
  const on = new Set(selected);
  return [...people].sort((a, b) => {
    const aOn = on.has(a.userId);
    const bOn = on.has(b.userId);
    if (aOn !== bOn) return aOn ? -1 : 1;
    return crewName(a).localeCompare(crewName(b));
  });
}

/**
 * The one-line summary on the project screen.
 *
 * Names rather than a count, because "Sam and Alex" tells a foreman what a
 * count does not. Two names then a remainder: three is already too wide for a
 * phone row and the third name is not the one being looked for anyway.
 */
export function crewSummary(people: CrewCandidate[], selected: string[]): string {
  const on = selected
    .map((id) => people.find((person) => person.userId === id))
    .filter((person): person is CrewCandidate => Boolean(person));

  if (on.length === 0) return "Nobody assigned";
  const names = on.map(crewName);
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * Why the crew cannot be changed, or null.
 *
 * `canAssign` comes from the server, which is the only place that knows. The
 * row is still shown when it is false: who is on a job is worth reading even by
 * somebody who cannot change it, and hiding it would make a Restricted member
 * think the job is unstaffed.
 */
export function assignRefusal(canAssign: boolean): string | null {
  return canAssign ? null : "Your role can see who is on this job but not change it.";
}

/**
 * What a save is about to do, in words.
 *
 * Assembled here rather than in the screen so the sentence and the request
 * cannot disagree, which is exactly how a confirmation ends up lying.
 */
export function changeSummary(
  people: CrewCandidate[],
  before: string[],
  after: string[],
): string | null {
  const named = (ids: string[]) =>
    ids
      .map((id) => people.find((person) => person.userId === id))
      .filter((person): person is CrewCandidate => Boolean(person))
      .map(crewName);

  const added = named(newlyAssigned(before, after));
  const removed = named(unassigned(before, after));
  if (added.length === 0 && removed.length === 0) return null;

  const parts: string[] = [];
  // Only the added are notified, and the wording says so: the service diffs
  // against what was already there rather than telling the whole crew again.
  if (added.length) parts.push(`${added.join(", ")} will be told`);
  if (removed.length) parts.push(`${removed.join(", ")} comes off the job`);
  return parts.join(". ");
}
