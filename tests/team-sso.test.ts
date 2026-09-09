import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

/**
 * Team-tier single sign-on.
 *
 * SSO exists as a product capability, but it was surfaced nowhere: the Team
 * card on /pricing did not list it (Enterprise's summary claimed it), and the
 * account owner had no sign of it in Settings. These are path-based checks of
 * the wiring, the same as the rest of the family tests here - what they guard
 * is that SSO is advertised on the tier that sells it and reachable by the
 * people who administer it.
 */
describe("family: Team tier advertises SSO and the owner can find it", () => {
  it("lists SSO on the Team card's feature list", () => {
    const pricing = read("apps/web/src/lib/pricing.ts");
    // The Team card's own additions - the "Features section" on /pricing.
    // Anchored from `id: "team"` because `adds: string[];` in the shared
    // interface matches "];" before the Team entry does.
    const teamStart = pricing.indexOf('id: "team"');
    const team = pricing.slice(teamStart, pricing.indexOf("];", teamStart));
    expect(team).toMatch(/Single Sign-On \(SSO\)/);
  });

  it("no Enterprise-only claim still touts SSO", () => {
    const pricing = read("apps/web/src/lib/pricing.ts");
    // Enterprise used to read "10+ users, API access, SSO, ..." - SSO now
    // belongs to Team, so a claim that it is Enterprise's own would contradict
    // the card above it.
    expect(pricing).not.toMatch(/API access, SSO/);
    // And the band under the cards no longer lists SSO as an ask no
    // self-serve tier answers.
    const page = read("apps/web/src/routes/pricing.tsx");
    expect(page).not.toMatch(/\(API, SSO, a named/);
  });

  it("the owner's Settings has a Single Sign-On section", () => {
    const settings = read("apps/web/src/features/settings/pages/SettingsPage.tsx");
    expect(settings).toMatch(/id: "sso"/);
    expect(settings).toMatch(/label: "Single Sign-On"/);
    expect(settings).toMatch(/<SsoSection/);
  });

  it("the section is gated to the Team tier and to the people who can manage it", () => {
    const settings = read("apps/web/src/features/settings/pages/SettingsPage.tsx");
    // Non-Team sees the upgrade prompt; Team owners see the management CTA.
    expect(settings).toMatch(/Included with the Team plan/);
    expect(settings).toMatch(/isOwner/);
    expect(settings).toMatch(/Contact support to connect SSO/);
    // Non-owners are told who can change it rather than given a dead control.
    expect(settings).toMatch(/Only Owners and Admins can set up or change single sign-on/);
  });

  it("the section names the supported identity providers", () => {
    const settings = read("apps/web/src/features/settings/pages/SettingsPage.tsx");
    expect(settings).toMatch(/SAML 2\.0/);
    // The sentence wraps across source lines (even mid-name), so tolerate
    // any whitespace between words rather than requiring one exact line.
    expect(settings).toMatch(/Google\s+Workspace,\s+Microsoft\s+Entra\s+ID, or Okta/);
  });
});
