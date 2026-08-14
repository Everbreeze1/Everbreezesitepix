// The shape of `report_templates.sections`, in one place.
//
// That jsonb column holds TWO different shapes and always will:
//
//   legacy   [{ heading, body }]                       - the column's DEFAULT
//                                                        '[]' and its comment in
//                                                        20260717145402_template_kinds.sql
//   current  { coverStyle, placeholders, items: [...] } - what the report template
//                                                        editor has written since
//                                                        cover styles and layouts
//                                                        were added
//
// Nothing migrated the old rows, so both are live data.
//
// This module exists because the two readers disagreed. The editor
// (ReportTemplatesManager) handled both shapes; `applyProjectBlueprintService`
// handled only the legacy array and reached for `.map` behind a `?? []` that
// guards null but not a wrong type - so applying a blueprint containing any
// report template saved by the current editor died with
// "sections.map is not a function", and the user was told the blueprint had been
// applied anyway.
//
// Same reasoning as report-rich.ts: one parser, used by every consumer, so the
// readings cannot drift apart again.

export type ReportCoverStyle = "minimal" | "centered" | "hero" | "photo";
export type ReportSectionLayout = "text" | "text-photos" | "photo-grid" | "checklist";

export interface ReportTemplateSection {
  id: string;
  heading: string;
  body: string;
  layout: ReportSectionLayout;
}

export interface ReportTemplateStructure {
  coverStyle: ReportCoverStyle;
  placeholders: string[];
  items: ReportTemplateSection[];
}

const COVER_STYLES: ReportCoverStyle[] = ["minimal", "centered", "hero", "photo"];
const SECTION_LAYOUTS: ReportSectionLayout[] = ["text", "text-photos", "photo-grid", "checklist"];

/**
 * A section id that is stable for a given row and unique within its list.
 *
 * `crypto.randomUUID` is used when it exists - the editor wants ids that survive
 * drag-and-drop reordering - but this module is imported by the API too, so it
 * must not assume a global that is only guaranteed from Node 19. The positional
 * fallback satisfies the only hard requirement (uniqueness within one list).
 */
function sectionId(raw: unknown, idx: number): string {
  if (typeof raw === "string" && raw) return raw;
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return `section-${idx}`;
}

function toSection(raw: unknown, idx: number): ReportTemplateSection {
  const s = (raw ?? {}) as Record<string, unknown>;
  const layout = s.layout as ReportSectionLayout;
  return {
    id: sectionId(s.id, idx),
    heading: typeof s.heading === "string" ? s.heading : `Section ${idx + 1}`,
    body: typeof s.body === "string" ? s.body : "",
    layout: SECTION_LAYOUTS.includes(layout) ? layout : "text",
  };
}

/**
 * Normalise whatever `report_templates.sections` holds into one structure.
 *
 * Total by construction: every branch returns a real object with a real `items`
 * array, so callers can `.map` without a type guard. A row that is null, a
 * string, a number or an object with no `items` yields an empty section list
 * rather than throwing - a blueprint must not die on one malformed template.
 */
export function parseReportTemplateStructure(raw: unknown): ReportTemplateStructure {
  // Legacy: a bare array IS the items list.
  if (Array.isArray(raw)) {
    return { coverStyle: "centered", placeholders: [], items: raw.map(toSection) };
  }

  // Defensive: jsonb round-tripped through a text column comes back as a JSON
  // string, which would otherwise fall through to the object branch and yield
  // an empty template with no hint as to why.
  if (typeof raw === "string") {
    try {
      const reparsed: unknown = JSON.parse(raw);
      // Only one level - a string inside a string is corrupt, not a shape.
      if (typeof reparsed !== "string") return parseReportTemplateStructure(reparsed);
    } catch {
      // Not JSON; fall through to the empty structure below.
    }
  }

  const obj = (raw ?? {}) as Record<string, unknown>;
  const coverStyle = obj.coverStyle as ReportCoverStyle;
  return {
    coverStyle: COVER_STYLES.includes(coverStyle) ? coverStyle : "centered",
    placeholders: Array.isArray(obj.placeholders)
      ? obj.placeholders.filter((p): p is string => typeof p === "string")
      : [],
    items: Array.isArray(obj.items) ? obj.items.map(toSection) : [],
  };
}
