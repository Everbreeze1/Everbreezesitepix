/**
 * Single source for every address and legal fact we publish to customers.
 *
 * The footer used to advertise `hello@sitepix.com` and the policy pages
 * `privacy@everbreeze.io` - neither domain is the product domain
 * (everbreezesitepix.com), and the API only ever sends from `EMAIL_FROM` on
 * that product domain. Rather than guess a mailbox that may bounce, these stayed
 * as `[[...]]` placeholders until the owner confirmed the real ones.
 *
 * The addresses and the dates are now filled in. The three legal facts below
 * are NOT, deliberately: a company's registered name, its registered address
 * and its governing-law jurisdiction are matters of fact with legal weight, and
 * the Terms page states them as the entity a customer is contracting with.
 * Inventing a plausible-looking one is worse than showing a placeholder,
 * because a wrong one is not visibly wrong. They need one line from the owner.
 *
 * `isPlaceholder` lets the UI render an unresolved value as inert text instead
 * of a `mailto:` link, so an un-filled placeholder is loudly visible in review
 * rather than shipping a dead link to a paying customer.
 */

/*
 * All three resolve to the same mailbox, which is the honest shape for a team
 * this size: three aliases that all land in one inbox is a routing detail, but
 * three addresses where two bounce is a broken promise on a legal page.
 *
 * `info@everbreezesitepix.com` is not a guess. It is `EMAIL_FROM` in
 * apps/api/.env - the address every transactional email in the product is
 * already sent from, on the product's own domain, verified in Resend. Customers
 * hitting reply are already writing to it.
 *
 * ONE THING TO CONFIRM: that is proof the address can SEND, not proof it can
 * RECEIVE. LAUNCH.md section 8 asks for the mailboxes to be created for exactly
 * this reason. Send a test message to it before relying on these pages.
 */
export const SUPPORT_EMAIL = "info@everbreezesitepix.com";
export const PRIVACY_EMAIL = "info@everbreezesitepix.com";
export const LEGAL_EMAIL = "info@everbreezesitepix.com";

/** Legal entity behind the Services - used by the Terms and Privacy pages. */
export const LEGAL_ENTITY = "[[LEGAL_ENTITY_NAME]]";
export const REGISTERED_ADDRESS = "[[REGISTERED_ADDRESS]]";
export const GOVERNING_LAW = "[[GOVERNING_LAW_JURISDICTION]]";

/**
 * Dates printed at the top of the legal pages. They live here, not in the page
 * files, so filling in this one file is genuinely enough to clear every
 * placeholder the site publishes. Set them to the day the pages go live.
 */
export const POLICY_LAST_UPDATED = "August 18, 2026";
export const TERMS_EFFECTIVE_DATE = "August 18, 2026";

/** True while a constant above is still an unfilled `[[PLACEHOLDER]]`. */
export const isPlaceholder = (value: string) => value.startsWith("[[");

/** `mailto:` target, or null when the address has not been filled in yet. */
export const mailtoHref = (email: string, subject?: string) =>
  isPlaceholder(email)
    ? null
    : `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
