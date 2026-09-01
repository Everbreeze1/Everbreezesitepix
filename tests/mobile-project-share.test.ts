import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isShareLive, shareUrl } from "../apps/mobile/src/api/share-links";

/*
 * Switching a job's public link off.
 *
 * The phone could mint a link to a WHOLE PROJECT - every photograph on the job,
 * readable by anyone holding the URL with no login - and had no way to take it
 * back. Documents and walkthrough write-ups both had a "Stop sharing"; the
 * largest thing that can be exposed did not.
 *
 * Found by extending the unwired-rule sweep from rule modules to the API
 * wrappers, which is where the miss actually was: `setProjectShareEnabled` had
 * been written and never called.
 */

describe("isShareLive, on a project", () => {
  it("is live with a token and no revocation", () => {
    expect(isShareLive("tok", null)).toBe(true);
  });

  it("is off once revoked, and the token survives", () => {
    /*
     * The reason the switch is a toggle rather than a delete: turning sharing
     * back on later restores the SAME address, so a link already sent to a
     * client starts working again instead of being stranded.
     */
    expect(isShareLive("tok", "2026-09-01T00:00:00Z")).toBe(false);
  });

  it("is off for a project nobody has ever shared", () => {
    expect(isShareLive(null, null)).toBe(false);
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/projects/public-share.ts"), "utf8");
  const client = () => readFileSync(join(process.cwd(), "apps/mobile/src/api/sharing.ts"), "utf8");
  const screen = () =>
    readFileSync(join(process.cwd(), "apps/mobile/app/(app)/project/[id]/index.tsx"), "utf8");

  it("reads the two fields the state op returns", () => {
    expect(service()).toContain("revokedAt: row.share_revoked_at ?? null");
    const c = client();
    expect(c).toContain("result?.shareToken");
    expect(c).toContain("result?.revokedAt");
  });

  it("uses the project's own revoked column, not the generic one", () => {
    /*
     * `projects` carries `share_revoked_at`; pages and reports carry
     * `revoked_at`. Reading the wrong one here would report every project as
     * live forever, which is the direction that matters - it would tell
     * somebody a link was open when it was closed, or hide the switch that
     * closes it.
     */
    expect(service()).toContain("share_revoked_at");
    expect(client()).not.toContain('"revoked_at"');
  });

  it("switches off without destroying the token", () => {
    const s = service();
    const at = s.indexOf("export async function setProjectShareService");
    const body = s.slice(at, at + 800);
    expect(body).toContain("share_revoked_at: revokedAt");
    // A rotate here would strand every link already sent.
    expect(body).not.toMatch(/share_token:\s*(crypto|randomUUID|gen)/);
  });

  it("offers the switch only when a link is live", () => {
    // "Stop sharing" on a job nobody shared invites somebody to press it and
    // wonder what they just did.
    expect(screen()).toContain("...(shareLive");
  });

  it("keeps the project link on the route the web serves", () => {
    expect(shareUrl("https://everlumen.co", "projects", "tok")).toBe(
      "https://everlumen.co/share/projects/tok",
    );
  });
});
