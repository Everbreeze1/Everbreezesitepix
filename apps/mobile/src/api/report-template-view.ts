import type {
  ReportCoverStyle,
  ReportSectionLayout,
  ReportTemplateSection,
  ReportTemplateStructure,
} from "@everlumen/shared";
import { categoryRank, tradeOf } from "./template-library-view";

/**
 * Report templates: a named structure (cover style, placeholders, ordered
 * sections) that a report is assembled from. The web's `ReportTemplatesManager`
 * on a phone.
 *
 * Import-free apart from types. The column's two stored shapes are read with
 * the shared `parseReportTemplateStructure`, the same reader the API uses, and
 * written in today's shape only.
 */

export type ReportTemplateRow = {
  id: string;
  teamId: string | null;
  name: string;
  subtitle: string | null;
  sections: unknown;
  archived: boolean;
  category: string | null;
  createdAt: string;
};

export const COVER_STYLES: { id: ReportCoverStyle; label: string; hint: string }[] = [
  { id: "minimal", label: "Minimal", hint: "Clean title on a plain page." },
  { id: "centered", label: "Centered", hint: "Large centered title with subtitle." },
  { id: "hero", label: "Hero band", hint: "Bold colored hero band on top." },
  { id: "photo", label: "Photo cover", hint: "Full-bleed cover photo with overlay." },
];

export const LAYOUT_OPTIONS: { id: ReportSectionLayout; label: string }[] = [
  { id: "text", label: "Text only" },
  { id: "text-photos", label: "Text + photos" },
  { id: "photo-grid", label: "Photo grid" },
  { id: "checklist", label: "Checklist recap" },
];

export const DEFAULT_PLACEHOLDERS = [
  "project_name",
  "project_address",
  "author_name",
  "report_date",
  "photo_count",
];

let seq = 0;
/** A section id unique within its list; the editor never needs more. */
export function sectionId(): string {
  seq += 1;
  return `m-${Date.now().toString(36)}-${seq}`;
}

/** The structure a new template starts with: the web wizard's starter set. */
export function starterStructure(): ReportTemplateStructure {
  return {
    coverStyle: "centered",
    placeholders: [...DEFAULT_PLACEHOLDERS],
    items: [
      {
        id: sectionId(),
        heading: "Executive summary",
        body: "Overview of the site visit for {{project_name}} on {{report_date}}.",
        layout: "text",
      },
      { id: sectionId(), heading: "Observations", body: "", layout: "text-photos" },
      { id: sectionId(), heading: "Photos", body: "", layout: "photo-grid" },
      { id: sectionId(), heading: "Next steps", body: "", layout: "checklist" },
    ],
  };
}

export function newSection(): ReportTemplateSection {
  return { id: sectionId(), heading: "New section", body: "", layout: "text" };
}

/**
 * A typed placeholder as the web stores it: anything outside `[A-Za-z0-9_]`
 * becomes an underscore. Null when nothing is left or it is already there.
 */
export function cleanPlaceholder(input: string, existing: readonly string[]): string | null {
  const value = input.trim().replace(/[^a-zA-Z0-9_]/g, "_");
  if (!value || existing.includes(value)) return null;
  return value;
}

export function layoutLabel(layout: ReportSectionLayout): string {
  return LAYOUT_OPTIONS.find((o) => o.id === layout)?.label ?? "Text only";
}

/** The list order: trade, then creation date, the web's order. */
export function visibleReportTemplates(
  rows: readonly ReportTemplateRow[],
  showArchived: boolean,
): ReportTemplateRow[] {
  return rows
    .filter((r) => showArchived || !r.archived)
    .sort(
      (a, b) =>
        categoryRank(tradeOf(a.category)) - categoryRank(tradeOf(b.category)) ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

export function structureSummary(structure: ReportTemplateStructure): string {
  const n = structure.items.length;
  const cover = COVER_STYLES.find((c) => c.id === structure.coverStyle)?.label ?? "Centered";
  return `${n} section${n === 1 ? "" : "s"}, ${cover.toLowerCase()} cover`;
}
