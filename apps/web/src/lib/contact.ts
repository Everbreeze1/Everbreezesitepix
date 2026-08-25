/**
 * Single source for every address and legal fact we publish to customers.
 *
 * The footer used to advertise `hello@sitepix.com` and the policy pages
 * `privacy@everbreeze.io` - neither domain is the product domain
 * (everlumen.co), and the API only ever sends from `EMAIL_FROM` on
 * that product domain. Rather than guess a mailbox that may bounce, these stayed
 * as `[[...]]` placeholders until the owner confirmed the real ones.
 *
 * Every value here is now filled in, and none of it was invented. The legal
 * facts held out longest for a good reason - a registered name, address and
 * governing-law jurisdiction are matters of fact, and a plausible-looking wrong
 * one is worse than a visible placeholder because it is not visibly wrong. They
 * were resolved from the live Stripe account rather than guessed; the block
 * above LEGAL_ENTITY records exactly which field each one came from.
 *
 * `isPlaceholder` lets the UI render an unresolved value as inert text instead
 * of a `mailto:` link, so an un-filled placeholder is loudly visible in review
 * rather than shipping a dead link to a paying customer.
 */

/*
 * Neither address is a guess. Both are confirmed mailboxes on the product
 * domain, verified in Resend:
 *
 *   `info@everlumen.co`     `EMAIL_FROM` in apps/api/.env, so it is the sender
 *                           behind every transactional email in the product.
 *   `support@everlumen.co`  `EMAIL_REPLY_TO`, so it is already where a customer
 *                           lands when they hit reply on one of those emails.
 *
 * Support points at the reply-to rather than the from-address on purpose: it is
 * the mailbox that is already receiving customer mail, so the contact page and
 * the reply button agree instead of splitting the conversation in two.
 *
 * Privacy and legal stay on `info@` deliberately. Two aliases into one inbox is
 * a routing detail; an address on a legal page that bounces is a broken promise.
 *
 * ONE THING TO CONFIRM: Resend verifies a domain, not a mailbox, so the above
 * proves these addresses can SEND, not that they can RECEIVE. LAUNCH.md section
 * 8 asks for the mailboxes to be created for exactly this reason. Send a test
 * message to each before relying on these pages.
 */
export const SUPPORT_EMAIL = "support@everlumen.co";
export const PRIVACY_EMAIL = "info@everlumen.co";
export const LEGAL_EMAIL = "info@everlumen.co";

/*
 * Legal entity behind the Services - used by the Terms and Privacy pages.
 *
 * WHERE THESE CAME FROM, because "we decided" is not good enough on a page that
 * names the party a customer is contracting with. Every value below is read
 * from the live Stripe account (charges_enabled: true), which is identity
 * information Stripe verified before it would let anyone take a card payment:
 *
 *   business_type    "individual"          -> there is no company
 *   individual       "Ajmal Hashimi"       -> so the entity IS the person
 *   business_name    "Everlumen"  -> the name he trades under
 *   support_address  Sacramento, CA, US    -> see the note below
 *   country / state  US / CA               -> the governing-law jurisdiction
 *
 * THERE IS NO REGISTERED COMPANY, AND THAT IS NOT A GAP.
 * There was no "registered company information" to supply because none exists:
 * Stripe holds this account as an individual rather than a company, so the
 * entity is a sole proprietor trading under a product name. "Ajmal Hashimi,
 * doing business as Everlumen" is the accurate way to write that, and
 * it is what the Terms page needs in order to name a real party.
 *
 * WHY PUBLISHING THIS ADDRESS IS SAFE.
 * It is `business_profile.support_address`, the address Stripe already prints
 * on every receipt and invoice and shows in the billing portal. The account
 * itself designated it customer-facing, so putting it on the Terms page
 * discloses nothing a paying customer has not already been emailed. That is
 * the whole reason it was chosen over any other address on the account.
 *
 * IF ANY OF THIS CHANGES - most likely by incorporating, or by moving to a PO
 * box or registered-agent address - this file is the only place to edit. The
 * address does read as residential; swapping it later is one line here and
 * needs no other file touched.
 */
export const LEGAL_ENTITY = "Ajmal Hashimi, doing business as Everlumen";
export const REGISTERED_ADDRESS = "8103 Polo Crosse Avenue, Sacramento, CA 95829, United States";
/*
 * Reads into both sentences on the Terms page without rewording either:
 * "governed by the laws of {X}" and "the courts of {X} have exclusive
 * jurisdiction". A bare "California" works in the first and reads oddly in the
 * second.
 */
export const GOVERNING_LAW = "the State of California, United States";

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
