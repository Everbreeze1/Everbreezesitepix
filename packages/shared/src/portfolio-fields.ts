/**
 * Formatting and validation for the portfolio's freeform fields.
 *
 * Every field this file touches is typed by a contractor and then rendered on a
 * public page, and each one had the same failure mode: whatever went in came
 * back out verbatim, and the damage only showed up on the live site.
 *
 *   - "acmeroofing.com" in the CTA link became `href="acmeroofing.com"`, which
 *     a browser resolves against the current page. The button looked fine and
 *     went nowhere.
 *   - A service type auto-filled from a project tag arrived as "led-lighting"
 *     and was printed as a badge, hyphen and all, on the grid, the project
 *     page, the carousel and the builder's own list.
 *   - Service areas typed twice ("Sacramento" once, "Sacramento, CA" the next
 *     week) both shipped, so the footer listed the same town twice.
 *   - The generated card summary carried the job's street address, which on a
 *     residential job is a customer's home address on a public web page.
 *
 * These are pure functions on purpose: the same rules have to hold on the way
 * in (the API's write path), on the way out (the public read path, for rows
 * written before any of this existed) and in the browser, where the field can
 * say what it will do before the user leaves it.
 */

/** Collapses whitespace and trims. Every helper starts here. */
function collapse(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* Service types                                                       */
/* ------------------------------------------------------------------ */

/**
 * Trade shorthand that reads wrong in Title Case. Deliberately short: this is
 * a list of things people would notice, not an attempt at a trade dictionary.
 */
const ACRONYMS = new Set([
  "led",
  "hvac",
  "pvc",
  "tpo",
  "epdm",
  "gfci",
  "hoa",
  "adu",
  "ada",
  "cctv",
  "diy",
  "usb",
  "ev",
]);

/**
 * Turns a stored service type into something worth printing on a badge.
 *
 * Only reformats values that carry no capital letters at all. That single rule
 * is what keeps it safe: a slug ("led-lighting") and a hurried lowercase entry
 * ("roof replacement") both get fixed, while anything a human has already
 * styled ("LED Lighting", "Tear-off & re-roof", "McGraw Method") is returned
 * untouched rather than being re-cased into something worse.
 *
 * Hyphens and underscores become spaces in the values it does reformat. That
 * is the point for "led-lighting"; the cost is that an all-lowercase
 * "tear-off" reads as "Tear Off". Typing one capital anywhere opts out.
 */
export function humanizeServiceType(raw: string | null | undefined): string {
  const text = collapse(raw);
  if (!text) return "";
  if (/[A-Z]/.test(text)) return text;

  return text
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => {
      if (ACRONYMS.has(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Outbound links                                                      */
/* ------------------------------------------------------------------ */

/**
 * Makes a typed link safe to put in an `href`, or refuses it.
 *
 * Returns null for anything that cannot become a working http(s) link, which
 * is the answer both callers need: the form can say "that will not work" while
 * the field still has focus, and the API can refuse rather than storing a
 * button that goes nowhere.
 *
 * A missing scheme is the common case and is assumed to be https, since that is
 * what the user meant by "acmeroofing.com". Other schemes are rejected outright
 * rather than passed through: `javascript:` in a field that ends up in an
 * `href` is not a formatting problem.
 */
export function normalizeExternalUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  // A space means prose ("call us for a quote"), not a link.
  if (/\s/.test(text)) return null;
  if (/^(mailto:|tel:)/i.test(text)) return text;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) return null;
  const candidate = hasScheme ? text : `https://${text.replace(/^\/+/, "")}`;

  try {
    const url = new URL(candidate);
    const host = url.hostname;
    // Needs a dot and a real-looking suffix. "https://roofing" resolves for
    // nobody outside an office LAN, and a contractor never meant to type it.
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(host)) return null;
    // Returns the candidate rather than `url.toString()`, which appends a
    // trailing slash and re-encodes: the field should still show what was
    // typed, plus the scheme it was missing.
    return candidate;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Service areas                                                       */
/* ------------------------------------------------------------------ */

/**
 * The town, without the qualifier: "Sacramento, CA" and "Sacramento" share a
 * key.
 *
 * A shared key is a question, not a verdict - "Springfield, IL" and
 * "Springfield, MO" share one too. What to do about it is mergeServiceArea's
 * decision, which is also why this never runs as a silent dedupe on the server.
 */
export function serviceAreaKey(tag: string): string {
  return collapse(tag.split(",")[0])
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Adds a town to the list, folding it into a near-duplicate if there is one.
 *
 * The near-duplicate case is the whole reason this exists: a list holding both
 * "Sacramento" and "Sacramento, CA" prints the same town twice in the footer
 * and offers it twice as a filter. When the two differ only in how specific
 * they are, the qualified one wins.
 */
export function mergeServiceArea(list: string[], incoming: string): string[] {
  const clean = collapse(incoming);
  if (!clean) return list;
  if (list.some((v) => v.toLowerCase() === clean.toLowerCase())) return list;

  const key = serviceAreaKey(clean);
  if (!key) return list;

  const at = list.findIndex((v) => serviceAreaKey(v) === key);
  if (at === -1) return [...list, clean];

  const existing = list[at];
  const incomingIsQualified = clean.includes(",");
  const existingIsQualified = existing.includes(",");

  // Two towns of the same name, each naming its own state. Not a duplicate:
  // Springfield IL and Springfield MO are a day's drive apart.
  if (incomingIsQualified && existingIsQualified) return [...list, clean];

  // Same town said two ways. The one that names a state wins.
  if (incomingIsQualified) {
    const next = [...list];
    next[at] = clean;
    return next;
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* Street addresses in public copy                                     */
/* ------------------------------------------------------------------ */

/**
 * Street types, US and UK both.
 *
 * The UK half is not optional: the first real showcase this was tested against
 * was "20 Charlcote Crescent, Crewe, England", and a list that stops at
 * Street/Avenue/Road quietly passes exactly the addresses it was written to
 * catch. Words that are ordinary English on their own - park, green, hill,
 * view, bank - are left out even though they name real streets, because the
 * cost of a warning nobody believes is higher than the cost of missing one.
 */
const STREET_WORD =
  /\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|pl|place|ter|terrace|cir|circle|hwy|highway|pkwy|parkway|trl|trail|loop|row|apt|unit|ste|suite|cres|crescent|close|gardens|gdns|grove|mews|walk|rise|parade|square|quay|wharf|avenue|croft)\b\.?/i;

/** A house number followed by at least one more word. */
const HOUSE_NUMBER = /(^|[\s,-])\d{1,6}[a-z]?\s+\S/i;

/**
 * Whether a line of public copy looks like it names a street address.
 *
 * Both halves have to match - a house number and a street word - because
 * either alone is ordinary copy. "Full tear-off on a 1960s ranch" has the
 * number; "Oak Street Reroof" has the word; neither is an address, and
 * flagging either would train people to ignore the warning.
 */
export function looksLikeStreetAddress(text: string | null | undefined): boolean {
  const value = collapse(text);
  if (!value) return false;
  return HOUSE_NUMBER.test(value) && STREET_WORD.test(value);
}

/**
 * Drops the street from a line while keeping the rest of it.
 *
 * Works comma part by comma part, so "Oak Street Reroof - 1200 J St,
 * Sacramento, CA" keeps the job name and the town and loses only the number
 * and street. One-way on purpose: the showcase row has no street column to
 * restore from, and a privacy control that can be un-done by a stray click is
 * not much of one.
 */
export function withoutStreetAddress(text: string | null | undefined): string {
  const value = collapse(text);
  if (!value) return "";

  const kept: string[] = [];
  for (const part of value.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    if (!looksLikeStreetAddress(piece)) {
      kept.push(piece);
      continue;
    }
    // Keep whatever came before the house number: on a generated summary that
    // is the project's own name.
    const head = piece.replace(/(^|[\s,-])\d{1,6}[a-z]?\s+\S.*$/i, "$1");
    const trimmed = head.replace(/[\s-]+$/, "").trim();
    if (trimmed) kept.push(trimmed);
  }
  return kept.join(", ");
}
