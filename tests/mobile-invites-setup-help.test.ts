import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inviteRoute,
  inviteSignupProblem,
  isInvitePath,
  parseInviteLink,
  safeAfterLogin,
  sameEmail,
  subcontractorInviteProblem,
  teamInviteLink,
  teamInviteProblem,
  teamInviteSummary,
} from "../apps/mobile/src/api/invite-view";
import {
  EMPTY_PROFILE,
  canAdvance,
  canEditCompanyProfile,
  profileFromTeam,
  seedDraft,
  setupAutoOpenKey,
  setupPayload,
  shouldPromptSetup,
  toggled,
  withIndustry,
} from "../apps/mobile/src/api/account-setup-view";
import {
  blankDraft,
  cleanedLinks,
  draftsFrom,
  reviewLinkProblem,
  reviewLinksAllowed,
  reviewLinksChanged,
  reviewLinksLockedNote,
} from "../apps/mobile/src/api/review-links-view";
import { helpResults, supportMailto, SUPPORT_EMAIL } from "../apps/mobile/src/api/help-view";
import { attributionText } from "../apps/mobile/src/api/project-contributors-view";
import { HELP_CATEGORIES, HELP_GUIDE_IDS, searchHelp } from "../packages/shared/src/help-guides";
import { parentHref } from "../apps/mobile/src/lib/back-fallback";

