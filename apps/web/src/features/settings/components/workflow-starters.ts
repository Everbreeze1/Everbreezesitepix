import type { ItemKind } from "@/lib/workflow-items";

/**
 * Blank-canvas templates are where this builder used to lose people: you got a
 * "Phase 1" with nothing in it and no sense of what a good workflow looks like.
 * Starters mirror the checklist designer and give the crew something to shape.
 *
 * `category` is the same vocabulary as the document and checklist libraries,
 * from @/lib/template-categories, so one answer in the setup wizard orders
 * every tab. The three original starters are shapes rather than trades - an
 * install, a service call, an inspection - which is why they sit under Field
 * Reports and Field Admin; the ones below them are written for a specific
 * trade's sequence and are filed under it.
 */
export const STARTER_WORKFLOWS: {
  name: string;
  description: string;
  /** A category from CATEGORY_ORDER, or undefined for a genuinely general one. */
  category?: string;
  phases: {
    name: string;
    description?: string;
    requires_signoff?: boolean;
    items: { kind: ItemKind; label: string; required?: boolean }[];
  }[];
}[] = [
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
  {
    name: "Inspection & report",
    category: "Field Reports",
    description: "Walk the site, document each area, hand over a signed report.",
    phases: [
      {
        name: "Exterior",
        items: [
          { kind: "photo", label: "Front elevation", required: true },
          { kind: "photo", label: "Roof / gutters", required: true },
          { kind: "check", label: "Drainage clear" },
          { kind: "note", label: "Exterior observations" },
        ],
      },
      {
        name: "Interior",
        items: [
          { kind: "photo", label: "Each affected room", required: true },
          { kind: "check", label: "Moisture readings taken", required: true },
          { kind: "note", label: "Interior observations" },
        ],
      },
      {
        name: "Report",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Findings summarised", required: true },
          { kind: "check", label: "Recommendations listed", required: true },
          { kind: "note", label: "Next steps agreed with customer" },
        ],
      },
    ],
  },
  {
    name: "Electrical fit-out",
    category: "Electrical",
    description: "Rough-in, inspection hold point, then trim out and energise.",
    phases: [
      {
        name: "Rough-in",
        description: "Everything that has to be right before it disappears behind a wall.",
        items: [
          { kind: "check", label: "Circuit layout matches drawings", required: true },
          { kind: "check", label: "Boxes set to finished wall depth", required: true },
          { kind: "check", label: "Cable secured and protected", required: true },
          { kind: "photo", label: "Open walls before close-up", required: true },
          { kind: "note", label: "Deviations from drawings" },
        ],
      },
      {
        name: "Inspection hold",
        description: "Nothing gets covered until this passes.",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Rough-in inspection booked", required: true },
          { kind: "check", label: "Inspection passed", required: true },
          { kind: "photo", label: "Inspection notice or sticker" },
          { kind: "note", label: "Corrections required" },
        ],
      },
      {
        name: "Trim out",
        items: [
          { kind: "check", label: "Devices and plates fitted", required: true },
          { kind: "check", label: "Terminations torqued to spec", required: true },
          { kind: "check", label: "Panel schedule filled in", required: true },
          { kind: "photo", label: "Finished panel", required: true },
        ],
      },
      {
        name: "Energise & hand over",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Insulation resistance test passed", required: true },
          { kind: "check", label: "RCD / GFCI trip tests passed", required: true },
          { kind: "check", label: "Every circuit energised and proved", required: true },
          { kind: "check", label: "Certificate issued to customer", required: true },
          { kind: "note", label: "Handover notes" },
        ],
      },
    ],
  },
  {
    name: "HVAC install & commission",
    category: "HVAC",
    description: "Set the equipment, prove the refrigerant side, commission and hand over.",
    phases: [
      {
        name: "Set equipment",
        items: [
          { kind: "check", label: "Old unit removed and disposed of", required: true },
          { kind: "check", label: "Pad or hangers level and secure", required: true },
          { kind: "photo", label: "Unit in position", required: true },
          { kind: "check", label: "Clearances meet manufacturer spec", required: true },
        ],
      },
      {
        name: "Connections",
        items: [
          { kind: "check", label: "Line set brazed under nitrogen", required: true },
          { kind: "check", label: "Pressure test held", required: true },
          { kind: "check", label: "System evacuated to spec", required: true },
          { kind: "check", label: "Condensate routed and trapped", required: true },
          { kind: "photo", label: "Line set and electrical connections" },
        ],
      },
      {
        name: "Commission",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Charge weighed in and verified", required: true },
          { kind: "check", label: "Supply and return temps recorded", required: true },
          { kind: "check", label: "Static pressure within range", required: true },
          { kind: "check", label: "Thermostat programmed", required: true },
          { kind: "note", label: "Commissioning readings" },
        ],
      },
      {
        name: "Hand over",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Customer shown controls and filter change", required: true },
          { kind: "check", label: "Warranty registered", required: true },
          { kind: "photo", label: "Finished installation", required: true },
          { kind: "note", label: "Follow-up or service plan agreed" },
        ],
      },
    ],
  },
  {
    name: "Plumbing rough-in to final",
    category: "Plumbing",
    description: "Rough-in, pressure test, fixture set, and a final that actually holds.",
    phases: [
      {
        name: "Rough-in",
        items: [
          { kind: "check", label: "Supply and waste routed to drawings", required: true },
          { kind: "check", label: "Falls and venting correct", required: true },
          { kind: "check", label: "Pipe supported and protected", required: true },
          { kind: "photo", label: "Open walls and floor before close-up", required: true },
        ],
      },
      {
        name: "Pressure test",
        requires_signoff: true,
        items: [
          { kind: "check", label: "System pressurised to spec", required: true },
          { kind: "check", label: "Held for the required period", required: true },
          { kind: "photo", label: "Gauge reading at start and end", required: true },
          { kind: "note", label: "Leaks found and corrected" },
        ],
      },
      {
        name: "Fixture set",
        items: [
          { kind: "check", label: "Fixtures set level and sealed", required: true },
          { kind: "check", label: "Shut-offs fitted and operating", required: true },
          { kind: "check", label: "Traps and tailpieces correct", required: true },
          { kind: "photo", label: "Each fixture installed" },
        ],
      },
      {
        name: "Final",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Every fixture run and checked for leaks", required: true },
          { kind: "check", label: "Hot water temperature verified", required: true },
          { kind: "check", label: "Work area cleaned", required: true },
          { kind: "note", label: "Customer walkthrough notes" },
        ],
      },
    ],
  },
  {
    name: "Construction phase handover",
    category: "Construction",
    description: "Pre-construction record, in-progress evidence, punch list, then keys.",
    phases: [
      {
        name: "Pre-construction",
        items: [
          { kind: "check", label: "Existing conditions photographed", required: true },
          { kind: "photo", label: "Neighbouring property condition", required: true },
          { kind: "check", label: "Utilities located and marked", required: true },
          { kind: "check", label: "Site set up, fenced and signed", required: true },
        ],
      },
      {
        name: "In progress",
        items: [
          { kind: "photo", label: "Work claimed this period", required: true },
          { kind: "check", label: "Inspections booked and passed", required: true },
          { kind: "note", label: "Delays, RFIs and what is being done" },
        ],
      },
      {
        name: "Punch list",
        requires_signoff: true,
        items: [
          { kind: "check", label: "All trades walked their own scope", required: true },
          { kind: "photo", label: "Outstanding items", required: true },
          { kind: "check", label: "Items blocking handover closed", required: true },
          { kind: "note", label: "Open items and who owns them" },
        ],
      },
      {
        name: "Handover",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Certificates, manuals and as-builts issued", required: true },
          { kind: "check", label: "Keys and access codes transferred", required: true },
          { kind: "check", label: "Client walked the property", required: true },
          { kind: "note", label: "Warranty period and contact" },
        ],
      },
    ],
  },
  {
    name: "Tenancy turnover",
    category: "Real Estate",
    description: "Move-out, make-ready, re-let: the evidence trail a deposit dispute needs.",
    phases: [
      {
        name: "Move-out inspection",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Meters read and recorded", required: true },
          { kind: "check", label: "Keys and fobs returned", required: true },
          { kind: "photo", label: "Every room, condition on exit", required: true },
          { kind: "note", label: "Damage beyond fair wear and tear" },
        ],
      },
      {
        name: "Make ready",
        items: [
          { kind: "check", label: "Repairs completed", required: true },
          { kind: "check", label: "Property professionally cleaned", required: true },
          { kind: "check", label: "Smoke and CO alarms tested", required: true },
          { kind: "photo", label: "Each room ready to let", required: true },
        ],
      },
      {
        name: "Re-let",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Marketing photos taken", required: true },
          { kind: "check", label: "Listing published", required: true },
          { kind: "check", label: "Move-in inspection booked", required: true },
          { kind: "note", label: "New tenancy details" },
        ],
      },
    ],
  },
  {
    name: "Recurring clean",
    category: "Cleaning",
    description: "Arrival, the round, then the proof photos a client can be invoiced on.",
    phases: [
      {
        name: "Arrival",
        items: [
          { kind: "check", label: "Site access confirmed", required: true },
          { kind: "photo", label: "Before, each main area", required: true },
          { kind: "check", label: "Any damage on arrival noted", required: true },
        ],
      },
      {
        name: "The round",
        items: [
          { kind: "check", label: "Kitchen and appliances", required: true },
          { kind: "check", label: "Bathrooms and sanitaryware", required: true },
          { kind: "check", label: "Floors and surfaces", required: true },
          { kind: "check", label: "Waste removed and bins relined", required: true },
          { kind: "check", label: "Consumables restocked" },
          { kind: "note", label: "Areas skipped, and why" },
        ],
      },
      {
        name: "Sign off",
        requires_signoff: true,
        items: [
          { kind: "photo", label: "After, each main area", required: true },
          { kind: "check", label: "Client walked the work" },
          { kind: "note", label: "Anything to flag for next visit" },
        ],
      },
    ],
  },
  {
    name: "Water damage mitigation",
    category: "Restoration",
    description: "Emergency response, drying, daily readings, then a clearance you can bill on.",
    phases: [
      {
        name: "Emergency response",
        items: [
          { kind: "check", label: "Source of water stopped", required: true },
          { kind: "check", label: "Category and class determined", required: true },
          { kind: "photo", label: "Affected areas on arrival", required: true },
          { kind: "check", label: "Standing water extracted", required: true },
          { kind: "note", label: "Cause of loss" },
        ],
      },
      {
        name: "Set up drying",
        items: [
          { kind: "check", label: "Non-salvageable material removed", required: true },
          { kind: "check", label: "Air movers and dehumidifiers placed", required: true },
          { kind: "check", label: "Containment set where required" },
          { kind: "photo", label: "Equipment in position", required: true },
        ],
      },
      {
        name: "Daily monitoring",
        items: [
          { kind: "check", label: "Moisture readings taken", required: true },
          { kind: "check", label: "Equipment checked and adjusted", required: true },
          { kind: "note", label: "Readings and drying progress" },
        ],
      },
      {
        name: "Clearance",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Dry standard met on every material", required: true },
          { kind: "check", label: "Equipment removed", required: true },
          { kind: "photo", label: "Final condition", required: true },
          { kind: "check", label: "Customer signed off on completion", required: true },
        ],
      },
    ],
  },
  {
    name: "Roof replacement",
    category: "Roofing & Exterior",
    description: "Tear-off through final inspection, with the deck photos a warranty needs.",
    phases: [
      {
        name: "Tear-off",
        items: [
          { kind: "photo", label: "Roof before work", required: true },
          { kind: "check", label: "Property and landscaping protected", required: true },
          { kind: "check", label: "Old covering removed", required: true },
          { kind: "photo", label: "Deck exposed", required: true },
        ],
      },
      {
        name: "Deck & underlayment",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Damaged decking replaced", required: true },
          { kind: "check", label: "Ice and water shield fitted where required", required: true },
          { kind: "check", label: "Underlayment laid to spec", required: true },
          { kind: "photo", label: "Underlayment before covering", required: true },
          { kind: "note", label: "Decking replaced, and how much" },
        ],
      },
      {
        name: "Covering & flashing",
        items: [
          { kind: "check", label: "Covering installed to manufacturer spec", required: true },
          { kind: "check", label: "Flashings and penetrations sealed", required: true },
          { kind: "check", label: "Ridge and ventilation fitted", required: true },
          { kind: "photo", label: "Completed roof", required: true },
        ],
      },
      {
        name: "Final",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Gutters cleared and site magnet-swept", required: true },
          { kind: "check", label: "Final inspection passed", required: true },
          { kind: "check", label: "Warranty issued to customer", required: true },
          { kind: "note", label: "Handover notes" },
        ],
      },
    ],
  },
  {
    name: "Landscape installation",
    category: "Landscaping",
    description: "Clear and prepare, build and plant, then establish before you walk away.",
    phases: [
      {
        name: "Site preparation",
        description: "Everything that decides whether the planting lives.",
        items: [
          { kind: "photo", label: "Site before work", required: true },
          { kind: "check", label: "Existing vegetation cleared", required: true },
          { kind: "check", label: "Levels and falls set", required: true },
          { kind: "check", label: "Drainage installed or confirmed", required: true },
          { kind: "check", label: "Soil improved and graded", required: true },
          { kind: "note", label: "Ground conditions found" },
        ],
      },
      {
        name: "Hard landscaping",
        items: [
          { kind: "check", label: "Edging and paths set out", required: true },
          { kind: "check", label: "Bases compacted", required: true },
          { kind: "check", label: "Surfaces laid and jointed", required: true },
          { kind: "photo", label: "Hard landscaping complete" },
        ],
      },
      {
        name: "Irrigation",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Zones laid out to plan", required: true },
          { kind: "check", label: "Pressure tested before backfill", required: true },
          { kind: "photo", label: "Trenches open before backfill", required: true },
          { kind: "check", label: "Controller programmed", required: true },
          { kind: "note", label: "Zone run times set" },
        ],
      },
      {
        name: "Planting",
        items: [
          { kind: "check", label: "Plants set out and approved before planting", required: true },
          { kind: "check", label: "Planted to correct depth and spacing", required: true },
          { kind: "check", label: "Turf laid and rolled", required: true },
          { kind: "check", label: "Mulch applied", required: true },
          { kind: "photo", label: "Planting complete", required: true },
          { kind: "note", label: "Substitutions made, and why" },
        ],
      },
      {
        name: "Handover & establishment",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Site cleared of surplus and waste", required: true },
          { kind: "check", label: "Client shown the irrigation controller", required: true },
          { kind: "check", label: "Plant list and care notes handed over", required: true },
          { kind: "check", label: "Establishment schedule agreed", required: true },
          { kind: "photo", label: "Finished scheme", required: true },
          { kind: "note", label: "Warranty terms and first return visit" },
        ],
      },
    ],
  },
  {
    name: "Claim from first notice to estimate",
    category: "Insurance & Adjusting",
    description: "First contact, site documentation, scope, then the estimate the carrier gets.",
    phases: [
      {
        name: "First notice",
        items: [
          { kind: "check", label: "Policyholder contacted", required: true },
          { kind: "check", label: "Coverage confirmed", required: true },
          { kind: "check", label: "Site visit scheduled", required: true },
          { kind: "note", label: "Reported cause of loss" },
        ],
      },
      {
        name: "Site documentation",
        items: [
          { kind: "photo", label: "Overview of each affected area", required: true },
          { kind: "photo", label: "Close-ups of the damage", required: true },
          { kind: "check", label: "Measurements taken", required: true },
          { kind: "check", label: "Cause of loss confirmed on site", required: true },
          { kind: "note", label: "Observations and pre-existing damage" },
        ],
      },
      {
        name: "Scope",
        items: [
          { kind: "check", label: "Line-item scope written", required: true },
          { kind: "check", label: "Contents inventory taken" },
          { kind: "check", label: "Emergency mitigation documented" },
          { kind: "note", label: "Items in dispute" },
        ],
      },
      {
        name: "Estimate & submit",
        requires_signoff: true,
        items: [
          { kind: "check", label: "Estimate prepared", required: true },
          { kind: "check", label: "Policyholder walked through it", required: true },
          { kind: "check", label: "Submitted to carrier", required: true },
          { kind: "note", label: "Next steps and review date" },
        ],
      },
    ],
  },
];
