/**
 * Public share URLs, free of imports so they can be tested directly.
 *
 * Every path here has a matching route under `apps/web/src/routes/share.*`, and
 * a link this app builds wrongly is a link a customer opens and finds broken.
 * That is the whole reason these live in a tested module rather than being
 * assembled inline at four call sites.
 */

/** The kinds of record the phone can hand to someone outside the workspace. */
export type ShareKind =
  | "photos"
  | "projects"
  | "checklists"
  | "workflows"
  | "walkthroughs"
  | "reports"
  /*
   * The Portfolio's public pages. The kind keeps the old `showcases` name
   * because the route does: `apps/web/src/routes/share.showcases.$token.tsx`.
   * That is an identifier, and identifiers may say showcase. Nothing a person
   * reads may: the site is the "Portfolio" and each page is a "project".
   */
  | "showcases";

/**
 * Route prefix per kind, matching `apps/web/src/routes/share.<kind>.$token.tsx`.
 *
 * Plural, and not derived from a singular by appending an "s": "checklists"
 * happens to work that way and "photos" does not survive the same rule applied
 * to "photo" once someone adds an irregular one.
 */
const SHARE_PATHS: Record<ShareKind, string> = {
  photos: "/share/photos",
  projects: "/share/projects",
  checklists: "/share/checklists",
  workflows: "/share/workflows",
  walkthroughs: "/share/walkthroughs",
  reports: "/share/reports",
  showcases: "/share/showcases",
};

/**
 * Build a public link.
 *
 * Returns null rather than a half-formed URL when the origin or token is
 * missing. A caller that got `"/share/photos/undefined"` back would happily put
 * it in a text message, and the person receiving it would see a 404 with no way
 * to tell it was never real.
 *
 * The origin is trimmed of a trailing slash because `EXPO_PUBLIC_API_BASE_URL`
 * is written both ways in practice and `https://everlumen.co//share/photos/x`
 * is not the same URL to every router.
 */
export function shareUrl(origin: string, kind: ShareKind, token: string | null): string | null {
  const base = (origin ?? "").replace(/\/+$/, "");
  const clean = (token ?? "").trim();
  if (!base || !clean) return null;
  return `${base}${SHARE_PATHS[kind]}/${clean}`;
}

/**
 * Whether a record's link is currently live.
 *
 * Checklists and workflows carry both a `share_token` and a `revoked_at`: the
 * token is minted once and kept, and switching sharing off stamps `revoked_at`
 * rather than destroying it. So a record can have a token and still not be
 * shared, which is the case a naive `Boolean(share_token)` check gets wrong.
 */
export function isShareLive(shareToken: string | null, revokedAt: string | null): boolean {
  return Boolean(shareToken) && !revokedAt;
}

/** The patch that turns a record's link on or off. */
export function shareTogglePatch(
  enable: boolean,
  now: () => Date = () => new Date(),
): { revoked_at: string | null } {
  return { revoked_at: enable ? null : now().toISOString() };
}
