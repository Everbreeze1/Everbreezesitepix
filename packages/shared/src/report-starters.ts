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

/**
 * Categories mirror the document template library so one vocabulary covers
 * both, and `makeCategoryRank` can order every Templates tab from the single
 * answer a company gives the account setup wizard.
 *
 * Every value here must also appear in CATEGORY_ORDER in
 * apps/web/src/lib/template-categories.ts. `tests/report-starters.test.ts`
 * checks that, and checks that each industry with a trade section of its own
 * has at least one starter filed under it - a company told their templates now
 * lead, opening a picker where nothing moved, is worse than never having been
 * asked.
 */
export type ReportStarterCategory =
  | "Field Reports"
  | "Insurance & Adjusting"
  | "Electrical"
  | "HVAC"
  | "Plumbing"
  | "Construction"
  | "Roofing & Exterior"
  | "Restoration"
  | "Cleaning"
  | "Real Estate"
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

  /*
   * Per-trade starters.
   *
   * The six above are report SHAPES - a visit, a before-and-after, a log - and
   * they stay, because plenty of work is shape-shaped. What was missing is the
   * report a specific trade actually files, so an electrician picking "Start
   * from" saw four general shapes and a damage assessment, and built the same
   * headings by hand on every job.
   *
   * One per trade that has a section of its own, matching the document library.
   */
  {
    id: "electrical-service",
    name: "Electrical Service Report",
    description:
      "The service call write-up: reported fault, what you found, readings, and what you fixed.",
    category: "Electrical",
    photosPerPage: 2,
    cover: FULL_COVER,
    sections: [
      "Reported problem",
      "What we found",
      "Readings and tests",
      "Work performed",
      "Safety items to flag",
      "Recommended follow-up",
    ],
  },
  {
    id: "hvac-service",
    name: "HVAC Service Report",
    description:
      "Diagnosis, readings and repair for a service call, in the order a tech works through it.",
    category: "HVAC",
    photosPerPage: 2,
    cover: FULL_COVER,
    sections: [
      "Reported problem",
      "System and equipment",
      "Readings",
      "Diagnosis",
      "Work performed",
      "Recommendations",
    ],
  },
  {
    id: "plumbing-service",
    name: "Plumbing Service Report",
    description:
      "Leak or fixture work: where it was, what caused it, the repair, and proof it holds.",
    category: "Plumbing",
    photosPerPage: 2,
    cover: FULL_COVER,
    sections: [
      "Reported problem",
      "What we found",
      "Repair performed",
      "Pressure test and checks",
      "Water damage to make good",
      "Recommended follow-up",
    ],
  },
  {
    id: "construction-progress",
    name: "Construction Progress Report",
    description:
      "The periodic report a client or lender signs off on: what got built, and what it cost.",
    category: "Construction",
    photosPerPage: 3,
    cover: FULL_COVER,
    sections: [
      "Summary",
      "Progress by trade",
      "Evidence of work claimed",
      "Schedule",
      "Issues and delays",
      "Next period",
    ],
  },
  {
    id: "roof-inspection",
    name: "Roof Inspection Report",
    description:
      "Condition survey of a roof system, with the deficiency list a quote can be written from.",
    category: "Roofing & Exterior",
    photosPerPage: 2,
    cover: FULL_COVER,
    sections: [
      "Roof details",
      "Covering and flashing",
      "Drainage and penetrations",
      "Deficiencies",
      "Remaining life and recommendation",
    ],
  },
  {
    id: "restoration-drying",
    name: "Restoration Drying Log",
    description:
      "Daily drying record for a mitigation job: readings, equipment, and the clearance at the end.",
    category: "Restoration",
    photosPerPage: 3,
    cover: FULL_COVER,
    sections: [
      "Cause of loss",
      "Affected areas",
      "Equipment in place",
      "Daily moisture readings",
      "Clearance",
    ],
  },
  {
    id: "cleaning-signoff",
    name: "Cleaning Sign-Off",
    description: "Proof-of-work for a clean, room by room, with the photos an invoice rests on.",
    category: "Cleaning",
    photosPerPage: 3,
    cover: FULL_COVER,
    sections: ["Scope of clean", "Before", "Areas completed", "After", "Notes for next visit"],
  },
  {
    id: "property-condition",
    name: "Property Condition Report",
    description:
      "Whole-property survey for an owner, buyer or tenancy, with a prioritised defect list.",
    category: "Real Estate",
    photosPerPage: 2,
    cover: FULL_COVER,
    sections: [
      "Property details",
      "Exterior",
      "Interior",
      "Services",
      "Defects by priority",
      "Summary and recommendation",
    ],
  },
] as const;

export function getReportStarter(id: string | null | undefined): ReportStarter | null {
  if (!id) return null;
  return REPORT_STARTERS.find((t) => t.id === id) ?? null;
}
