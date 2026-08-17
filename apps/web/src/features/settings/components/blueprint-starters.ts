import type { BlueprintItemKind } from "./blueprint-outcomes";

/**
 * Pre-built blueprints, so a company sees the pattern before building its own.
 *
 * From the spec: "Ship 2-3 pre-built Blueprints by trade (plumbing, remodel,
 * service call) so companies see the pattern before building their own, rather
 * than starting from a blank screen."
 *
 * WHY THESE ARE A CLIENT-SIDE RECIPE AND NOT A SEED MIGRATION. A blueprint is a
 * bundle of REFERENCES - `project_template_items` rows pointing at ids in the
 * component libraries. There are no fixed ids to point at: `checklist_templates`
 * and `walkthrough_templates` are per-user tables with no ownerless built-ins,
 * so the checklist a given company has is one they created or copied from a
 * starter, and its id did not exist when this file was written. A seeded
 * blueprint would therefore reference nothing.
 *
 * So a starter names the components it WANTS, by starter name, and the
 * installer resolves each name against what this user actually has, creating
 * the missing pieces from their own libraries' starters first. That is the same
 * two-layer discipline the spec is asking for, applied to the onboarding path:
 * the pieces are built in the libraries, and the blueprint only ever bundles
 * them.
 *
 * `tests/blueprint-starters.test.ts` checks that every component a starter asks
 * for exists in the library starters it would be resolved against, so a rename
 * on either side fails the build rather than shipping a blueprint that installs
 * half of itself.
 */
export interface BlueprintStarterPiece {
  kind: BlueprintItemKind;
  /**
   * The component's name, matched against the user's library and, failing that,
   * against that library's own starter list.
   */
  name: string;
}

export interface BlueprintStarter {
  name: string;
  description: string;
  /** A category from CATEGORY_ORDER. */
  category: string;
  labels: string[];
  /**
   * In apply order. At most one workflow, per the spec's "zero-to-one
   * workflow" - `SINGLETON_KINDS` is the runtime half of the same rule.
   */
  pieces: BlueprintStarterPiece[];
}

export const BLUEPRINT_STARTERS: BlueprintStarter[] = [
  {
    name: "Emergency Service Call",
    category: "Plumbing",
    description:
      "One-visit callout: prove what you found, fix it, prove it holds. The fastest of the three to run.",
    labels: ["Service call", "Urgent"],
    pieces: [
      { kind: "workflow", name: "Service call" },
      { kind: "checklist", name: "Plumbing Service Call" },
      { kind: "walkthrough", name: "Plumbing Leak Walkthrough" },
      { kind: "document", name: "Plumbing Service Call Report" },
    ],
  },
  {
    name: "New Plumbing Install",
    category: "Plumbing",
    description:
      "A multi-day install: staged workflow, pre-work condition record, and the paperwork that closes it out.",
    labels: ["Install"],
    pieces: [
      { kind: "workflow", name: "Install job" },
      { kind: "walkthrough", name: "Pre-Work Site Condition" },
      { kind: "checklist", name: "Plumbing Service Call" },
      { kind: "document", name: "Water Heater & Fixture Installation" },
      { kind: "report", name: "Site Visit Report" },
    ],
  },
  {
    name: "Bathroom Remodel",
    category: "Construction",
    description:
      "Full remodel from first walk to handover: the as-found record, the punch list, and the close-out report.",
    labels: ["Remodel"],
    pieces: [
      { kind: "workflow", name: "Install job" },
      { kind: "walkthrough", name: "Pre-Work Site Condition" },
      { kind: "checklist", name: "Punch List Walk" },
      { kind: "document", name: "Change Order Log" },
      { kind: "report", name: "Site Visit Report" },
    ],
  },
];
