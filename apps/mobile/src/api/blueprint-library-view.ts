import { OUTCOME, type BlueprintItemKind } from "./blueprints-view";
import { categoryRank, matchesSearch, tradeOf } from "./template-library-view";

/**
 * The blueprint library: authoring the bundles rather than applying them.
 *
 * Import-free (types and two sibling rule modules aside) so the rules are
 * tested directly. Every rule here is the web's, from `TemplatesPage.tsx`,
 * restated for a phone; the comments say which.
 */

/** One row of `project_templates`, as the library needs it. */
export type BlueprintRow = {
  id: string;
  name: string;
  description: string | null;
  labels: string[];
  archived: boolean;
  /** The trade, or null for General. */
  category: string | null;
  /** The blueprint a new project of this trade starts from. */
  isDefault: boolean;
  createdAt: string;
};

/**
 * One section link. `legacy` rows live in `project_template_checklists`, which
 * predates `project_template_items`; both still apply, so both are shown.
 */
export type SectionLink = {
  id: string;
  blueprintId: string;
  kind: BlueprintItemKind;
  refId: string;
  position: number;
  legacy: boolean;
};

export type SectionRow = SectionLink & { name: string; missing: boolean };

/** What the "add a section" picker offers from each library. */
export type LibraryEntry = { id: string; name: string };
export type Libraries = Record<BlueprintItemKind, LibraryEntry[]>;

/**
 * The kinds a new section may be.
 *
 * The web parks walkthroughs and label sets behind `SHOW_WALKTHROUGH_TEMPLATES`
 * and `SHOW_LABEL_SETS` (both false), which stop the "Add section" menu
 * offering them while every existing section of those kinds keeps working. The
 * phone follows it: offering them here would recreate the confusion the web
 * owner parked them to avoid.
 */
export const ADDABLE_KINDS: BlueprintItemKind[] = ["checklist", "workflow", "document", "report"];

/**
 * At most one workflow per blueprint: a project has one status, and two
 * attached workflows would be two competing trackers. The web's picker and its
 * writer both enforce this, and so do these.
 */
export const SINGLETON_KINDS: ReadonlySet<BlueprintItemKind> = new Set<BlueprintItemKind>([
  "workflow",
]);

/** The readable kind name, singular: "checklist", "shot list". */
export function kindName(kind: BlueprintItemKind): string {
  return OUTCOME[kind].one;
}

/**
 * The library list: filtered by archive state, trade and search, sorted by
 * trade, then the trade's default first, then name. The web's rail order.
 */
export function visibleBlueprints(
  rows: readonly BlueprintRow[],
  opts: { showArchived: boolean; search: string; trade: string | null },
): BlueprintRow[] {
  return rows
    .filter((row) => {
      if (!opts.showArchived && row.archived) return false;
      if (opts.trade && tradeOf(row.category) !== opts.trade) return false;
      return matchesSearch(
        opts.search,
        row.name,
        row.description,
        row.category,
        row.labels.join(" "),
      );
    })
    .sort(
      (a, b) =>
        categoryRank(tradeOf(a.category)) - categoryRank(tradeOf(b.category)) ||
        Number(b.isDefault) - Number(a.isDefault) ||
        a.name.localeCompare(b.name),
    );
}

/** Trades actually in use, so the filter never offers an empty result. */
export function tradesInUse(rows: readonly BlueprintRow[], showArchived: boolean): string[] {
  const present = new Set(
    rows.filter((r) => showArchived || !r.archived).map((r) => tradeOf(r.category)),
  );
  return [...present].sort((a, b) => categoryRank(a) - categoryRank(b) || a.localeCompare(b));
}

/**
 * A blueprint's contents in apply order.
 *
 * Legacy checklist links first, because `applyProjectBlueprintService` runs
 * them first: the list shows what will actually happen. A section pointing at
 * a deleted template stays visible as "Deleted ..." so it can be removed.
 */
export function sectionRows(
  blueprintId: string,
  links: readonly SectionLink[],
  libraries: Libraries,
): SectionRow[] {
  const mine = links.filter((l) => l.blueprintId === blueprintId);
  const legacy = mine.filter((l) => l.legacy).sort((a, b) => a.position - b.position);
  const rest = mine.filter((l) => !l.legacy).sort((a, b) => a.position - b.position);
  return [...legacy, ...rest].map((link) => {
    const name = libraries[link.kind]?.find((e) => e.id === link.refId)?.name ?? null;
    return {
      ...link,
      name: name ?? `Deleted ${kindName(link.kind)} template`,
      missing: name === null,
    };
  });
}

