// The built-in report starter library.
//
// A report is a title, a cover, a photos-per-page density and an ordered list
// of sections. Left to build that from an empty screen, people produce one
// untitled section and dump every photo into it, which is exactly the informal
// output the report builder was supposed to replace. These starters hand over
// the skeleton a trade actually files: the headings, in order, with the page
// density that suits them.
//
// Deliberately code, not rows in `report_templates`. That table is team-scoped
// with RLS keyed on `created_by = auth.uid()` or team membership, so a global
// row would be unreadable without loosening the policy - and the built-in
// library has no author and never needs editing. `report_templates` stays what
// it is: templates a team writes for itself, which the picker lists alongside
// these.
//
// Sections carry a heading and nothing else on purpose. Prefilled body prose is
// worse than no prose: whatever ships in the template gets left in, and the
// client receives a PDF that reads as boilerplate. The heading tells the author
// what belongs there; the body is theirs.

/** Categories mirror the document template library so one vocabulary covers both. */
export type ReportStarterCategory =
  | "Field Reports"
  | "Insurance & Adjusting"
  | "Roofing & Exterior"
  | "Restoration"
  | "Cleaning"
  | "Field Admin";

export interface ReportStarterCover {
  enabled: boolean;
  showProjectName: boolean;
  showAddress: boolean;
  showDate: boolean;
  showAuthor: boolean;
}

export interface ReportStarter {
  id: string;
  name: string;
  /** One line, shown on the picker card. Says who files this and when. */
  description: string;
  category: ReportStarterCategory;
  /** Seeds the report's `photos_per_page`; the author can still change it. */
  photosPerPage: 1 | 2 | 3 | 4;
  cover: ReportStarterCover;
  /** Section headings, in the order they are created. */
  sections: string[];
}

const FULL_COVER: ReportStarterCover = {
  enabled: true,
  showProjectName: true,
  showAddress: true,
  showDate: true,
  showAuthor: true,
};

export const REPORT_STARTERS: readonly ReportStarter[] = [
  {
    id: "site-visit",
    name: "Site Visit Report",
    description:
      "The general-purpose visit write-up: what you found, what you did, what happens next.",
    category: "Field Reports",
    photosPerPage: 2,
    cover: FULL_COVER,
    sections: ["Overview", "What we found", "Work completed", "Next steps"],
  },
  {
    id: "before-after",
    name: "Before & After",
    description: "Proof-of-work for a finished job, with the before and after shots kept apart.",
    category: "Field Reports",
    photosPerPage: 2,
    cover: FULL_COVER,
    sections: ["Scope of work", "Before", "Work performed", "After"],
  },
  {
    id: "progress-update",
    name: "Progress Update",
    description:
      "A recurring update for a job still running: what moved this period, what is next.",
    category: "Field Reports",
    photosPerPage: 3,
    cover: FULL_COVER,
    sections: ["Summary", "Progress this period", "Site conditions", "Look ahead"],
  },
  {
    id: "photo-log",
    name: "Photo Log",
    description: "Dense, caption-per-photo record for the days when the photos are the report.",
    category: "Field Reports",
    photosPerPage: 4,
    // A log is a working record, not a deliverable with a title page. A cover
    // sheet in front of it is a page the reader has to turn past.
    cover: { ...FULL_COVER, enabled: false },
    sections: ["Notes", "Photos"],
  },
  {
    id: "damage-assessment",
    name: "Damage Assessment",
    description:
      "Documents a loss for an adjuster: what was inspected, what is damaged, what you recommend.",
    category: "Insurance & Adjusting",
    photosPerPage: 2,
    cover: FULL_COVER,
    sections: ["Scope of inspection", "Damage observed", "Cause and extent", "Recommendation"],
  },
  {
    id: "job-closeout",
    name: "Job Closeout",
    description:
      "Hands a finished job over: final condition, anything still open, notes for the owner.",
    category: "Field Admin",
    photosPerPage: 2,
    cover: FULL_COVER,
    sections: ["Work completed", "Final condition", "Outstanding items", "Handover notes"],
  },
] as const;

export function getReportStarter(id: string | null | undefined): ReportStarter | null {
  if (!id) return null;
  return REPORT_STARTERS.find((t) => t.id === id) ?? null;
}

/**
 * Category order for the picker.
 *
 * Derived from `REPORT_STARTERS` rather than hardcoded so a starter added to a
 * category that is not listed here still appears, instead of vanishing from the
 * picker because someone forgot to update a second list.
 */
export function reportStarterCategories(): ReportStarterCategory[] {
  const seen: ReportStarterCategory[] = [];
  for (const t of REPORT_STARTERS) if (!seen.includes(t.category)) seen.push(t.category);
  return seen;
}
