import type { StoredTeamRole } from "@everlumen/shared/team-permissions";

/**
 * The rules around closing an account.
 *
 * Import-free apart from the shared role helper, so the one case that must not
 * be got wrong is testable without deleting anybody.
 *
 * The server enforces all of this too, reading the membership fresh rather than
 * trusting the client. What is here decides whether the button is offered, and
 * says why when it is not: a disabled Delete with no explanation, on the screen
 * where somebody has decided to leave, is the worst possible place for a
 * mystery.
 */

/**
 * Why the account cannot be closed, or null.
 *
 * Mirrors `accountDeletionBlockedReason` in
 * `apps/api/src/domains/account/delete-account.ts`. Kept as its own copy rather
 * than shared, because the two answer slightly different questions: the server
 * refuses, this decides what to draw. If they ever diverge it should be visible
 * in a diff.
 *
 * **The owner case is a product gap, not a rule.** Ownership cannot be
 * transferred anywhere in this product: `updateMemberRole` accepts admin,
 * manager, standard and restricted, and there is no transfer or delete-team op.
 * So an owner with colleagues can neither leave, nor hand the workspace on, nor
 * take it with them. Deleting them anyway would orphan a workspace people are
 * still working in.
 */
export function deletionBlockedReason(
  role: StoredTeamRole | string | null,
  otherMemberCount: number,
): string | null {
  /*
   * Compared literally rather than through `normaliseRole`, which maps anything
   * unrecognised to `standard`. That is the right default for a permission
   * check and the wrong one here: this decides whether to *allow* a deletion,
   * so an unrecognised role must not be quietly treated as safe. Only the exact
   * string "owner" is an owner, and only an owner is blocked.
   */
  if (role === "owner" && otherMemberCount > 0) {
    return "You own a workspace that other people are still working in, and ownership cannot be transferred yet. Contact support and we will move it before closing your account.";
  }
  return null;
}

/**
 * Whether the typed address matches.
 *
 * Case-insensitive and trimmed, matching the server. A checkbox is not a
 * confirmation for something irreversible: typing the address is the difference
 * between deciding and mis-tapping.
 */
export function confirmationMatches(typed: string, accountEmail: string | null): boolean {
  const a = typed.trim().toLowerCase();
  const b = (accountEmail ?? "").trim().toLowerCase();
  return a.length > 0 && a === b;
}

export function confirmationError(typed: string, accountEmail: string | null): string | null {
  if (!typed.trim()) return "Type your email address to confirm.";
  if (!confirmationMatches(typed, accountEmail)) {
    return "That does not match the address on this account.";
  }
  return null;
}

/**
 * What goes, in the words of somebody deciding whether to do this.
 *
 * Listed rather than summarised as "your data", because the question a person
 * actually has is whether the photographs go with it. They do: every table with
 * a cascading key to `auth.users` is deleted, and the photos are among them.
 */
export const WHAT_IS_DELETED = [
  "Your login, and your name and email",
  "Projects you created, with their photos and videos",
  "Checklists, tasks, workflows and site logs you wrote",
  "Reports and portfolio pages you made, and any public links to them",
];

/**
 * What does not go, which is the half people are surprised by.
 *
 * A teammate's photograph on a shared project is theirs, not yours, and it
 * stays. Saying so prevents both the wrong expectation and the support ticket
 * that follows it.
 */
export const WHAT_REMAINS = [
  "Work your teammates created, including on projects you shared",
  "Anything already sent to a client through a public link they saved",
];
