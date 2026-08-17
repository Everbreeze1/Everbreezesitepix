import {
  Camera,
  ClipboardList,
  FileText,
  ListChecks,
  Newspaper,
  Tag,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from "lucide-react";

export type BlueprintItemKind =
  | "checklist"
  | "document"
  | "report"
  | "label_set"
  | "workflow"
  | "walkthrough";

/**
 * The project surface a blueprint item lands on, named exactly as the project
 * page names it.
 *
 * "I don't know what happens when I select a template" is answered by pointing
 * at a tab the user has already seen. `tab` is the label on the project's own
 * PageTabStrip - Documents really is the tab keyed `reports`, so the mapping is
 * spelled out here once rather than guessed at each call site.
 */
export type BlueprintDestination = "checklists" | "workflows" | "documents" | "reports" | "labels";

export const DESTINATION: Record<
  BlueprintDestination,
  {
    tab: string;
    icon: LucideIcon;
    blurb: string;
    /** `workspace` surfaces are not a tab on the project. */
    scope?: "project" | "workspace";
  }
> = {
  checklists: {
    tab: "Checklists",
    icon: ListChecks,
    blurb: "Tick-off lists the crew works through on site",
  },
  // Walkthroughs land here too. A shot list applied to a project becomes a run
  // of capture steps in this same tab, tagged as a walkthrough rather than a
  // workflow, so the blurb has to speak for both or it under-describes half of
  // what lands.
  workflows: {
    tab: "Workflows",
    icon: WorkflowIcon,
    blurb: "Phase-by-phase runs and capture shot lists, with photo prompts and sign-off gates",
  },
  documents: {
    tab: "Documents",
    icon: FileText,
    blurb: "Editable pages with the project's details already filled in, ready to export",
  },
  // Reports are workspace-level, not a project tab - they collect on the
  // Reports screen. Saying "the project's Documents tab" here sent people to a
  // tab that would never show them.
  reports: {
    tab: "Reports",
    icon: Newspaper,
    blurb: "Draft reports, listed on the workspace Reports screen and on the project",
    scope: "workspace",
  },
  labels: {
    tab: "Project labels",
    icon: Tag,
    blurb: "How the project sorts and filters across the workspace",
  },
};

/**
 * What each blueprint item turns into once it lands on a project.
 *
 * The library screens named the *template* type and stopped there, which is why
 * "I don't know what happens when I select a template" was a fair complaint -
 * nothing told you a workflow becomes a live, phase-by-phase run the crew works
 * through, or that a document becomes a site log with the project's details
 * already filled in.
 *
 * `plural` used to double as the key the apply service reports counts under.
 * That contract broke the one time the two could differ: the service counts
 * label sets under `label_sets`, the display plural is "label sets", the lookup
 * matched on `plural` and missed, and the result screen fell back to printing
 * the raw key - the "1 label_sets" in the bug report. They are now separate
 * fields, because a display string and a wire key have no reason to agree.
 *
 * `countsKey` must stay in step with `counts` in applyProjectBlueprintService.
 * It is also the key persisted into `project_blueprint_applications.counts`, so
 * it is not free to rename - historical ledger rows carry the old keys.
 */
export const KIND_OUTCOME: Record<
  BlueprintItemKind,
  {
    label: string;
    /** Display-only. Never compared against a server payload. */
    plural: string;
    /** The key `applyProjectBlueprintService` reports this kind's count under. */
    countsKey: string;
    icon: LucideIcon;
    tint: string;
    becomes: string;
    destination: BlueprintDestination;
  }
> = {
  checklist: {
    label: "Checklist",
    plural: "checklists",
    countsKey: "checklists",
    icon: ClipboardList,
    tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    becomes: "A checklist the crew ticks off under the project's Checklists tab",
    destination: "checklists",
  },
  workflow: {
    label: "Workflow",
    plural: "workflows",
    countsKey: "workflows",
    icon: WorkflowIcon,
    tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    becomes: "A live run of phases, photo prompts and sign-off gates on the project",
    destination: "workflows",
  },
  document: {
    label: "Document",
    plural: "documents",
    countsKey: "documents",
    icon: FileText,
    tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    becomes:
      "An editable page in the project's Documents tab, project name, address, date and author already filled in",
    destination: "documents",
  },
  report: {
    label: "Report",
    plural: "reports",
    countsKey: "reports",
    icon: Newspaper,
    tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    becomes: "A draft report on the Reports screen, ready to edit and share",
    destination: "reports",
  },
  walkthrough: {
    label: "Walkthrough",
    plural: "walkthroughs",
    countsKey: "walkthroughs",
    icon: Camera,
    tint: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    becomes: "A shot list on the project, one capture step per shot, ticked off as the crew works",
    destination: "workflows",
  },
  label_set: {
    label: "Label set",
    plural: "label sets",
    countsKey: "label_sets",
    icon: Tag,
    tint: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    becomes: "Its labels merged onto the project so it sorts and filters correctly",
    destination: "labels",
  },
};

/**
 * Kinds a blueprint may hold at most one of.
 *
 * From the spec: "A Blueprint equals zero-to-many checklists, zero-to-one
 * workflow, zero-to-many document templates, zero-to-many report templates,
 * zero-to-many walkthrough templates."
 *
 * A workflow is the project's status tracker, and a project has one status. Two
 * attached workflows would apply both and leave the project with two competing
 * trackers and no rule for which one is the status. The picker enforces this
 * and so does the apply service, because the picker is not the only writer.
 */
export const SINGLETON_KINDS: ReadonlySet<BlueprintItemKind> = new Set<BlueprintItemKind>([
  "workflow",
]);

/** Destinations in the order a blueprint fills them. */
const DESTINATION_ORDER: BlueprintDestination[] = [
  "checklists",
  "workflows",
  "documents",
  "reports",
  "labels",
];

/**
 * "Where does applying this put things", as one line rather than a panel.
 *
 * The blueprint detail used to answer that with a full grouped preview listing
 * every item by name, directly above the contents list that already listed
 * every item by name. Two panels, one set of facts. This collapses the answer
 * to a destination and a count, and the naming stays with the contents list -
 * the apply dialog still shows the full grouped picture, which is where it
 * matters, because that is the moment something actually happens.
 */
export function destinationTotals(
  items: Array<{ kind: BlueprintItemKind }>,
  labels: string[],
): Array<{ destination: BlueprintDestination; count: number }> {
  const totals = new Map<BlueprintDestination, number>();
  for (const item of items) {
    const d = KIND_OUTCOME[item.kind].destination;
    totals.set(d, (totals.get(d) ?? 0) + 1);
  }
  // Blueprint labels are not items, but they land on the project all the same.
  if (labels.length) totals.set("labels", (totals.get("labels") ?? 0) + labels.length);
  return DESTINATION_ORDER.filter((d) => totals.has(d)).map((d) => ({
    destination: d,
    count: totals.get(d)!,
  }));
}

/** Kinds in the order a blueprint applies them, for stable UI grouping. */
export const KIND_ORDER: BlueprintItemKind[] = [
  "checklist",
  "workflow",
  "walkthrough",
  "document",
  "report",
  "label_set",
];
