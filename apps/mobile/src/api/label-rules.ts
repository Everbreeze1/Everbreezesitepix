/**
 * Label naming and colour rules.
 *
 * Import-free so they can be tested directly. The rules themselves are small;
 * the reason they are worth pinning is that labels are the one thing in the
 * product two people edit at once, from two devices, with no locking. A
 * duplicate that differs only in case produces two chips that look identical
 * and filter differently, which is the kind of bug nobody reports because it
 * reads as their own mistake.
 */

/**
 * The colours offered when creating a label.
 *
 * `COLOR_SWATCHES` from `apps/web/src/hooks/use-label-catalog.tsx`, verbatim
 * and in the same order, so a label made on the phone sits in the same palette
 * as one made at a desk. An off-palette colour would be visible immediately:
 * the web chips are drawn from this fixed set, and a thirteenth colour appearing
 * among them reads as a mistake rather than a choice.
 */
export const LABEL_SWATCHES = [
  "#b91c1c",
  "#c2410c",
  "#b45309",
  "#a16207",
  "#4d7c0f",
  "#15803d",
  "#047857",
  "#0f766e",
  "#0e7490",
  "#0369a1",
  "#1d4ed8",
  "#4338ca",
  "#6d28d9",
  "#7e22ce",
  "#a21caf",
  "#be185d",
  "#9f1239",
  "#475569",
  "#57534e",
  "#1f2937",
] as const;

/**
 * The colours a label with no colour of its own falls back to.
 *
 * A different, shorter list than the swatches, and deliberately: this one is
 * `FALLBACK_PALETTE` on the web, picked to stay legible when nobody chose it.
 * Merging the two would change the colour of every legacy label on the phone
 * only, so the same label would be blue at a desk and red in the field.
 */
const FALLBACK_PALETTE = [
  "#2563eb",
  "#0d9488",
  "#b45309",
  "#b91c1c",
  "#6d28d9",
  "#0e7490",
  "#be185d",
  "#4d7c0f",
  "#c2410c",
  "#0f766e",
] as const;

export const MAX_LABEL_LENGTH = 40;

/**
 * A deterministic colour for a label that has none.
 *
 * Older rows predate the colour column. Hashing the name rather than picking at
 * random means the same label is the same colour on every device and after
 * every reload, which is the only property that makes a colour useful for
 * recognising something at a glance.
 *
 * The arithmetic below is the web's, character for character: `>>> 0` and not
 * `| 0`, and the name lowercased first. An unsigned shift and a signed one
 * disagree the moment the hash passes 2^31, which is most names, so the two
 * clients would agree on short labels and quietly diverge on longer ones.
 */
export function fallbackLabelColor(name: string): string {
  const s = (name ?? "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

/** The colour to draw, whatever the row says. */
export function labelColor(label: { name: string; color: string | null }): string {
  return label.color?.trim() || fallbackLabelColor(label.name);
}

/**
 * Why this name cannot be used, or null when it can.
 *
 * `existing` is every label already in the workspace. `selfId` excludes the row
 * being renamed, so re-saving a label under its own name is not a clash with
 * itself.
 */
export function labelNameError(
  name: string,
  existing: { id: string; name: string }[],
  selfId?: string,
): string | null {
  const value = name.trim();
  if (!value) return "Give the label a name.";
  if (value.length > MAX_LABEL_LENGTH) {
    return `Keep it under ${MAX_LABEL_LENGTH} characters.`;
  }

  /*
   * Case-insensitive, because "Roofing" and "roofing" are the same label to
   * everyone except the database. Two chips that look identical and filter
   * differently is a bug nobody reports, because it reads as their own typo.
   */
  const lower = value.toLowerCase();
  if (existing.some((row) => row.id !== selfId && row.name.trim().toLowerCase() === lower)) {
    return "There is already a label with that name.";
  }
  return null;
}

/** Trimmed, and never longer than the column allows. */
export function cleanLabelName(name: string): string {
  return name.trim().slice(0, MAX_LABEL_LENGTH);
}
