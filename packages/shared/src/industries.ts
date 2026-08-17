/**
 * The trades a company can say it is in, and what that answer changes.
 *
 * One list, three readers:
 *
 *   * the account setup wizard (apps/web AccountSetupDialog), which asks it;
 *   * the API (`saveCompanyProfile`), which validates the answer before storing
 *     it, so an industry id that no longer exists cannot be written by a stale
 *     tab or a hand-rolled request;
 *   * both template screens, which put a company's own trade at the top of the
 *     library instead of leaving a plumber to scroll past insurance and field
 *     admin to reach Plumbing.
 *
 * `categories` is the load-bearing half. The strings in it are document
 * template categories, seeded in supabase/migrations/*_document_templates_*
 * and ranked in apps/web/src/lib/template-categories.ts, and
 * tests/company-industries.test.ts checks that every one of them is a category
 * that actually exists. A typo here is a company whose "recommended for you"
 * section is empty.
 *
 * Ids are stored in `teams.industry`, so they are permanent: relabel one
 * freely, never renumber one.
 */

export interface Industry {
  /** Stored in `teams.industry`. Never change one after it ships. */
  id: string;
  label: string;
  /** One line under the label in the picker. */
  hint: string;
  /**
   * Template categories to surface first for this industry, most relevant
   * first. Must be categories the library actually seeds.
   */
  categories: string[];
  /**
   * The heading that *is* this trade, where the library has one written for it.
   *
   * Absent only for "Something else", which by definition cannot have one. It
   * still reorders the library, because leading with Field Reports beats
   * leading with Electrical for a company that would not say which they are,
   * but it gets no heading badged "Your trade": telling someone that "Field
   * Reports" is their trade is a claim about them that is not true, and it is
   * the kind of small wrongness that makes the whole personalisation read as
   * guessed.
   */
  tradeCategory?: string;
}

export const INDUSTRIES: readonly Industry[] = [
  {
    id: "electrical",
    label: "Electrical",
    hint: "Service calls, panel work, installs and testing",
    categories: ["Electrical", "Field Reports", "Field Admin"],
    tradeCategory: "Electrical",
  },
  {
    id: "hvac",
    label: "HVAC",
    hint: "Service, maintenance contracts, install and start-up",
    categories: ["HVAC", "Field Reports", "Field Admin"],
    tradeCategory: "HVAC",
  },
  {
    id: "plumbing",
    label: "Plumbing",
    hint: "Service calls, leak work, fixture and heater installs",
    categories: ["Plumbing", "Field Reports", "Field Admin"],
    tradeCategory: "Plumbing",
  },
  {
    id: "construction",
    label: "Construction & Contracting",
    hint: "General contracting, remodels, new build, site supervision",
    categories: ["Construction", "Field Reports", "Field Admin"],
    tradeCategory: "Construction",
  },
  {
    id: "roofing",
    label: "Roofing & Exterior",
    hint: "Roof surveys, replacements, siding and gutters",
    categories: ["Roofing & Exterior", "Field Reports", "Field Admin"],
    tradeCategory: "Roofing & Exterior",
  },
  {
    id: "restoration",
    label: "Restoration",
    hint: "Water, fire and mould mitigation, drying logs, scopes",
    categories: ["Restoration", "Insurance & Adjusting", "Field Reports"],
    tradeCategory: "Restoration",
  },
  {
    id: "cleaning",
    label: "Cleaning & Janitorial",
    hint: "Recurring contracts, turnovers, proof-of-work photos",
    categories: ["Cleaning", "Field Reports", "Field Admin"],
    tradeCategory: "Cleaning",
  },
  {
    id: "real_estate",
    label: "Real Estate & Property Management",
    hint: "Listings, move-in and move-out, condition reports",
    categories: ["Real Estate", "Field Reports", "Construction"],
    tradeCategory: "Real Estate",
  },
  {
    id: "insurance",
    label: "Insurance & Adjusting",
    hint: "Claims, scopes of damage, carrier-ready documentation",
    categories: ["Insurance & Adjusting", "Restoration", "Field Reports"],
    tradeCategory: "Insurance & Adjusting",
  },
  {
    id: "landscaping",
    label: "Landscaping & Grounds",
    hint: "Maintenance rounds, installs, seasonal work",
    categories: ["Landscaping", "Field Reports", "Field Admin"],
    tradeCategory: "Landscaping",
  },
  {
    id: "other",
    label: "Something else",
    hint: "Show me the whole library and let me choose",
    categories: ["Field Reports", "Field Admin"],
  },
] as const;

export const INDUSTRY_IDS: readonly string[] = INDUSTRIES.map((i) => i.id);

export function findIndustry(id: string | null | undefined): Industry | null {
  if (!id) return null;
  return INDUSTRIES.find((i) => i.id === id) ?? null;
}

export function industryLabel(id: string | null | undefined): string | null {
  return findIndustry(id)?.label ?? null;
}

/**
 * The one template heading that is this company's trade, or null.
 *
 * Every Templates tab badges this heading "Your trade", and the in-project
 * document picker opens it on arrival.
 *
 * Deliberately not "the first recommended category". For "Something else" that
 * would be "Field Reports", and calling that a company's trade is a claim we
 * cannot back - the honest answer there is null, and null is what every caller
 * degrades to the unpersonalised order on.
 */
export function tradeCategoryFor(id: string | null | undefined): string | null {
  return findIndustry(id)?.tradeCategory ?? null;
}

