import type { ShotCapture } from "./WalkthroughTemplatesManager";

/**
 * Starter shot lists, one per trade.
 *
 * Same reasoning as `STARTER_TEMPLATES` in ChecklistTemplatesPage and for the
 * same structural reason: `walkthrough_templates.created_by` is NOT NULL and
 * every policy on the table is `auth.uid() = created_by`, so there is no such
 * thing as an ownerless built-in here and no row a seed migration could insert
 * that anyone would be allowed to read. A starter is copied into the user's own
 * rows when they pick it.
 *
 * `category` is the vocabulary from @/lib/template-categories, so a company that
 * answered "we are electricians" gets Electrical first on this tab and on every
 * other tab from the one answer.
 *
 * `tests/walkthrough-starters.test.ts` holds these to one per trade and checks
 * the shot shapes.
 */
export interface WalkthroughStarter {
  name: string;
  description: string;
  /** A category from CATEGORY_ORDER, or undefined for a genuinely general one. */
  category?: string;
  shots: Array<{
    label: string;
    description?: string;
    capture: ShotCapture;
    required?: boolean;
  }>;
}

export const WALKTHROUGH_STARTERS: WalkthroughStarter[] = [
  {
    name: "Electrical Panel Walkthrough",
    category: "Electrical",
    description: "Panel and circuit evidence, from the street in to the last termination.",
    shots: [
      {
        label: "Street view of the property",
        description: "Establishes the address in the record.",
        capture: "photo",
        required: true,
      },
      {
        label: "Panel with the cover on",
        description: "Shows the panel as found, before anything was touched.",
        capture: "photo",
        required: true,
      },
      {
        label: "Panel with the cover off",
        description: "Full board, all breakers visible in one frame.",
        capture: "photo",
        required: true,
      },
      {
        label: "Panel schedule / directory label",
        description: "Close enough to read every circuit line.",
        capture: "photo",
      },
      { label: "Main breaker rating", capture: "photo", required: true },
      {
        label: "Any scorching, corrosion or double-taps",
        description: "One frame each. Skip only if there are none.",
        capture: "photo",
      },
      {
        label: "Meter and service entrance",
        capture: "photo",
      },
      {
        label: "Earth / ground connection at the rod",
        capture: "photo",
        required: true,
      },
      {
        label: "Measured supply voltage",
        description: "Write the reading down, with the phase it was taken on.",
        capture: "note",
        required: true,
      },
      {
        label: "Panel closed and labelled",
        description: "The as-left condition.",
        capture: "photo",
        required: true,
      },
    ],
  },
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
    name: "HVAC Service Walkthrough",
    category: "HVAC",
    description: "Indoor and outdoor units, readings, and the condition you left them in.",
    shots: [
      { label: "Thermostat and its current setting", capture: "photo", required: true },
      { label: "Indoor unit, wide", capture: "photo", required: true },
      {
        label: "Data plate: model and serial",
        description: "Legible.",
        capture: "photo",
        required: true,
      },
      { label: "Filter as found", capture: "photo", required: true },
      { label: "Filter replaced", capture: "photo" },
      { label: "Coil condition", capture: "photo" },
      { label: "Condensate drain and pan", capture: "photo" },
      { label: "Outdoor condenser, wide", capture: "photo", required: true },
      {
        label: "Gauges on, refrigerant pressures visible",
        capture: "photo",
        required: true,
      },
      {
        label: "Supply and return air temperatures",
        description: "Both readings, written down.",
        capture: "note",
        required: true,
      },
      {
        label: "System running after service",
        description: "Long enough to hear it.",
        capture: "video",
      },
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
  {
    name: "Roof Inspection Walkthrough",
    category: "Roofing & Exterior",
    description: "Ground to ridge, with the detail an adjuster will ask for.",
    shots: [
      { label: "Full roof from the ground, front", capture: "photo", required: true },
      { label: "Full roof from the ground, rear", capture: "photo", required: true },
      { label: "Ridge line", capture: "photo", required: true },
      { label: "Each slope, from the roof", capture: "photo", required: true },
      {
        label: "Damaged or missing shingles",
        description: "Wide first, then close. Skip only if there are none.",
        capture: "photo",
      },
      { label: "Flashing at every penetration", capture: "photo", required: true },
      { label: "Valleys", capture: "photo" },
      { label: "Gutters and downspouts", capture: "photo" },
      { label: "Attic underside, if accessible", capture: "photo" },
      {
        label: "Measured or estimated roof age",
        capture: "note",
      },
    ],
  },
  {
    name: "Water Damage Walkthrough",
    category: "Restoration",
    description: "Source, spread and readings, in the order an adjuster reads them.",
    shots: [
      { label: "Property exterior with address", capture: "photo", required: true },
      { label: "Point of entry / source of water", capture: "photo", required: true },
      {
        label: "Each affected room, wide",
        description: "One frame per room, from the doorway.",
        capture: "photo",
        required: true,
      },
      { label: "Standing water or saturation line", capture: "photo", required: true },
      {
        label: "Moisture meter reading against each wet surface",
        description: "The meter and the surface in the same frame.",
        capture: "photo",
        required: true,
      },
      { label: "Affected contents and furniture", capture: "photo" },
      { label: "Ceiling and subfloor where visible", capture: "photo" },
      { label: "Equipment placed on site", capture: "photo", required: true },
      {
        label: "Walk of the whole affected area",
        description: "One continuous take, narrating what is wet.",
        capture: "video",
        required: true,
      },
    ],
  },
  {
    name: "Property Listing Walkthrough",
    category: "Real Estate",
    description: "A full walk of the property in the order a buyer would see it.",
    shots: [
      { label: "Street view and kerb appeal", capture: "photo", required: true },
      { label: "Front door and entry", capture: "photo", required: true },
      { label: "Living area", capture: "photo", required: true },
      { label: "Kitchen, wide", capture: "photo", required: true },
      {
        label: "Each bedroom",
        description: "One frame per room.",
        capture: "photo",
        required: true,
      },
      { label: "Each bathroom", capture: "photo", required: true },
      { label: "Garage, basement or loft", capture: "photo" },
      { label: "Rear garden or yard", capture: "photo", required: true },
      {
        label: "Continuous walk-through of the whole property",
        description: "Front door to back, one take, steady.",
        capture: "video",
        required: true,
      },
      {
        label: "Anything a buyer would ask about",
        capture: "note",
      },
    ],
  },
  {
    name: "General Job Walkthrough",
    category: "Field Reports",
    description: "Before, during and after. The catch-all when no trade list fits.",
    shots: [
      { label: "Arrival: the site as found", capture: "photo", required: true },
      { label: "The problem, wide", capture: "photo", required: true },
      { label: "The problem, close", capture: "photo", required: true },
      { label: "Work in progress", capture: "photo" },
      { label: "Anything unexpected found along the way", capture: "photo" },
      { label: "Completed work, same angle as the before shot", capture: "photo", required: true },
      { label: "Site left clean", capture: "photo" },
      {
        label: "What was done, in a sentence",
        capture: "note",
        required: true,
      },
    ],
  },
];
