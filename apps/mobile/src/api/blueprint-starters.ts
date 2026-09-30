import type { BlueprintItemKind } from "./blueprints-view";

/**
 * The pre-built blueprints the web offers under "Starters", and the library
 * pieces they are built from.
 *
 * A blueprint is a bundle of references, and the pieces it points at live in
 * per-user tables with no built-ins, so installing a starter first finds or
 * builds each piece in the user's own libraries (see `installBlueprintStarter`
 * in `blueprint-admin.ts`, a step-for-step port of the web installer).
 *
 * Copied from `apps/web/src/features/settings/components/*-starters.ts`
 * because the phone cannot import web code. Only the pieces a blueprint
 * starter names are here, and `tests/mobile-template-libraries.test.ts` checks
 * every one of them against the web original, so a rename there fails the
 * build rather than shipping a starter that installs half of itself.
 */

export type BlueprintStarterPiece = { kind: BlueprintItemKind; name: string };

export type BlueprintStarter = {
  name: string;
  description: string;
  category: string;
  labels: string[];
  pieces: BlueprintStarterPiece[];
};

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

export type ChecklistStarter = {
  name: string;
  description: string;
  category?: string;
  items: { label: string; item_type: string; required?: boolean; description?: string }[];
};

export const CHECKLIST_STARTER_PIECES: ChecklistStarter[] = [
  {
    name: "Plumbing Service Call",
    category: "Plumbing",
    description: "Leak and fixture work: isolation, pressure, the repair, and proof it holds.",
    items: [
      { label: "Water isolated at stop tap", item_type: "checkbox", required: true },
      { label: "Leak located", item_type: "yes_no", required: true },
      { label: "Leak source and location", item_type: "text", required: true },
      { label: "Static water pressure (PSI / bar)", item_type: "numeric" },
      { label: "Hot water temperature", item_type: "numeric" },
      { label: "Shut-off valves operate", item_type: "pass_fail" },
      { label: "Repair completed", item_type: "checkbox", required: true },
      { label: "Pressure test held after repair", item_type: "pass_fail", required: true },
      { label: "Drains run clear", item_type: "pass_fail" },
      { label: "Water damage to make good", item_type: "yes_no" },
      { label: "Parts used", item_type: "text" },
    ],
  },
  {
    name: "Punch List Walk",
    category: "Construction",
    description: "Close-out walk before handover: what is outstanding and what blocks keys.",
    items: [
      { label: "All trades have walked their own scope", item_type: "checkbox", required: true },
      { label: "Mechanical, electrical, plumbing commissioned", item_type: "pass_fail" },
      {
        label: "Test and inspection certificates collected",
        item_type: "checkbox",
        required: true,
      },
      { label: "Manuals, warranties and as-builts handed over", item_type: "checkbox" },
      { label: "Open items remaining", item_type: "numeric", required: true },
      { label: "Items blocking handover", item_type: "numeric", required: true },
      { label: "Finish quality overall", item_type: "rating" },
      { label: "Site cleaned and waste removed", item_type: "checkbox" },
      { label: "Keys, fobs and access codes transferred", item_type: "checkbox" },
      { label: "Client walked the property", item_type: "yes_no", required: true },
      { label: "Outstanding work and who owns it", item_type: "text" },
    ],
  },
];

export type WorkflowStarter = {
  name: string;
  description: string;
  category?: string;
  phases: {
    name: string;
    description?: string;
    requires_signoff?: boolean;
    items: { kind: "check" | "photo" | "note"; label: string; required?: boolean }[];
  }[];
};

