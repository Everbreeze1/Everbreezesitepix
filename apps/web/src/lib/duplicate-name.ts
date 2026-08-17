/**
 * The name a duplicated template should take, given the names already in use.
 *
 * "Duplicate" (and "Duplicate to edit" on a built-in) used to append " (copy)"
 * unconditionally. Duplicating a duplicate therefore produced
 * "HVAC Service Call Report (copy) (copy)" - a real row on the live database,
 * sitting in the same grid as the "(copy)" it came from and the built-in both
 * came from before that. Three cards, one document, told apart only by how many
 * times the word "copy" appears.
 *
 * Numbering from a stripped base keeps the chain flat and readable instead:
 *
 *   Site Report            ->  Site Report (copy)
 *   Site Report (copy)     ->  Site Report (copy 2)
 *   Site Report (copy 2)   ->  Site Report (copy 3)
 *
 * Kept out of the component so it can be tested directly - the duplication the
 * client reported is exactly the kind of thing that only shows up on the third
 * click, which is not a click anyone makes while checking their own work.
 */

/** A trailing " (copy)" or " (copy 4)", with or without the surrounding space. */
const COPY_SUFFIX = /\s*\(copy(?:\s+\d+)?\)\s*$/i;

/**
 * The name with every copy marker stripped.
 *
 * Loops rather than replacing once, so a row that already carries
 * "(copy) (copy)" collapses to the document's real name rather than to
 * "... (copy)" - otherwise the rows written before this fix would keep growing
 * their suffix chain forever.
 */
export function baseTemplateName(name: string): string {
  let out = name.trim();
  while (COPY_SUFFIX.test(out)) out = out.replace(COPY_SUFFIX, "").trim();
  return out;
}

/**
 * `taken` is every name already in the library, archived rows included: a name
 * that is only free because the card is hidden is not free, it is a collision
 * the user cannot see.
 */
export function nextCopyName(name: string, taken: Iterable<string>): string {
  const base = baseTemplateName(name) || "Untitled document";
  const used = new Set<string>();
  for (const t of taken) used.add(t.trim().toLowerCase());

  let candidate = `${base} (copy)`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (copy ${n})`;
  return candidate;
}
