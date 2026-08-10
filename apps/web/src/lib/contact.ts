/**
 * Single source for every address and legal fact we publish to customers.
 *
 * The footer used to advertise `hello@sitepix.com` and the policy pages
 * `privacy@everbreeze.io` — neither domain is the product domain
 * (everbreezesitepix.com), and the API only ever sends from `EMAIL_FROM` on
 * that product domain. Rather than guess a mailbox that may bounce, these stay
 * as `[[...]]` placeholders until the owner confirms the real ones.
 *
 * `isPlaceholder` lets the UI render an unresolved value as inert text instead
 * of a `mailto:` link, so an un-filled placeholder is loudly visible in review
 * rather than shipping a dead link to a paying customer.
 */

export const SUPPORT_EMAIL = "[[SUPPORT_EMAIL]]";
export const PRIVACY_EMAIL = "[[PRIVACY_EMAIL]]";
export const LEGAL_EMAIL = "[[LEGAL_EMAIL]]";

/** Legal entity behind the Services — used by the Terms and Privacy pages. */
export const LEGAL_ENTITY = "[[LEGAL_ENTITY_NAME]]";
export const REGISTERED_ADDRESS = "[[REGISTERED_ADDRESS]]";
export const GOVERNING_LAW = "[[GOVERNING_LAW_JURISDICTION]]";

/**
 * Dates printed at the top of the legal pages. They live here, not in the page
 * files, so filling in this one file is genuinely enough to clear every
 * placeholder the site publishes. Set them to the day the pages go live.
 */
export const POLICY_LAST_UPDATED = "[[POLICY_LAST_UPDATED]]";
export const TERMS_EFFECTIVE_DATE = "[[TERMS_EFFECTIVE_DATE]]";

/** True while a constant above is still an unfilled `[[PLACEHOLDER]]`. */
export const isPlaceholder = (value: string) => value.startsWith("[[");

/** `mailto:` target, or null when the address has not been filled in yet. */
export const mailtoHref = (email: string, subject?: string) =>
  isPlaceholder(email)
    ? null
    : `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
