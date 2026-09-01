/**
 * What to put on a row that names a person, when nobody has typed a name.
 *
 * Both clients fall back to the email address, which is right in substance and
 * wrong in shape: a row title is one line at heading weight, and an address is
 * usually longer than one. On the team roster the workspace owner rendered as
 * "marklagura223@gmail" above ".com" - broken across the domain, which reads as
 * a rendering fault rather than as a person.
 *
 * The handle is the half worth showing large. The full address still belongs on
 * the row, underneath, where it has the width for it.
 */

/**
 * The part before the `@`, or null when there is nothing usable.
 *
 * Deliberately not validation. Anything already stored is displayed as best it
 * can be: a value with no `@` comes back whole rather than being rejected,
 * because refusing to draw a row is worse than drawing an odd one.
 */
export function emailHandle(email: string | null | undefined): string | null {
  const value = email?.trim();
  if (!value) return null;
  const at = value.indexOf("@");
  // `at > 0`, not `>= 0`: an address beginning with "@" has no local part, and
  // slicing it would produce an empty title.
  const local = at > 0 ? value.slice(0, at) : value;
  return local.trim() || null;
}

/**
 * The name to show, given a typed name and an address.
 *
 * The order is the order somebody would answer the question: what they called
 * themselves, then what we can infer, then an honest placeholder rather than an
 * identifier. A roster row reading "8f3c1a2e-..." is the "unfriendly info"
 * complaint in its purest form.
 */
export function personName(
  fullName: string | null | undefined,
  email: string | null | undefined,
  fallback = "Pending member",
): string {
  const name = fullName?.trim();
  if (name) return name;
  return emailHandle(email) ?? fallback;
}
