/**
 * Applying a blueprint to a job.
 *
 * A blueprint bundles the checklists, documents, reports, workflows, shot lists
 * and label sets a company uses for one kind of job. Applying it instantiates
 * all of them onto a project at once, which is the difference between starting
 * a job and setting one up.
 *
 * Import-free so the wording can be tested, and the wording is most of the
 * feature: the complaint the web version was built to answer was "I don't know
 * what happens when I select a template". Naming the template type does not
 * answer it. Naming the tab the result lands on does.
 */

/** What a blueprint can contain. */
export type BlueprintItemKind =
  | "checklist"
  | "workflow"
  | "document"
  | "report"
  | "label_set"
  | "walkthrough";

/**
 * The display name and the wire key, kept apart on purpose.
 *
 * They were one field on the web once, and the single case where they differ is
 * exactly what broke it: the service counts label sets under `label_sets`, the
 * readable plural is "label sets", the lookup matched on the plural, missed,
 * and the result screen printed the raw key. The bug report said "1
 * label_sets". A display string and a wire key have no reason to agree, so they
 * are not the same field here either.
 *
 * `countsKey` must stay in step with `counts` in `applyProjectBlueprintService`
 * and is not free to rename: it is also persisted into
 * `project_blueprint_applications.counts`, so historical rows carry it.
 */
export const OUTCOME: Record<
  BlueprintItemKind,
  { one: string; many: string; countsKey: string; becomes: string; where: string }
> = {
  checklist: {
    one: "checklist",
    many: "checklists",
    countsKey: "checklists",
    becomes: "a list the crew ticks off on site",
    where: "Checklists",
  },
  workflow: {
    one: "workflow",
    many: "workflows",
    countsKey: "workflows",
    becomes: "a live run of phases, photo prompts and sign-off gates",
    where: "Workflows",
  },
  document: {
    one: "document",
    many: "documents",
    countsKey: "documents",
    becomes: "a page with the project's details already filled in",
    where: "Documents",
  },
  report: {
    one: "report",
    many: "reports",
    countsKey: "reports",
    becomes: "a draft report",
    // Workspace-level rather than a project tab. Saying "Documents" here sent
    // people to a tab that would never show them.
    where: "Reports",
  },
  label_set: {
    one: "label set",
    many: "label sets",
    countsKey: "label_sets",
    becomes: "labels that sort this job across the workspace",
    where: "Project labels",
  },
  walkthrough: {
    one: "shot list",
    many: "shot lists",
    countsKey: "walkthroughs",
    becomes: "a run of capture steps with photo prompts",
    where: "Workflows",
  },
};

const KINDS = Object.keys(OUTCOME) as BlueprintItemKind[];

/** What the apply op reports back. */
export type ApplyCounts = Record<string, number>;
export type ApplyFailure = { kind: string; reason: string };

export type ApplyResult = {
  counts: ApplyCounts;
  failed: ApplyFailure[];
  ledgerRecorded: boolean;
  originTagged: boolean;
};

/** One line per kind that actually landed, in a fixed order. */
export function landedLines(counts: ApplyCounts): string[] {
  const out: string[] = [];
  for (const kind of KINDS) {
    const outcome = OUTCOME[kind];
    // Read by the wire key, never by the plural. See the note on OUTCOME.
    const n = counts[outcome.countsKey] ?? 0;
    if (n <= 0) continue;
    out.push(`${n} ${n === 1 ? outcome.one : outcome.many} in ${outcome.where}`);
  }
  return out;
}

/** How many items landed in total. */
export function landedTotal(counts: ApplyCounts): number {
  return KINDS.reduce((sum, kind) => sum + (counts[OUTCOME[kind].countsKey] ?? 0), 0);
}

/**
 * The headline after applying.
 *
 * Nothing landing is a real outcome rather than an error: a blueprint whose
 * items were all archived applies cleanly and creates nothing. Saying "Done"
 * over an empty list would leave somebody hunting a project for things that
 * were never made.
 */
export function applySummary(result: ApplyResult): string {
  const total = landedTotal(result.counts);
  if (total === 0 && result.failed.length === 0) {
    return "That blueprint had nothing left in it, so nothing was added.";
  }
  if (total === 0) return "Nothing could be added.";
  const noun = total === 1 ? "item" : "items";
  if (result.failed.length === 0) return `${total} ${noun} added to this job.`;
  return `${total} ${noun} added, ${result.failed.length} could not be.`;
}

/**
 * What to say about the parts that did not land, or null.
 *
 * Shown rather than swallowed. A partial apply is the normal failure here - one
 * template referencing a document that has since been deleted - and somebody
 * who is not told will assume the whole blueprint is on the job.
 */
export function failureLines(result: ApplyResult): string[] {
  return result.failed.map((failure) => {
    const kind = KINDS.find((k) => OUTCOME[k].countsKey === failure.kind || k === failure.kind);
    const label = kind ? OUTCOME[kind].one : failure.kind;
    return `${label}: ${failure.reason}`;
  });
}

/**
 * A warning about provenance, or null.
 *
 * `originTagged` false means the items were created but nothing records which
 * blueprint made them, so "what set this project up?" becomes unanswerable. The
 * service deliberately reports this rather than failing, because the items
 * really were created. Surfacing it is the other half of that decision: a
 * silent flag nobody reads is the same as no flag.
 */
export function provenanceWarning(result: ApplyResult): string | null {
  if (landedTotal(result.counts) === 0) return null;
  if (result.ledgerRecorded && result.originTagged) return null;
  return "The items were added, but this job will not be able to say which blueprint set it up.";
}

/** A blueprint as the chooser needs it. */
export type BlueprintOption = {
  id: string;
  name: string;
  labels: string[];
  category: string | null;
  isDefault: boolean;
};

/**
 * The chooser's order: the category default first, then alphabetical.
 *
 * A company with one blueprint per job type has marked one as the default for
 * each, and that is the one being reached for nine times out of ten.
 */
export function sortedBlueprints(options: BlueprintOption[]): BlueprintOption[] {
  return [...options].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function filterBlueprints(options: BlueprintOption[], search: string): BlueprintOption[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return options;
  return options.filter((option) => {
    if (option.name.toLowerCase().includes(needle)) return true;
    if ((option.category ?? "").toLowerCase().includes(needle)) return true;
    return option.labels.some((label) => label.toLowerCase().includes(needle));
  });
}

/**
 * Whether to warn that this is a Team plan feature, before the tap.
 *
 * A warning, never a lock. The server gates on `plan === "team" OR
 * is_internal`, and `is_internal` is not in anything the phone can read, so a
 * client that refused on plan alone would lock out every internal account. The
 * badge sets the expectation and the server keeps the actual gate.
 */
export function planWarning(plan: string | null | undefined): string | null {
  return plan === "team" ? null : "Team plan";
}