/*
 * Teams, first-time setup, review links, help and the contributors line: the
 * web features the field app now does itself. Each block pins the rule that
 * decides what the phone shows, against the web's own wording and the ops the
 * web calls.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const TOKEN = "abcDEF123_-xyz789";

describe("invitation links", () => {
  it("reads the web's team and subcontractor links, however they arrive", () => {
    expect(parseInviteLink(`https://everlumen.co/invite/${TOKEN}`)).toEqual({
      kind: "team",
      token: TOKEN,
    });
    expect(parseInviteLink(`https://www.everlumen.co/subcontractor-invite/${TOKEN}?x=1`)).toEqual({
      kind: "subcontractor",
      token: TOKEN,
    });
    expect(parseInviteLink(`everlumen://invite/${TOKEN}`)?.kind).toBe("team");
    expect(parseInviteLink(`  /invite/${TOKEN}  `)?.token).toBe(TOKEN);
  });

  it("refuses anything that is not an invitation", () => {
    expect(parseInviteLink("")).toBeNull();
    expect(parseInviteLink("https://everlumen.co/projects/123")).toBeNull();
    expect(parseInviteLink("https://everlumen.co/invite/short")).toBeNull();
    expect(parseInviteLink(TOKEN)).toBeNull();
  });

  it("routes to the in-app accept screens, which sit outside the signed-in tree", () => {
    expect(inviteRoute({ kind: "team", token: TOKEN })).toBe(`/invite/${TOKEN}`);
    expect(inviteRoute({ kind: "subcontractor", token: TOKEN })).toBe(
      `/subcontractor-invite/${TOKEN}`,
    );
    expect(existsSync(join(ROOT, "apps/mobile/app/invite/[token].tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "apps/mobile/app/subcontractor-invite/[token].tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "apps/mobile/app/(app)/invite"))).toBe(false);
  });

  it("only lets sign-in return to an invitation", () => {
    expect(isInvitePath(`/invite/${TOKEN}`)).toBe(true);
    expect(isInvitePath("/projects")).toBe(false);
    expect(safeAfterLogin(`/subcontractor-invite/${TOKEN}`)).toBe(`/subcontractor-invite/${TOKEN}`);
    expect(safeAfterLogin("/admin")).toBeNull();
    expect(safeAfterLogin("https://evil.example/invite/" + TOKEN)).toBeNull();
    expect(safeAfterLogin(undefined)).toBeNull();
    const login = read("apps/mobile/app/login.tsx");
    expect(login).toContain("safeAfterLogin(params.redirect)");
  });

  it("builds the share link exactly as the web's Copy link does", () => {
    expect(teamInviteLink(TOKEN, "https://everlumen.co/")).toBe(
      `https://everlumen.co/invite/${TOKEN}`,
    );
    expect(teamInviteLink(TOKEN, "")).toBeNull();
  });

  it("names why an invitation cannot be used, in the web's words", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(teamInviteProblem(null)).toBe("This invite link is invalid.");
    expect(teamInviteProblem({ accepted_at: past, expires_at: future })).toBe(
      "This invite has already been used.",
    );
    expect(teamInviteProblem({ accepted_at: null, expires_at: past })).toBe(
      "This invite has expired.",
    );
    expect(teamInviteProblem({ accepted_at: null, expires_at: future })).toBeNull();
    expect(subcontractorInviteProblem("used")).toMatch(/already been used/);
    expect(subcontractorInviteProblem("expired")).toMatch(/expired/);
    expect(subcontractorInviteProblem(undefined)).toMatch(/not valid/);
  });

  it("checks the signup form in the web's order", () => {
    const ok = { fullName: "Dana", password: "12345678", confirmPassword: "12345678" };
    expect(inviteSignupProblem(ok)).toBeNull();
    expect(inviteSignupProblem({ ...ok, fullName: " " })).toMatch(/name/);
    expect(inviteSignupProblem({ ...ok, password: "1234", confirmPassword: "1234" })).toMatch(/8/);
    expect(inviteSignupProblem({ ...ok, confirmPassword: "nope" })).toMatch(/match/);
    expect(sameEmail("Dana@X.com ", "dana@x.com")).toBe(true);
    expect(sameEmail(null, "dana@x.com")).toBe(false);
  });

  it("tells an invitee what they can do, never what the workspace pays for", () => {
    for (const role of ["admin", "manager", "standard", "restricted"]) {
      const summary = teamInviteSummary(role, "team", "Acme");
      const text = `${summary.roleLabel} ${summary.access} ${summary.manage}`.toLowerCase();
      expect(text).not.toMatch(/\b(plan|tier|billing|starter|pro)\b/);
    }
    expect(teamInviteSummary("restricted", "team", "Acme").access).toMatch(/puts you on/);
    expect(teamInviteSummary("standard", "team", "Acme").access).toMatch(/all of Acme/);
  });

  it("uses the web's accept ops", () => {
    const api = read("apps/mobile/src/api/invites.ts");
    for (const op of [
      "lookupInvite",
      "acceptInvite",
      "acceptInviteSignup",
      "resendInviteConfirmation",
      "lookupSubcontractorInvite",
      "acceptSubcontractorInvite",
      "acceptSubcontractorInviteSignup",
      "createTeam",
    ]) {
      expect(api, op).toContain(`"${op}"`);
    }
  });

  it("opens https invitation links in the app on Android", () => {
    const app = JSON.parse(read("apps/mobile/app.json")).expo;
    expect(app.scheme).toBe("everlumen");
    const filters = app.android.intentFilters as Array<{
      data: Array<{ scheme: string; host: string; pathPrefix: string }>;
    }>;
    const data = filters.flatMap((f) => f.data);
    for (const host of ["everlumen.co", "www.everlumen.co"]) {
      for (const prefix of ["/invite/", "/subcontractor-invite/"]) {
        expect(data).toContainEqual({ scheme: "https", host, pathPrefix: prefix });
      }
    }
  });

  it("does not put the welcome screen in front of an invitation", () => {
    const root = read("apps/mobile/app/_layout.tsx");
    expect(root).toContain("isInvitePath(usePathname())");
    expect(root).toContain("!onInvite");
  });
});

describe("the Team screen", () => {
  const team = read("apps/mobile/app/(app)/team.tsx");

  it("starts a team, or opens a pasted invitation link, when there is none", () => {
    expect(team).toContain("createTeam(name.trim())");
    expect(team).toContain("parseInviteLink(link)");
  });

  it("shares a pending invite's link, and asks before cancelling one", () => {
    expect(team).toContain("teamInviteLink(invite.token, webAppUrl)");
    expect(team).toContain("Share.share");
    expect(team).toMatch(/Alert\.alert\(\s*"Cancel this invite\?"/);
    expect(team).toContain("onPress: confirmRevoke");
  });
});

describe("first-time account setup", () => {
  it("reads the profile off the team row, defensively", () => {
    expect(profileFromTeam(null)).toEqual(EMPTY_PROFILE);
    const p = profileFromTeam({ industry: "roofing", trades: ["hvac", 3], team_size: "2-5" });
    expect(p.industry).toBe("roofing");
    expect(p.trades).toEqual(["hvac"]);
    expect(p.team_size).toBe("2-5");
  });

  it("asks owners, admins and people with no team; never crew, never while loading", () => {
    expect(canEditCompanyProfile(false, null)).toBe(true);
    expect(canEditCompanyProfile(true, "owner")).toBe(true);
    expect(canEditCompanyProfile(true, "admin")).toBe(true);
    expect(canEditCompanyProfile(true, "standard")).toBe(false);
    const base = { loading: false, profile: EMPTY_PROFILE, canEdit: true, dismissed: false };
    expect(shouldPromptSetup(base)).toBe(true);
    expect(shouldPromptSetup({ ...base, loading: true })).toBe(false);
    expect(shouldPromptSetup({ ...base, dismissed: true })).toBe(false);
    expect(shouldPromptSetup({ ...base, canEdit: false })).toBe(false);
    expect(
      shouldPromptSetup({
        ...base,
        profile: { ...EMPTY_PROFILE, industry: "roofing", team_size: "2-5" },
      }),
    ).toBe(false);
    expect(setupAutoOpenKey("u1")).toBe("everlumen:setup-wizard-shown:u1");
  });

  it("gates only the first step, and needs a name when there is no team", () => {
    const draft = seedDraft(EMPTY_PROFILE, null);
    expect(canAdvance("industry", draft, true)).toBe(false);
    const picked = withIndustry({ ...draft, trades: ["roofing"] }, "roofing");
    expect(picked.trades).toEqual([]);
    expect(canAdvance("industry", picked, true)).toBe(true);
    expect(canAdvance("industry", picked, false)).toBe(false);
    expect(canAdvance("industry", { ...picked, companyName: "Acme" }, false)).toBe(true);
    expect(canAdvance("size", draft, false)).toBe(true);
    expect(toggled(["a"], "a")).toEqual([]);
    expect(toggled(["a"], "b")).toEqual(["a", "b"]);
  });

  it("saves as the web does: no empty rename, blank area cleared", () => {
    const payload = setupPayload({ ...seedDraft(EMPTY_PROFILE, null), service_area: "  " });
    expect(payload).not.toHaveProperty("companyName");
    expect(payload.service_area).toBeNull();
    expect(setupPayload({ ...seedDraft(EMPTY_PROFILE, " Acme ") }).companyName).toBe("Acme");
  });

  it("is on Home and uses the web's ops", () => {
    expect(read("apps/mobile/app/(app)/(tabs)/index.tsx")).toContain("<AccountSetupCard />");
    const workspace = read("apps/mobile/src/api/workspace.ts");
    expect(workspace).toContain('api.rpc("dismissSetupPrompt")');
    expect(read("apps/mobile/src/components/AccountSetup.tsx")).toContain(
      "saveCompanyProfile(setupPayload(draft))",
    );
  });
});

describe("review links", () => {
  it("is a Team feature, and only the owner is told about plans", () => {
    expect(reviewLinksAllowed({ plan: "team", isActive: true })).toBe(true);
    expect(reviewLinksAllowed({ plan: "team", isActive: false })).toBe(false);
    expect(reviewLinksAllowed({ plan: "pro", isActive: true })).toBe(false);
    expect(reviewLinksAllowed({ plan: "starter", isActive: true, isInternal: true })).toBe(true);
    expect(reviewLinksAllowed(null)).toBe(false);
    expect(reviewLinksLockedNote(true)).toMatch(/Team/);
    expect(reviewLinksLockedNote(false)).not.toMatch(/\b(plan|Team|Pro|upgrade)\b/i);
  });

  it("saves the rows the web would, and refuses what the op would", () => {
    const drafts = [
      { platform: "google" as const, url: " https://g.page/r/x ", label: "" },
      blankDraft(),
      { platform: "custom" as const, url: "https://yelp.com/biz/x", label: " Yelp " },
    ];
    expect(cleanedLinks(drafts)).toEqual([
      { platform: "google", url: "https://g.page/r/x", label: null },
      { platform: "custom", url: "https://yelp.com/biz/x", label: "Yelp" },
    ]);
    expect(reviewLinkProblem(blankDraft())).toBeNull();
    expect(reviewLinkProblem({ ...blankDraft(), url: "g.page/x" })).toMatch(/https/);
    const stored = [
      { id: "1", platform: "google" as const, url: "https://g.page/r/x", label: null, position: 0 },
    ];
    expect(reviewLinksChanged(stored, draftsFrom(stored))).toBe(false);
    expect(reviewLinksChanged(stored, [])).toBe(true);
  });

  it("has its own row in Account settings and its own screen", () => {
    const account = read("apps/mobile/app/(app)/(tabs)/account.tsx");
    expect(account).toContain('router.push("/settings/review-links")');
    const api = read("apps/mobile/src/api/review-links.ts");
    expect(api).toContain('"listReviewLinks"');
    expect(api).toContain('"setReviewLinks"');
    expect(parentHref("settings/review-links")).toBe("/account");
  });
});

describe("help", () => {
  it("shows the web's own Knowledge Base articles", () => {
    const web = read("apps/web/src/features/settings/pages/HelpPage.tsx");
    expect(web).toContain('from "@everlumen/shared/help-guides"');
    expect(HELP_CATEGORIES.length).toBeGreaterThan(10);
    expect(new Set(HELP_GUIDE_IDS).size).toBe(HELP_GUIDE_IDS.length);
    const all = helpResults("");
    expect(all.count).toBe(HELP_GUIDE_IDS.length);
    expect(all.summary).toMatch(/topics across/);
  });

  it("searches as the web does: a category match keeps all its guides", () => {
    const hits = searchHelp("roles");
    expect(hits.length).toBeGreaterThan(0);
    expect(helpResults("zzzz-nothing").count).toBe(0);
    const cat = HELP_CATEGORIES[0];
    expect(searchHelp(cat.title)[0].guides.length).toBe(cat.guides.length);
  });

  it("offers the web's support contact and What's new", () => {
    expect(SUPPORT_EMAIL).toBe("support@everlumen.co");
    expect(read("apps/web/src/lib/contact.ts")).toContain(`SUPPORT_EMAIL = "${SUPPORT_EMAIL}"`);
    expect(supportMailto("Everlumen support")).toBe(
      "mailto:support@everlumen.co?subject=Everlumen%20support",
    );
    const screen = read("apps/mobile/app/(app)/help.tsx");
    expect(screen).toContain("WebBrowser.openBrowserAsync(whatsNew)");
    expect(screen).toContain('router.push("/report-issue")');
    expect(read("apps/mobile/app/(app)/(tabs)/account.tsx")).toContain('router.push("/help")');
    expect(parentHref("help")).toBe("/account");
  });
});

describe("the Photos tab's contributors line", () => {
  const c = (over: Record<string, unknown>) => ({
    userId: "u",
    fullName: null,
    email: null,
    avatarUrl: null,
    photos: 0,
    tasks: 0,
    reports: 0,
    lastAt: null,
    ...over,
  });

  it("credits who added photos, most recent first, as the web does", () => {
    expect(attributionText([])).toBeNull();
    expect(attributionText([c({ fullName: "Dana", tasks: 3 })])).toBeNull();
    expect(attributionText([c({ fullName: "Dana", photos: 1 })])).toBe(
      "Logged by Dana · 1 photo added",
    );
    const three = attributionText([
      c({ fullName: "Ari", photos: 2, lastAt: "2026-01-01T00:00:00Z" }),
      c({ email: "sam@x.com", photos: 3, lastAt: "2026-03-01T00:00:00Z" }),
      c({ fullName: "Lee", photos: 1, lastAt: "2026-02-01T00:00:00Z" }),
    ]);
    expect(three).toMatch(/^Logged by sam, Lee and 1 other · 6 photos added · /);
  });

  it("reads the service's own field names and is drawn on the project page", () => {
    const service = read("apps/api/src/domains/teams/service.ts");
    for (const field of ["userId:", "fullName:", "photos:", "lastAt:"]) {
      expect(service).toContain(field);
    }
    const page = read("apps/mobile/app/(app)/project/[id]/index.tsx");
    expect(page).toContain("attributionText(contributorsQuery.data)");
    expect(read("apps/mobile/src/api/project-contributors.ts")).toContain(
      '"getProjectContributors"',
    );
  });
});