/**
 * The template categories a company should see first, given the trade they
 * picked plus any extra trades they also do.
 *
 * Trades lead, general paperwork follows. That ordering is the whole point and
 * it is easy to get subtly wrong: walking the primary industry's full list
 * first and appending the extras afterwards produces
 * `Plumbing, Field Reports, Field Admin, HVAC` for a plumber who also does
 * HVAC - their second trade below two generic headings they did not ask for.
 * Spotted on screen in Settings, where the recommendation is drawn as chips;
 * it had been wrong since the extras were added.
 *
 * So: the company's own trade, then every other trade they do, and only then
 * the general categories their industry falls back on. Deduplicated and
 * order-preserving, so no heading appears twice.
 */
export function recommendedCategories(
  industryId: string | null | undefined,
  extraTradeIds: readonly string[] = [],
): string[] {
  const primary = findIndustry(industryId);
  if (!primary) return [];

  const out: string[] = [];
  const push = (c: string | undefined) => {
    if (c && !out.includes(c)) out.push(c);
  };

  // The trades, most-theirs first.
  push(primary.tradeCategory);
  for (const id of extraTradeIds) push(findIndustry(id)?.tradeCategory);
  // Then whatever general paperwork their industry leans on. `categories`
  // repeats the trade heading at [0], which `push` drops.
  for (const c of primary.categories) push(c);
  return out;
}

/* -------------------------------------------------------------------------
 * The rest of the setup questions.
 *
 * Every one is a closed list rather than free text, because the point of
 * asking is to be able to count the answers: "how many roofers are on the
 * trial", "do the 20-plus crews care about a different thing than the solo
 * operators". Free text answers that question with a spreadsheet nobody reads.
 * ------------------------------------------------------------------------- */

export interface Choice {
  id: string;
  label: string;
  hint?: string;
}

/** Stored in `teams.team_size`. */
export const TEAM_SIZES: readonly Choice[] = [
  { id: "solo", label: "Just me", hint: "Owner-operator" },
  { id: "2-5", label: "2 to 5" },
  { id: "6-20", label: "6 to 20" },
  { id: "21-50", label: "21 to 50" },
  { id: "51+", label: "51 or more" },
] as const;

/** Stored in `teams.project_volume`. */
export const PROJECT_VOLUMES: readonly Choice[] = [
  { id: "under-5", label: "Under 5 a month" },
  { id: "5-20", label: "5 to 20 a month" },
  { id: "21-50", label: "21 to 50 a month" },
  { id: "51-200", label: "51 to 200 a month" },
  { id: "200+", label: "More than 200 a month" },
] as const;

/**
 * Stored in `teams.goals`, multi-select.
 *
 * Phrased as the problem, not the feature. "Proving what we did when a client
 * disputes it" is something an owner recognises about their own week; "photo
 * evidence workflows" is something only we say.
 */
export const COMPANY_GOALS: readonly Choice[] = [
  { id: "proof", label: "Proving what we did when someone disputes it" },
  { id: "speed", label: "Getting paperwork done before we leave site" },
  { id: "client_updates", label: "Keeping clients updated without phone calls" },
  { id: "consistency", label: "Every tech filing the same way" },
  { id: "claims", label: "Documentation that holds up for insurance claims" },
  { id: "compliance", label: "Safety and compliance records" },
  { id: "photos", label: "Finding old job photos when we need them" },
  { id: "invoicing", label: "Backing up invoices and change orders" },
] as const;

/** Stored in `teams.heard_from`. */
export const HEARD_FROM: readonly Choice[] = [
  { id: "search", label: "Google or another search" },
  { id: "social", label: "Social media" },
  { id: "referral", label: "Someone recommended it" },
  { id: "trade", label: "Trade show, association or supplier" },
  { id: "ads", label: "An ad" },
  { id: "switching", label: "Switching from another app" },
  { id: "other", label: "Something else" },
] as const;

const ids = (list: readonly Choice[]) => list.map((c) => c.id);

export const TEAM_SIZE_IDS = ids(TEAM_SIZES);
export const PROJECT_VOLUME_IDS = ids(PROJECT_VOLUMES);
export const COMPANY_GOAL_IDS = ids(COMPANY_GOALS);
export const HEARD_FROM_IDS = ids(HEARD_FROM);

export function choiceLabel(list: readonly Choice[], id: string | null | undefined): string | null {
  if (!id) return null;
  return list.find((c) => c.id === id)?.label ?? null;
}

/**
 * The business profile as it is stored on the team, and as every screen that
 * reads it should type it.
 *
 * Nullable throughout: a team created before the setup wizard existed has none
 * of it, and a team that skipped a step has some of it. There is no shape here
 * that means "invalid" - only "not answered yet".
 */
export interface BusinessProfile {
  industry: string | null;
  trades: string[];
  team_size: string | null;
  project_volume: string | null;
  goals: string[];
  heard_from: string | null;
  service_area: string | null;
  profile_completed_at: string | null;
}

/**
 * Whether a team has answered enough for the account to count as set up.
 *
 * Industry and team size are the two the whole feature turns on: the first
 * decides which templates lead, and the second is what tells us whether a
 * one-person shop and a fifty-crew contractor want different things. The rest
 * is worth having and not worth blocking on, so the wizard lets them through.
 */
export function isBusinessProfileComplete(p: Partial<BusinessProfile> | null | undefined): boolean {
  return !!p?.industry && !!p?.team_size;
}
