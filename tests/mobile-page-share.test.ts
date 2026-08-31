import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isShareLive, shareUrl, type ShareKind } from "../apps/mobile/src/api/share-links";

/*
 * Sharing a document.
 *
 * The last of the shareable records to reach the phone, and the one that
 * mattered most once the whole-job report landed: that report IS a `project_pages`
 * row, so without this the hand-over document could be written from the van and
 * not sent from it.
 *
 * The rule that earns a test is the token's lifetime. Turning sharing off
 * stamps `revoked_at` and KEEPS the token, so a naive `Boolean(share_token)`
 * reports a withdrawn document as public - which is the direction that matters,
 * because it tells somebody a client can still read something they withdrew.
 */

describe("isShareLive", () => {
  it("is live only with a token and no revocation", () => {
    expect(isShareLive("tok", null)).toBe(true);
  });

  it("is not live once withdrawn, even though the token survives", () => {
    /*
     * The case a `Boolean(share_token)` check gets wrong. The token is kept so
     * that turning sharing back on restores the SAME url - a link already sent
     * to a client keeps working rather than silently becoming a 404.
     */
    expect(isShareLive("tok", "2026-09-01T00:00:00Z")).toBe(false);
  });

  it("is not live without a token", () => {
    expect(isShareLive(null, null)).toBe(false);
    expect(isShareLive("", null)).toBe(false);
  });
});

describe("shareUrl", () => {
  const ORIGIN = "https://everlumen.co";

  it("builds the route the web actually serves for a document", () => {
    expect(shareUrl(ORIGIN, "pages", "tok")).toBe("https://everlumen.co/share/pages/tok");
  });

  it("builds the summary route through the same map", () => {
    // This one was hardcoded in `summaries.ts` first, which is exactly the
    // duplication `share-links.ts` exists to end.
    expect(shareUrl(ORIGIN, "summaries", "tok")).toBe("https://everlumen.co/share/summaries/tok");
  });

  it("returns null rather than a half-formed link", () => {
    /*
     * A caller handed "/share/pages/undefined" would put it in a text message,
     * and the person receiving it sees a 404 with no way to tell it was never
     * real.
     */
    expect(shareUrl(ORIGIN, "pages", null)).toBeNull();
    expect(shareUrl(ORIGIN, "pages", "  ")).toBeNull();
    expect(shareUrl("", "pages", "tok")).toBeNull();
  });

  it("does not double the slash on a trailing-slash origin", () => {
    expect(shareUrl("https://everlumen.co/", "pages", "tok")).toBe(
      "https://everlumen.co/share/pages/tok",
    );
  });
});

describe("every share kind resolves to a route the web serves", () => {
  it("has a matching route file for each", () => {
    /*
     * The map and the router are two halves of the same contract, and a link
     * that 404s is worse than no link at all. Read from the routes directory
     * rather than trusted.
     */
    const kinds: ShareKind[] = [
      "photos",
      "projects",
      "checklists",
      "workflows",
      "walkthroughs",
      "reports",
      "pages",
      "summaries",
      "showcases",
    ];
    for (const kind of kinds) {
      const url = shareUrl("https://x.test", kind, "tok");
      expect(url, kind).toBeTruthy();
      const prefix = url!.replace("https://x.test/share/", "").replace("/tok", "");
      const route = join(process.cwd(), `apps/web/src/routes/share.${prefix}.$token.tsx`);
      expect(() => readFileSync(route, "utf8"), `${kind} -> ${prefix}`).not.toThrow();
    }
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/projects/pages.ts"), "utf8");

  it("reads the field name the service answers with", () => {
    // `shareToken`, not `share_token`: this op maps its reply rather than
    // returning the row, unlike `getProjectPage` in the same file.
    expect(service()).toContain("return { shareToken: row.share_token as string };");
    const client = readFileSync(join(process.cwd(), "apps/mobile/src/api/pages.ts"), "utf8");
    expect(client).toContain("result?.shareToken");
  });

  it("toggles rather than mints, keeping the token", () => {
    /*
     * The service stamps `revoked_at` and leaves `share_token` alone. If it ever
     * started rotating the token, every link already sent to a client would die
     * the moment somebody toggled sharing off and on.
     */
    const s = service();
    const at = s.indexOf("setProjectPageShareService");
    const body = s.slice(at, at + 500);
    expect(body).toContain("revoked_at: data.enable ? null : new Date().toISOString()");
    expect(body).not.toContain("share_token: ");
  });
});
