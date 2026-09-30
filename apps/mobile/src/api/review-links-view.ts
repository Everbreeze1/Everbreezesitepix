/**
 * The review-link rules, free of React and the network so they can be tested.
 * Mirrors the web's `ReviewLinksSection` and the op's schema: at most ten
 * links, each an http(s) URL of up to 500 characters, with an optional label of
 * up to 60 for a custom site.
 */

export type ReviewPlatform = "google" | "nicejob" | "custom";

export type ReviewLink = {
  id: string;
  platform: ReviewPlatform;
  url: string;
  label: string | null;
  position: number;
};

export type ReviewLinkInput = { platform: ReviewPlatform; url: string; label: string | null };

/** One editable row on the screen. */
export type ReviewLinkDraft = { platform: ReviewPlatform; url: string; label: string };

export const REVIEW_PLATFORMS: readonly { id: ReviewPlatform; label: string }[] = [
  { id: "google", label: "Google Business Profile" },
  { id: "nicejob", label: "NiceJob" },
  { id: "custom", label: "Custom link" },
];

export const MAX_REVIEW_LINKS = 10;

export function draftsFrom(links: readonly ReviewLink[]): ReviewLinkDraft[] {
  return links.map((l) => ({ platform: l.platform, url: l.url, label: l.label ?? "" }));
}

/** The row "Add link" appends, as on the web. */
export function blankDraft(): ReviewLinkDraft {
  return { platform: "google", url: "", label: "" };
}

/** Why a row would be refused by the server, or null. Empty rows are dropped, not refused. */
export function reviewLinkProblem(draft: ReviewLinkDraft): string | null {
  const url = draft.url.trim();
  if (!url) return null;
  if (url.length > 500) return "That link is too long.";
  if (!/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(url)) return "Start the link with https://";
  if (draft.label.trim().length > 60) return "Keep the label under 60 characters.";
  return null;
}

/** What is saved: blank rows dropped, trimmed, labels only where they say something. */
export function cleanedLinks(drafts: readonly ReviewLinkDraft[]): ReviewLinkInput[] {
  return drafts
    .filter((d) => d.url.trim())
    .slice(0, MAX_REVIEW_LINKS)
    .map((d) => ({ platform: d.platform, url: d.url.trim(), label: d.label.trim() || null }));
}

/** Whether the rows differ from what is stored, so Save is only live when it would do something. */
export function reviewLinksChanged(
  stored: readonly ReviewLink[],
  drafts: readonly ReviewLinkDraft[],
): boolean {
  const a = cleanedLinks(draftsFrom(stored));
  const b = cleanedLinks(drafts);
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * The web's `isTeam`: an active Team plan, with internal workspaces counting
 * as Team. Review links are a Team feature.
 */
export function reviewLinksAllowed(
  team: { plan?: string | null; isActive?: boolean; isInternal?: boolean } | null | undefined,
): boolean {
  if (!team) return false;
  const tier = team.isInternal ? "team" : team.plan;
  return Boolean(team.isActive) && tier === "team";
}

/**
 * The line shown when review links are not on. The owner is told which plan
 * turns them on; anyone else is never told what the workspace pays for.
 */
export function reviewLinksLockedNote(isOwner: boolean): string {
  return isOwner
    ? "Upgrade to Team to let customers leave you reviews from a shared report."
    : "Review links are not switched on for this workspace. Ask the account owner.";
}
