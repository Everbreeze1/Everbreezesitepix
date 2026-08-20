import { formatProjectAddress } from "./field-records";

/**
 * One place that decides what a project is called on screen.
 *
 * Every picker used to carry its own `p.name || "Untitled project"`, so a
 * workspace with several nameless projects rendered the same row several times
 * over and the only way to tell them apart was to pick one and see what
 * happened. Two things were wrong there and both are fixed here rather than in
 * each picker:
 *
 *  1. The fallback label was a constant, so N nameless projects collapsed to N
 *     identical rows. `describeProjects` keeps the label and adds a hint - the
 *     address, the job number, the client, and failing all of those the day it
 *     was created - to whichever rows actually collide.
 *  2. Project creation minted the constant as a real stored name. `newProjectName`
 *     stamps the fallback instead, so two blank creations no longer land on the
 *     same string in the database.
 */

export const UNTITLED_PROJECT = "Untitled project";

export interface ProjectNameFields {
  name?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  client_name?: string | null;
  project_number?: string | null;
  created_at?: string | null;
}

const trimmed = (v: string | null | undefined): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
};

/**
 * The single best label for a project.
 *
 * Falls through the fields a crew would actually use to name the job before it
 * gives up: the name they typed, the address they are standing at, the customer,
 * the job number.
 */
export function projectDisplayName(p: ProjectNameFields | null | undefined): string {
  if (!p) return UNTITLED_PROJECT;
  const num = trimmed(p.project_number);
  return (
    trimmed(p.name) ??
    trimmed(p.street) ??
    trimmed(p.client_name) ??
    (num ? `Job ${num}` : null) ??
    UNTITLED_PROJECT
  );
}

function createdOn(created_at: string | null | undefined, withTime: boolean): string | null {
  const raw = trimmed(created_at);
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (!withTime) return `Created ${date}`;
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Created ${date}, ${time}`;
}

/**
 * The things that can tell two same-named projects apart, best first.
 *
 * Deliberately no row id: an identifier on screen tells the user nothing they
 * can act on, and every one of these is something they recognise.
 */
function hintCandidates(p: ProjectNameFields, label: string): string[] {
  const out: string[] = [];
  const address = formatProjectAddress(p);
  if (address && address.toLowerCase() !== label.toLowerCase()) out.push(address);
  const num = trimmed(p.project_number);
  if (num) out.push(`Job ${num}`);
  const client = trimmed(p.client_name);
  if (client && client.toLowerCase() !== label.toLowerCase()) out.push(client);
  const day = createdOn(p.created_at, false);
  if (day) out.push(day);
  const minute = createdOn(p.created_at, true);
  if (minute) out.push(minute);
  return out;
}

export interface DescribedProject {
  /** What to show as the row's title. */
  label: string;
  /** A second line, set only on rows whose label is not unique in this list. */
  hint: string | null;
}

/**
 * Label a list of projects so no two rows read the same.
 *
 * Rows with a unique label get no hint at all - a subtitle under every entry is
 * noise, and the duplicates are the only rows that need explaining. Rows that
 * do collide take the first hint that is unique within their own collision
 * group, so a hint is never itself a duplicate.
 */
export function describeProjects<T extends ProjectNameFields>(
  projects: readonly T[],
): DescribedProject[] {
  const labels = projects.map((p) => projectDisplayName(p));
  const seen = new Map<string, number>();
  for (const label of labels) {
    const key = label.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  // Hints are chosen per collision group, so "Created Aug 21" only wins if it is
  // unique among the projects sharing that label - not merely present.
  const usedHints = new Map<string, Set<string>>();
  return projects.map((p, i) => {
    const label = labels[i];
    const key = label.toLowerCase();
    if ((seen.get(key) ?? 0) < 2) return { label, hint: null };
    const taken = usedHints.get(key) ?? new Set<string>();
    usedHints.set(key, taken);
    const hint = hintCandidates(p, label).find((h) => !taken.has(h.toLowerCase())) ?? null;
    if (hint) taken.add(hint.toLowerCase());
    return { label, hint };
  });
}

/**
 * The name to store when a project is created without one.
 *
 * Stamped, because the unstamped constant is what filled workspaces with
 * interchangeable "Untitled project" rows in the first place. Callers pass
 * `now` rather than reading the clock here so the value is testable.
 */
export function newProjectName(fields: ProjectNameFields, now: Date): string {
  const typed = trimmed(fields.name) ?? trimmed(fields.street) ?? trimmed(fields.client_name);
  if (typed) return typed;
  const stamp = now.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${UNTITLED_PROJECT} - ${stamp}`;
}