export const WORKFLOW_STARTER_PIECES: WorkflowStarter[] = [
  {
    name: "Install job",
    category: "Field Admin",
    description: "Pre-job walkthrough through customer handover, with sign-off at each gate.",
    phases: [
      {
        name: "Pre-job",
        description: "Confirm scope and site conditions before anything comes off the truck.",
        items: [
          { kind: "check", label: "Scope confirmed with customer", required: true },
          { kind: "photo", label: "Site condition - wide shot", required: true },
          { kind: "check", label: "Access and parking arranged" },
          { kind: "note", label: "Existing damage noted" },
        ],
      },
      {
        name: "Install",
        items: [
          { kind: "check", label: "Equipment set and secured", required: true },
          { kind: "photo", label: "Rough-in progress", required: true },
          { kind: "check", label: "Connections torqued to spec", required: true },
          { kind: "photo", label: "Nameplate / serial number", required: true },
        ],
      },
      {
        name: "Inspection",
        requires_signoff: true,
        description: "Verify the work before the customer sees it.",
        items: [
          { kind: "check", label: "Leak / pressure test passed", required: true },
          { kind: "check", label: "System cycled and operating", required: true },
          { kind: "note", label: "Readings recorded" },
        ],
      },
      {
        name: "Handover",
        requires_signoff: true,
        items: [
          { kind: "photo", label: "Completed install", required: true },
          { kind: "check", label: "Customer walkthrough completed", required: true },
          { kind: "check", label: "Site cleaned up", required: true },
          { kind: "note", label: "Follow-up needed?" },
        ],
      },
    ],
  },
  {
    name: "Service call",
    category: "Field Admin",
    description: "A single-visit troubleshoot-and-repair loop.",
    phases: [
      {
        name: "Arrival",
        items: [
          { kind: "check", label: "Arrived on site", required: true },
          { kind: "photo", label: "Equipment as found", required: true },
          { kind: "note", label: "Customer-reported symptoms", required: true },
        ],
      },
      {
        name: "Diagnose",
        items: [
          { kind: "note", label: "Fault found", required: true },
          { kind: "photo", label: "Failed component" },
          { kind: "check", label: "Estimate approved by customer", required: true },
        ],
      },
      {
        name: "Repair & close",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Repair completed", required: true },
          { kind: "photo", label: "After repair", required: true },
          { kind: "check", label: "Tested under load", required: true },
          { kind: "note", label: "Parts used" },
        ],
      },
    ],
  },
];

export type WalkthroughStarter = {
  name: string;
  description: string;
  category?: string;
  shots: {
    label: string;
    description?: string;
    capture: "photo" | "video" | "note";
    required?: boolean;
  }[];
};

export const WALKTHROUGH_STARTER_PIECES: WalkthroughStarter[] = [
  {
    name: "Plumbing Leak Walkthrough",
    category: "Plumbing",
    description: "Trace a leak on camera: the source, the damage, the repair, and proof it holds.",
    shots: [
      { label: "Affected room, wide", capture: "photo", required: true },
      {
        label: "The leak itself",
        description: "Close enough to see where the water is coming from.",
        capture: "video",
        required: true,
      },
      {
        label: "Water damage to floor, ceiling or wall",
        description: "One frame per affected surface.",
        capture: "photo",
        required: true,
      },
      { label: "Moisture meter reading in shot", capture: "photo" },
      { label: "Shut-off valve location", capture: "photo", required: true },
      { label: "Pipework as found, before the repair", capture: "photo", required: true },
      { label: "Parts and fittings used", capture: "photo" },
      { label: "Completed repair", capture: "photo", required: true },
      {
        label: "Pressure test holding",
        description: "Film the gauge long enough to show it is steady.",
        capture: "video",
        required: true,
      },
      { label: "Area cleaned and dried", capture: "photo" },
    ],
  },
  {
    name: "Pre-Work Site Condition",
    category: "Construction",
    description:
      "The as-found record that settles damage disputes. Run it before any tool comes out.",
    shots: [
      { label: "Street view with house number", capture: "photo", required: true },
      { label: "Driveway and approach", capture: "photo" },
      { label: "Front elevation", capture: "photo", required: true },
      { label: "Each side elevation", description: "One frame per side.", capture: "photo" },
      { label: "Rear elevation", capture: "photo" },
      {
        label: "Work area, wide, before anything is moved",
        capture: "photo",
        required: true,
      },
      {
        label: "Existing damage anywhere near the work area",
        description: "One frame each. This is the shot that pays for itself.",
        capture: "photo",
        required: true,
      },
      { label: "Access route through the property", capture: "video" },
      { label: "Where materials will be staged", capture: "photo" },
      {
        label: "Anything the customer flagged on arrival",
        capture: "note",
      },
    ],
  },
];
