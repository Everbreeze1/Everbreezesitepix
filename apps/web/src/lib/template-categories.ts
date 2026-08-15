import {
  Briefcase,
  Building2,
  ClipboardList,
  Droplets,
  FileText,
  HardHat,
  ShieldCheck,
  Sparkles,
  Waves,
  Wind,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The trade a document template belongs to.
 *
 * Two screens show the same library and both have to sort it the same way: the
 * in-project picker (ChoosePageTemplateDialog) and the Templates page that
 * authors it (DocumentTemplatesManager). They each carried their own copy of
 * this list for a while, which is how the Templates page ended up as one flat
 * grid of thirty near-identical cards while the picker was already grouped.
 *
 * The strings must match the `category` seeded in
 * supabase/migrations/*_document_templates_*_seed.sql, which
 * tests/document-template-library.test.ts checks against this file.
 */
export const CATEGORY_ORDER = [
  "Electrical",
  "HVAC",
  "Plumbing",
  "Roofing & Exterior",
  "Restoration",
  "Cleaning",
  "Field Reports",
  "Field Admin",
  "Insurance & Adjusting",
];

/** Section heading for the picker's "templates this team wrote" group. */
export const TEAM_SECTION = "Your Company";

/**
 * Where a template with no trade on it lands.
 *
 * Every built-in is seeded with a category, so this only ever holds a team's
 * own work: anything created before the trade picker existed, or created since
 * and deliberately left general.
 */
export const GENERAL_CATEGORY = "General";

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  [TEAM_SECTION]: Building2,
  [GENERAL_CATEGORY]: FileText,
  Electrical: Zap,
  HVAC: Wind,
  Plumbing: Droplets,
  "Roofing & Exterior": HardHat,
  Restoration: Waves,
  Cleaning: Sparkles,
  "Field Reports": ClipboardList,
  "Field Admin": Briefcase,
  "Insurance & Adjusting": ShieldCheck,
};

export function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICON[category] ?? FileText;
}

/**
 * Sort key for a category heading. An unknown one sorts after every listed
 * trade rather than vanishing, so a category seeded later degrades to "in the
 * right place-ish", never to "missing".
 */
export function categoryRank(category: string): number {
  if (category === GENERAL_CATEGORY) return -1;
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}
