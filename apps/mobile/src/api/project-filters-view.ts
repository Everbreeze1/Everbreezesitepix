/**
 * The Projects list's refinements: the web's Filters popover on the projects
 * page (Views, Stage, Tags, Labels, People, Date), for a thumb.
 *
 * Import-free so a test can hold the matching rules still, because two of them
 * are easy to get backwards and the web spells out why:
 *
 * Tags are AND. A project carries many tags, so "Kitchen and Urgent" narrows to
 * the jobs holding both.
 *
 * Stages are OR. A project holds one stage, so "Scheduled and Invoiced" would
 * always be empty; ticking two stages has to mean "either". "Not in a pipeline"
 * is a stage choice of its own (`NO_STAGE`), never folded into the first stage.
 *
 * Labels follow the switch (any or all), and People match anyone who
 * contributed photos to the job or created it, as on the web.
 *
 * The date range reads the web's way too: Start is when the project was
 * created, End is when it was completed, falling back to its last activity
 * while it is still open.
 */

/** The stage filter's stand-in for "not in a pipeline". */
export const NO_STAGE = "__none__";

export type LabelMode = "any" | "all";

export type ProjectFilters = {
  starredOnly: boolean;
  /** Archived jobs shown alongside the rest. "Only archived" is the status row's Archived. */
  includeArchived: boolean;
  stageIds: string[];
  tagIds: string[];
  labels: string[];
  labelMode: LabelMode;
  people: string[];
  /** "YYYY-MM-DD", inclusive. */
  from: string | null;
  to: string | null;
};

export const EMPTY_PROJECT_FILTERS: ProjectFilters = {
  starredOnly: false,
  includeArchived: false,
  stageIds: [],
  tagIds: [],
  labels: [],
  labelMode: "any",
  people: [],
  from: null,
  to: null,
};

/** What the filters read about one project beyond the list row itself. */
export type ProjectFacts = {
  created_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  pipeline_stage_id?: string | null;
  tagIds: string[];
  /** Recent photo uploaders, as the web's contributor filter reads. */
  contributorIds: string[];
};

type FilterableProject = {
  starred?: boolean | null;
  labels?: string[] | null;
  updated_at?: string | null;
};

/** Add or remove one value from a list, keeping order stable. */
export function toggleValue(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** How many refinements are on. The archive toggle and label mode are not counted. */
export function activeProjectFilterCount(filters: ProjectFilters): number {
  return (
    (filters.starredOnly ? 1 : 0) +
    filters.stageIds.length +
    filters.tagIds.length +
    filters.labels.length +
    filters.people.length +
    (filters.from || filters.to ? 1 : 0)
  );
}

/** Local midnight of a "YYYY-MM-DD", or null. */
function dayStart(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Whether one project passes the refinements.
 *
 * `facts` is null while they are still loading; a refinement that needs them
 * then lets the project through rather than emptying the list for a moment.
 */
export function matchesProjectFilters(
  project: FilterableProject,
  facts: ProjectFacts | null,
  filters: ProjectFilters,
): boolean {
  if (filters.starredOnly && !project.starred) return false;

  if (filters.labels.length > 0) {
    const have = (project.labels ?? []).map((label) => label.toLowerCase());
    const want = filters.labels.map((label) => label.toLowerCase());
    const ok =
      filters.labelMode === "all"
        ? want.every((label) => have.includes(label))
        : want.some((label) => have.includes(label));
    if (!ok) return false;
  }

  if (!facts) return true;

  if (filters.stageIds.length > 0) {
    if (!filters.stageIds.includes(facts.pipeline_stage_id ?? NO_STAGE)) return false;
  }

  if (filters.tagIds.length > 0) {
    const have = new Set(facts.tagIds);
    if (!filters.tagIds.every((id) => have.has(id))) return false;
  }

  if (filters.people.length > 0) {
    const people = new Set(facts.contributorIds);
    if (facts.created_by) people.add(facts.created_by);
    if (!filters.people.some((id) => people.has(id))) return false;
  }

  const from = dayStart(filters.from);
  if (from !== null) {
    const created = facts.created_at ? new Date(facts.created_at).getTime() : NaN;
    if (!(created >= from)) return false;
  }
  const to = dayStart(filters.to);
  if (to !== null) {
    // Inclusive of the whole end day.
    const until = to + 86_399_000;
    const endAt = facts.completed_at ?? facts.updated_at ?? project.updated_at ?? null;
    const end = endAt ? new Date(endAt).getTime() : NaN;
    if (!(end <= until)) return false;
  }

  return true;
}

/** Whether any refinement needs the facts read at all. */
export function needsProjectFacts(filters: ProjectFilters): boolean {
  return (
    filters.stageIds.length > 0 ||
    filters.tagIds.length > 0 ||
    filters.people.length > 0 ||
    Boolean(filters.from || filters.to)
  );
}

export type ProjectFilterChip = { key: string; label: string };

/**
 * The applied refinements as removable chips under the header, each named for
 * what it is ("Stage: Scheduled", "Tag: kitchen"), so the list says why it is
 * short without opening the sheet.
 */
export function projectFilterChips(
  filters: ProjectFilters,
  names: {
    stage: (id: string) => string;
    tag: (id: string) => string;
    person: (id: string) => string;
  },
): ProjectFilterChip[] {
  const chips: ProjectFilterChip[] = [];
  if (filters.starredOnly) chips.push({ key: "starred", label: "Starred only" });
  if (filters.includeArchived) chips.push({ key: "archived", label: "Including archived" });
  for (const id of filters.stageIds) {
    chips.push({
      key: `stage:${id}`,
      label: `Stage: ${id === NO_STAGE ? "Not in a pipeline" : names.stage(id)}`,
    });
  }
  for (const id of filters.tagIds) chips.push({ key: `tag:${id}`, label: `Tag: ${names.tag(id)}` });
  for (const name of filters.labels) chips.push({ key: `label:${name}`, label: `Label: ${name}` });
  for (const id of filters.people) {
    chips.push({ key: `person:${id}`, label: `By ${names.person(id)}` });
  }
  if (filters.from || filters.to) {
    chips.push({ key: "date", label: dateRangeChip(filters.from, filters.to) });
  }
  return chips;
}

function dateRangeChip(from: string | null, to: string | null): string {
  if (from && to) return `${from} to ${to}`;
  if (from) return `From ${from}`;
  return `Until ${to}`;
}

/** The filters with one chip's refinement taken off. */
export function withoutProjectFilterChip(filters: ProjectFilters, key: string): ProjectFilters {
  if (key === "starred") return { ...filters, starredOnly: false };
  if (key === "archived") return { ...filters, includeArchived: false };
  if (key === "date") return { ...filters, from: null, to: null };
  const at = key.indexOf(":");
  const kind = key.slice(0, at);
  const value = key.slice(at + 1);
  if (kind === "stage") return { ...filters, stageIds: filters.stageIds.filter((v) => v !== value) };
  if (kind === "tag") return { ...filters, tagIds: filters.tagIds.filter((v) => v !== value) };
  if (kind === "label") return { ...filters, labels: filters.labels.filter((v) => v !== value) };
  if (kind === "person") return { ...filters, people: filters.people.filter((v) => v !== value) };
  return filters;
}
