/*
 * The long dashes this project does not write, folded to a plain hyphen.
 *
 * CLAUDE.md bans them from every tracked file and `tests/no-em-dash.test.ts`
 * enforces that, but a repo-wide grep cannot reach text a language model wrote
 * at runtime. The Auto Report asks an LLM for a title, a subtitle and section
 * prose, and models reach for a long dash constantly, so titles came back
 * carrying one and were stored as-is. Every screen that lists reports then
 * showed the character the product's own style rule forbids.
 *
 * The four PDF sanitisers already fold these, but only while drawing a page:
 * Helvetica's WinAnsi encoding cannot represent them at all, so that pass is
 * about not breaking the renderer, and it never touches what is in the
 * database. This one runs at the boundary where model output is accepted, so
 * the stored value is clean everywhere it is later read.
 *
 * Built from escapes rather than literal characters. That is the one exception
 * CLAUDE.md allows, and it is how the PDF sanitisers spell it too.
 */
const MACHINE_DASHES = new RegExp("[\u2013\u2014\u2015\u2E3A\u2E3B]", "g");

/**
 * Fold en dash, em dash, horizontal bar and the two long bars to "-".
 *
 * Surrounding spacing is left exactly as written, so "north wall <dash>
 * cracked" yields "north wall - cracked", the form the repo-wide sweep
 * settled on.
 */
export function normalizeDashes(input: string): string {
  return input.replace(MACHINE_DASHES, "-");
}

/** `normalizeDashes` for a value that may be absent, trimmed on the way out. */
export function normalizeDashesTrimmed(input: unknown): string {
  return normalizeDashes(String(input ?? "")).trim();
}
