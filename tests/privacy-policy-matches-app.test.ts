import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The published privacy policy has to agree with what the app actually does.
 *
 * This is not a style rule. Both stores ask for a data declaration AND a link
 * to this page, and a reviewer reads one against the other: Google removes apps
 * whose declaration does not match observed behaviour, and Apple rejects at
 * review. The failure is not a lawyer's objection months later, it is a
 * rejected submission.
 *
 * The mismatch this file was written for was in the flattering direction, which
 * is why nobody had spotted it. Section 7 said "We use analytics tools to
 * collect aggregated, non-identifying usage data" and section 3 claimed usage
 * trends were analysed. Neither app has any analytics dependency at all. An
 * over-declaration is still a contradiction of the Data Safety form, and it
 * also gives away a permission the product never asked for.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const policy = () => read("apps/web/src/routes/privacy-policy.tsx");

/** Anything here in a package.json would make the "no analytics" claim false. */
const TRACKERS = [
  "analytic",
  "sentry",
  "amplitude",
  "mixpanel",
  "posthog",
  "bugsnag",
  "datadog",
  "segment",
  "firebase",
  "gtag",
];

function depsOf(pkgPath: string): string[] {
  const pkg = JSON.parse(read(pkgPath));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
}

describe("the no-tracking claim is true", () => {
  it("neither app ships an analytics or crash-reporting dependency", () => {
    /*
     * The honest way to check this claim is to read the dependency list, not to
     * remember. If this fails, the dependency is not necessarily wrong - but
     * the policy and BOTH store declarations have to be updated in the same
     * change, before the thing is switched on.
     */
    for (const p of ["apps/mobile/package.json", "apps/web/package.json"]) {
      const found = depsOf(p).filter((d) => TRACKERS.some((t) => d.toLowerCase().includes(t)));
      expect(found, `${p} now ships a tracker, so the privacy policy is out of date`).toEqual([]);
    }
  });

  it("the policy states it plainly rather than hedging", () => {
    const s = policy();
    expect(s).toContain("We do not use third-party analytics or advertising trackers");
    expect(s).toContain("no analytics or crash-reporting software");
  });

  it("no section still claims usage is analysed", () => {
    // The contradiction that survived in section 3 after section 7 was fixed.
    expect(policy()).not.toContain("Analyze usage trends");
  });
});

describe("everything the mobile app collects is disclosed", () => {
  /*
   * One row per line of `docs/mobile-data-safety.md`, which is itself derived
   * from the code. A capability that reaches the store form but never the
   * policy is the exact inconsistency a reviewer opens both tabs to find.
   */
  const CLAIMS: [string, string][] = [
    ["push tokens", "push token"],
    ["the camera and microphone", "camera and microphone"],
    ["photo library access", "photo library"],
    ["location for the project map", "location so photographs can be placed"],
    ["on-device offline storage", "written to a queue in the app"],
    ["the secure keystore holding the session", "secure keystore"],
  ];

  for (const [what, needle] of CLAIMS) {
    it(`discloses ${what}`, () => {
      expect(policy().replace(/\s+/g, " ")).toContain(needle);
    });
  }

  it("promises no background location, which the app enforces", () => {
    /*
     * Read from both sides. Saying it in the policy is worthless if the build
     * asks for the permission anyway, and Android reviewers check this one
     * specifically because background location needs a separate declaration.
     */
    expect(policy()).toContain("never requests background location");
    const appJson = JSON.parse(read("apps/mobile/app.json"));
    expect(appJson.expo.android.blockedPermissions).toContain(
      "android.permission.ACCESS_BACKGROUND_LOCATION",
    );
    const location = appJson.expo.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === "expo-location",
    );
    expect(location[1].isAndroidBackgroundLocationEnabled).toBe(false);
  });
});

describe("account deletion is described where a reviewer can follow it", () => {
  it("names the real route rather than a Settings page that does not exist", () => {
    /*
     * Google requires an account-deletion path that a reviewer can actually
     * walk. The policy used to say "the Settings page"; the control is called
     * Close my account and lives under Account.
     */
    const s = policy().replace(/\s+/g, " ");
    expect(s).toContain("Close my account");
    expect(s).not.toContain("delete your account at any time from the Settings page");
  });

  it("that control exists in the mobile app", () => {
    // The other side of the claim. A policy describing a screen nobody built
    // is worse than one that says to email support.
    const account = read("apps/mobile/app/(app)/(tabs)/account.tsx");
    expect(account).toContain("Close my account");
  });
});
