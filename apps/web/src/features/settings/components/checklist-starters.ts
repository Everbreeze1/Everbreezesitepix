import type { ItemType } from "@/lib/checklist-items";

/**
 * The checklist library, and the trade each one belongs to.
 *
 * These are not database rows. `checklist_templates` is per-user - `created_by`
 * is NOT NULL and every policy is `auth.uid() = created_by` - so there is no
 * ownerless built-in to seed, the way the document library has. A starter is
 * copied into the user's own rows when they pick it.
 *
 * `category` is the same vocabulary the document library uses, from
 * @/lib/template-categories, so a company that said "we are plumbers" gets
 * Plumbing first on this tab and the Documents tab from the one answer.
 *
 * Four of these predate trades and covered restoration, HVAC, roofing and a
 * catch-all. An electrician, plumber, GC, agent or cleaner opening Starters
 * found nothing addressed to their work and built every checklist by hand, so
 * the six below them exist for exactly the reason the trade document templates
 * do. `tests/checklist-starters.test.ts` holds them to one per trade.
 */
export const STARTER_TEMPLATES: {
  name: string;
  description: string;
  /** A category from CATEGORY_ORDER, or undefined for a genuinely general one. */
  category?: string;
  items: { label: string; item_type: ItemType; required?: boolean; description?: string }[];
}[] = [
  {
    name: "Damage Assessment",
    category: "Restoration",
    description: "Rate condition of key building elements (1 = poor, 5 = excellent).",
    items: [
      { label: "Overall structural condition", item_type: "rating", required: true },
      { label: "Roof condition", item_type: "rating", required: true },
      { label: "Exterior walls / siding", item_type: "rating" },
      { label: "Windows & doors", item_type: "rating" },
      { label: "Interior finishes", item_type: "rating" },
      { label: "Water damage present?", item_type: "yes_no", required: true },
      { label: "Notes / additional observations", item_type: "text" },
    ],
  },
  {
    name: "HVAC Inspection",
    category: "HVAC",
    description: "Standard HVAC service call inspection.",
    items: [
      { label: "Thermostat operating correctly", item_type: "pass_fail", required: true },
      { label: "Filter condition", item_type: "rating" },
      { label: "Filter replaced", item_type: "checkbox" },
      { label: "Refrigerant pressure (PSI)", item_type: "numeric" },
      { label: "Supply air temperature (°F)", item_type: "numeric" },
      { label: "Return air temperature (°F)", item_type: "numeric" },
      { label: "Condensate drain clear", item_type: "pass_fail" },
      { label: "Blower motor amperage", item_type: "numeric" },
      { label: "Technician notes", item_type: "text" },
    ],
  },
  {
    name: "Roof Inspection",
    category: "Roofing & Exterior",
    description: "Visual inspection of roof system.",
    items: [
      { label: "Overall roof condition", item_type: "rating", required: true },
      { label: "Shingle / membrane integrity", item_type: "pass_fail", required: true },
      { label: "Flashing condition", item_type: "rating" },
      { label: "Gutters & downspouts clear", item_type: "yes_no" },
      { label: "Visible leaks or staining", item_type: "yes_no", required: true },
      { label: "Approximate age (years)", item_type: "numeric" },
      { label: "Recommended next action", item_type: "text" },
    ],
  },
  {
    name: "General Service Call",
    category: "Field Reports",
    description: "Catch-all checklist for any field visit.",
    items: [
      { label: "Arrived on site", item_type: "checkbox", required: true },
      { label: "Customer briefed on scope", item_type: "checkbox", required: true },
      { label: "Before photos taken", item_type: "checkbox" },
      { label: "Work completed", item_type: "checkbox", required: true },
      { label: "After photos taken", item_type: "checkbox" },
      { label: "Site cleaned up", item_type: "checkbox" },
      { label: "Customer satisfaction", item_type: "rating" },
      { label: "Follow-up needed?", item_type: "yes_no" },
      { label: "Visit summary", item_type: "text" },
    ],
  },
  {
    name: "Electrical Service Call",
    category: "Electrical",
    description: "Troubleshoot and repair: isolation, readings, terminations, test under load.",
    items: [
      { label: "Power isolated and locked out", item_type: "checkbox", required: true },
      { label: "Reported fault confirmed on site", item_type: "yes_no", required: true },
      { label: "Supply voltage (V)", item_type: "numeric", required: true },
      { label: "Load current (A)", item_type: "numeric" },
      { label: "Insulation resistance acceptable", item_type: "pass_fail" },
      { label: "Terminations torqued to spec", item_type: "checkbox" },
      { label: "Earth / ground continuity", item_type: "pass_fail", required: true },
      { label: "RCD / GFCI trip test", item_type: "pass_fail" },
      { label: "Circuit tested under load", item_type: "checkbox", required: true },
      { label: "Panel labelled and cover refitted", item_type: "checkbox" },
      { label: "Safety issues to flag to customer", item_type: "text" },
    ],
  },
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
  {
    name: "Move-In / Move-Out Inspection",
    category: "Real Estate",
    description: "Tenancy condition record: meters, keys, room grades, deposit-relevant damage.",
    items: [
      { label: "Move-out inspection (No = move-in)", item_type: "yes_no", required: true },
      { label: "Electricity meter reading", item_type: "numeric", required: true },
      { label: "Gas meter reading", item_type: "numeric" },
      { label: "Water meter reading", item_type: "numeric" },
      { label: "Keys and fobs handed over", item_type: "numeric", required: true },
      { label: "Kitchen condition", item_type: "rating", required: true },
      { label: "Bathroom condition", item_type: "rating", required: true },
      { label: "Living areas condition", item_type: "rating" },
      { label: "Bedrooms condition", item_type: "rating" },
      { label: "Smoke and CO alarms tested", item_type: "pass_fail", required: true },
      { label: "Damage beyond fair wear and tear", item_type: "yes_no", required: true },
      { label: "Damage detail and estimated cost", item_type: "text" },
      { label: "Tenant comments", item_type: "text" },
    ],
  },
  {
    name: "Cleaning Job Sign-Off",
    category: "Cleaning",
    description: "Room-by-room quality check with the proof photos a client can be invoiced on.",
    items: [
      { label: "Arrived and site access confirmed", item_type: "checkbox", required: true },
      { label: "Before photos taken", item_type: "checkbox", required: true },
      { label: "Kitchen and appliances", item_type: "rating", required: true },
      { label: "Bathrooms and sanitaryware", item_type: "rating", required: true },
      { label: "Floors vacuumed and mopped", item_type: "pass_fail" },
      { label: "Surfaces, glass and mirrors", item_type: "pass_fail" },
      { label: "Waste removed and bins relined", item_type: "checkbox" },
      { label: "Consumables restocked", item_type: "checkbox" },
      { label: "Areas skipped, and why", item_type: "text" },
      { label: "After photos taken", item_type: "checkbox", required: true },
      { label: "Client walked the work", item_type: "yes_no" },
    ],
  },
  {
    name: "Grounds Maintenance Visit",
    category: "Landscaping",
    description: "The recurring round: what was cut and cleared, plus anything worsening.",
    items: [
      { label: "Site access confirmed", item_type: "checkbox", required: true },
      { label: "Before photos taken", item_type: "checkbox", required: true },
      { label: "Lawns mown and edges cut", item_type: "pass_fail", required: true },
      { label: "Clippings collected and removed", item_type: "checkbox" },
      { label: "Beds weeded and mulch topped up", item_type: "pass_fail" },
      { label: "Shrubs and hedges trimmed", item_type: "pass_fail" },
      { label: "Paths and hard surfaces blown clear", item_type: "checkbox" },
      { label: "Irrigation checked and running", item_type: "pass_fail" },
      { label: "Overall condition of grounds", item_type: "rating", required: true },
      { label: "Plant health problems seen", item_type: "yes_no", required: true },
      { label: "Problems, where, and likely cause", item_type: "text" },
      { label: "After photos taken", item_type: "checkbox", required: true },
      { label: "Recommended additional work", item_type: "text" },
    ],
  },
  {
    name: "Claim Site Documentation",
    category: "Insurance & Adjusting",
    description: "First visit on a claim: cause, extent, what is salvageable, what is urgent.",
    items: [
      { label: "Policyholder present", item_type: "yes_no", required: true },
      { label: "Cause of loss identified", item_type: "yes_no", required: true },
      { label: "Cause of loss, in your words", item_type: "text", required: true },
      { label: "Date the loss occurred", item_type: "text" },
      { label: "Affected rooms or areas", item_type: "numeric", required: true },
      { label: "Overall extent of damage", item_type: "rating", required: true },
      { label: "Property safe to occupy", item_type: "yes_no", required: true },
      { label: "Emergency mitigation required", item_type: "yes_no", required: true },
      { label: "Contents salvageable", item_type: "pass_fail" },
      { label: "Overview photos taken", item_type: "checkbox", required: true },
      { label: "Close-up damage photos taken", item_type: "checkbox", required: true },
      { label: "Recommended next step", item_type: "text" },
    ],
  },
];
