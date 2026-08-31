/**
 * Links handed out for one photograph.
 *
 * Import-free so the one rule that matters can be tested: whether a given link
 * is still live. Everything else here is wording around that answer.
 *
 * The reason it matters is that a share link is a jobsite photograph sitting on
 * the open internet with no login in front of it. The phone could mint them and
 * never see them again, and each tap of Share mints a **fresh** token rather
 * than reusing one, so three taps leave three live URLs. Being able to count
 * them and withdraw one is not a nicety.
 */

export type PhotoShareRow = {
  id: string;
  token: string;
  expires_at: string | null;
  allow_download: boolean;
  created_at: string;
  revoked_at: string | null;
};

/**
 * Whether this link still opens.
 *
 * `revoked` beats `expired` when a link is both: revoking is something a person
 * did and expiry is something that happened, and the one somebody acted on is
 * the one worth reporting back to them.
 */
export type ShareState = "live" | "expired" | "revoked";

export function shareState(share: PhotoShareRow, now: Date = new Date()): ShareState {
  if (share.revoked_at) return "revoked";
  if (!share.expires_at) return "live";
  const expires = new Date(share.expires_at);
  // An unparseable date is treated as live rather than expired, because the
  // safe direction here is to keep offering the revoke button. Calling a
  // working link "expired" would hide the control that turns it off.
  if (Number.isNaN(expires.getTime())) return "live";
  return expires.getTime() <= now.getTime() ? "expired" : "live";
}

/** Only the links that still open. What a revoke queue is actually about. */
export function liveShares(shares: PhotoShareRow[], now: Date = new Date()): PhotoShareRow[] {
  return shares.filter((share) => shareState(share, now) === "live");
}

/**
 * How long a live link has left, in words.
 *
 * Deliberately blunt about the case that should worry somebody: a link with no
 * expiry is permanent, and "Never expires" is the wording that makes that land.
 */
export function expiryLabel(share: PhotoShareRow, now: Date = new Date()): string {
  const state = shareState(share, now);
  if (state === "revoked") return "Withdrawn";
  if (state === "expired") return "Expired";
  if (!share.expires_at) return "Never expires";

  const left = new Date(share.expires_at).getTime() - now.getTime();
  const hours = Math.floor(left / 3_600_000);
  if (hours < 1) return "Expires within the hour";
  if (hours < 24) return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The line on the photo saying how exposed it is.
 *
 * Counts only live links, because an expired one is not a way in. Silence when
 * there are none: a permanent "0 links" on every photograph is noise, and this
 * line exists to be noticed on the photographs where it is not zero.
 */
export function exposureSummary(shares: PhotoShareRow[], now: Date = new Date()): string | null {
  const live = liveShares(shares, now);
  if (live.length === 0) return null;
  const permanent = live.filter((share) => !share.expires_at).length;
  const noun = live.length === 1 ? "link" : "links";
  if (permanent === 0) return `${live.length} live ${noun}`;
  if (permanent === live.length) {
    return `${live.length} live ${noun}, ${live.length === 1 ? "no expiry" : "none expiring"}`;
  }
  return `${live.length} live ${noun}, ${permanent} with no expiry`;
}

/**
 * Newest first, live before dead.
 *
 * The link somebody just made is the one they are looking for, and a withdrawn
 * link is history rather than something to act on.
 */
export function sortedShares(shares: PhotoShareRow[], now: Date = new Date()): PhotoShareRow[] {
  const rank = (share: PhotoShareRow) => (shareState(share, now) === "live" ? 0 : 1);
  return [...shares].sort((a, b) => {
    const byState = rank(a) - rank(b);
    if (byState !== 0) return byState;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

/** What the confirmation says before a link is withdrawn. */
export function revokeWarning(share: PhotoShareRow): string {
  return share.allow_download
    ? "Anyone holding this link loses access. If they have already saved the photo, that copy stays with them."
    : "Anyone holding this link loses access.";
}
