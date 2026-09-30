import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canUseWatermark,
  companyPatch,
  formatStorage,
  logoPath,
  readStorageSum,
  showsPlanDetails,
  storageSummary,
  tierFor,
  watermarkNote,
  watermarkOn,
} from "../apps/mobile/src/api/company-view";

/*
 * Company details and branding on the phone: the web Settings page's Company
 * section, writing the same profile columns, the same storage path and the
 * same watermark rule. Invited members must never be told the plan.
 */

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("the watermark follows the web's canUseWatermark", () => {
  it("is Pro and Team, active, or an internal workspace", () => {
    expect(canUseWatermark({ plan: "pro", isActive: true })).toBe(true);
    expect(canUseWatermark({ plan: "team", isActive: true })).toBe(true);
    expect(canUseWatermark({ plan: "starter", isActive: true })).toBe(false);
    expect(canUseWatermark({ plan: "team", isActive: false })).toBe(false);
    expect(canUseWatermark({ plan: "starter", isActive: false, isInternal: true })).toBe(true);
    expect(canUseWatermark(null)).toBe(false);
  });

  it("draws the switch as the web does: on unless turned off, and only when allowed", () => {
    expect(watermarkOn(true, null)).toBe(true);
    expect(watermarkOn(true, false)).toBe(false);
    expect(watermarkOn(false, true)).toBe(false);
  });

  it("never names a plan to an invited member", () => {
    const member = watermarkNote({ allowed: false, hasLogo: true, owner: false });
    expect(member).not.toMatch(/pro|team|plan|starter/i);
    expect(watermarkNote({ allowed: false, hasLogo: true, owner: true })).toMatch(/Pro or Team/);
    expect(watermarkNote({ allowed: true, hasLogo: false, owner: false })).toMatch(/logo/i);
  });
});

describe("storage", () => {
  it("prints bytes the way the web does", () => {
    expect(formatStorage(0)).toBe("0 B");
    expect(formatStorage(1536)).toBe("1.5 KB");
    expect(formatStorage(50 * 1024 ** 3)).toBe("50 GB");
  });

  it("shows the owner usage against the plan's allowance", () => {
    const owner = storageSummary(10 * 1024 ** 3, { plan: "pro", isActive: true, myRole: "owner" });
    expect(owner.line).toContain("Pro plan");
    expect(owner.line).toContain("of 100 GB");
    expect(owner.percent).toBeCloseTo(10);
  });

  it("shows anybody else only what their own photos use", () => {
    for (const role of ["admin", "manager", "member", "restricted", null]) {
      const summary = storageSummary(10 * 1024 ** 3, {
        plan: "team",
        isActive: true,
        myRole: role,
      });
      expect(summary.line).not.toMatch(/plan|team|pro|starter|of \d/i);
      expect(summary.percent).toBeNull();
    }
    expect(showsPlanDetails({ myRole: "admin" })).toBe(false);
    expect(showsPlanDetails({ myRole: "owner" })).toBe(true);
  });

  it("treats internal workspaces as Team, like the web", () => {
    expect(tierFor({ plan: "starter", isInternal: true })).toBe("team");
    expect(tierFor({ plan: "weird" })).toBe("starter");
  });

  it("reads the sum aggregate whatever shape it arrives in", () => {
    expect(readStorageSum({ sum: "2048" })).toBe(2048);
    expect(readStorageSum({ sum: 10 })).toBe(10);
    expect(readStorageSum(null)).toBe(0);
    expect(readStorageSum({ sum: "nope" })).toBe(0);
  });
});

describe("the same writes as the web", () => {
  const api = read("apps/mobile/src/api/company.ts");

  it("stores blanks as null", () => {
    expect(companyPatch({ company: " Acme ", phone: "", address: "  ", website: "x" })).toEqual({
      company: "Acme",
      company_phone: null,
      company_address: null,
    });
  });

  it("uploads the logo to the web's bucket and path, and points the profile at it", () => {
    expect(logoPath("u1", 5)).toBe("u1/logo-5.png");
    expect(api).toContain('.from("company-logos")');
    expect(api).toContain("company_logo_url: url");
    expect(api).toContain("getPublicUrl(path)");
  });

  it("writes the profile columns the web writes", () => {
    for (const column of [
      "watermark_enabled",
      "report_photos_per_page",
      "company_phone",
      "company_address",
    ]) {
      expect(api).toContain(column);
    }
    expect(api).toContain('{ onConflict: "id" }');
    // The web's storage query, not a new one.
    expect(api).toContain('.select("size_bytes.sum()")');
    expect(api).toContain('.eq("uploaded_by", userId)');
  });

  it("keeps the website under the web's own key, since it has no column", () => {
    expect(api).toContain("everlumen:company-extras:");
    expect(read("apps/web/src/features/settings/pages/SettingsPage.tsx")).toContain(
      "everlumen:company-extras:",
    );
  });

  it("is reachable from Account and from Workspace settings", () => {
    expect(read("apps/mobile/app/(app)/(tabs)/account.tsx")).toContain(
      'router.push("/settings/company")',
    );
    expect(read("apps/mobile/app/(app)/workspace.tsx")).toContain(
      'router.push("/settings/company")',
    );
  });
});