/** Why a kind cannot be added right now, or null when it can. */
export function addRefusal(
  kind: BlueprintItemKind,
  sections: readonly SectionRow[],
): string | null {
  if (SINGLETON_KINDS.has(kind) && sections.some((s) => s.kind === kind && !s.missing)) {
    return `This blueprint already has a ${kindName(kind)}. Remove it first to swap in another.`;
  }
  return null;
}

/** Library entries not already in the blueprint, so nothing is added twice. */
export function addableEntries(
  kind: BlueprintItemKind,
  libraries: Libraries,
  sections: readonly SectionRow[],
): LibraryEntry[] {
  const taken = new Set(sections.filter((s) => s.kind === kind).map((s) => s.refId));
  return (libraries[kind] ?? []).filter((e) => !taken.has(e.id));
}

/**
 * The position a new section takes: max + 1 over the blueprint's generic rows.
 * Not the section count, which is gap-blind (removing never renumbers) and
 * includes legacy rows from the other table.
 */
export function nextSectionPosition(sections: readonly SectionRow[]): number {
  return sections.filter((s) => !s.legacy).reduce((max, s) => Math.max(max, s.position), -1) + 1;
}

/** "2 checklists, 1 workflow": the row's summary of what is inside. */
export function contentsSummary(sections: readonly Pick<SectionLink, "kind">[]): string {
  if (sections.length === 0) return "Empty";
  const counts = new Map<BlueprintItemKind, number>();
  for (const s of sections) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([kind, n]) => `${n} ${n === 1 ? OUTCOME[kind].one : OUTCOME[kind].many}`)
    .join(", ");
}

/**
 * The message for a failed save of the trade default.
 *
 * The one error this update can realistically hit is the partial unique index
 * rejecting a second default for the same trade, and "Failed to save" gives
 * nobody anything to act on.
 */
export function saveErrorMessage(
  code: string | null | undefined,
  message: string,
  category: string | null,
): string {
  if (code === "23505" && category) {
    return `Another blueprint is already the default for ${category}. Clear that one first.`;
  }
  return message || "That did not save.";
}

/** Swap two neighbours. Returns the same array when the move is off the end. */
export function swapped<T>(rows: readonly T[], index: number, by: -1 | 1): readonly T[] {
  const target = index + by;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** What installing a starter did, for the screen to say. */
export type InstallResult = {
  blueprintId: string;
  attached: number;
  skipped: { kind: BlueprintItemKind; name: string; reason: string }[];
  created: { kind: BlueprintItemKind; name: string }[];
};

/**
 * The install result in words. Reported in full rather than as a bare
 * success: the installer may have built pieces in other libraries, and may
 * have skipped one, which would otherwise show up only as a shorter bundle.
 */
export function installSummary(
  starterName: string,
  pieces: number,
  result: InstallResult,
): { title: string; lines: string[] } {
  const lines: string[] = [];
  if (result.created.length) {
    const n = result.created.length;
    lines.push(`Also added ${n} piece${n === 1 ? "" : "s"} to your libraries.`);
  }
  for (const s of result.skipped) lines.push(`${s.name}: ${s.reason}`);
  const title = result.skipped.length
    ? `"${starterName}" added with ${result.attached} of ${pieces} sections`
    : `"${starterName}" added`;
  return { title, lines };
}

/** A project the blueprint can be applied to. */
export type ApplyTarget = {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
};

export function targetAddress(target: ApplyTarget): string | null {
  return [target.street, target.city].filter(Boolean).join(", ") || null;
}

export function filterTargets(targets: readonly ApplyTarget[], search: string): ApplyTarget[] {
  return targets.filter((t) => matchesSearch(search, t.name, targetAddress(t)));
}

/** One project's outcome in a multi-project apply. */
export type TargetOutcome = {
  projectId: string;
  projectName: string;
  counts: Record<string, number>;
  failed: { kind: string; reason: string }[];
  error?: string;
};

/**
 * The headline after applying to several projects. Never "applied" over a run
 * where everything failed: a summary that can be false is worse than none.
 */
export function multiApplyHeadline(outcomes: readonly TargetOutcome[]): string {
  const ok = outcomes.filter((o) => !o.error);
  if (ok.length === 0) return "Could not apply. Nothing was created.";
  if (ok.length < outcomes.length) return `Applied to ${ok.length} of ${outcomes.length} projects.`;
  if (outcomes.some((o) => o.failed.length)) return "Applied, but some items could not be created.";
  return ok.length === 1 ? `Applied to ${ok[0].projectName}.` : `Applied to ${ok.length} projects.`;
}
