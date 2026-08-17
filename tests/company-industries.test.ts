import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  COMPANY_GOALS,
  HEARD_FROM,
  INDUSTRIES,
  INDUSTRY_IDS,
  PROJECT_VOLUMES,
  TEAM_SIZES,
  findIndustry,
  isBusinessProfileComplete,
  recommendedCategories,
  tradeCategoryFor,
} from "@sitepix/shared";

/*
 * The industry taxonomy is a join between three things that live in three
 * different languages: a TypeScript list, a set of SQL seed files, and a
 * hand-maintained order in the web app.
 *
 * Nothing type-checks that join. An industry whose `categories` name a trade
 * the library never seeds is not an error anywhere - the company answers the
 * setup wizard, is told their templates now lead, and opens a picker where
 * nothing moved. Which is worse than not having asked.
 */

const ROOT = resolve(__dirname, "..");
const MIGRATIONS = join(ROOT, "supabase/migrations");

/** Every `category` string the built-in library actually seeds. */
const SEEDED_CATEGORIES = (() => {
  const out = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) =>
    /document_templates.*seed\.sql$/.test(f),
  )) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const [, cat] of sql.matchAll(/'category',\s*'((?:[^']|'')*)'/g)) {
      out.add(cat.replace(/''/g, "'"));
    }
  }
  return out;
})();

const CATEGORY_ORDER_SRC = (() => {
  const src = readFileSync(join(ROOT, "apps/web/src/lib/template-categories.ts"), "utf8");
  const m = /export const CATEGORY_ORDER = \[([\s\S]*?)\]/.exec(src);
  return [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]);
})();

describe("the industry taxonomy", () => {
  it("parses (guards the scan these tests depend on)", () => {
    expect(SEEDED_CATEGORIES.size).toBeGreaterThanOrEqual(9);
    expect(CATEGORY_ORDER_SRC.length).toBeGreaterThanOrEqual(9);
    expect(INDUSTRIES.length).toBeGreaterThanOrEqual(10);
  });

  it("points every industry at categories the library actually seeds", () => {
    /*
     * The failure this exists for: `real_estate` shipped pointing at "Real
     * Estate" before any template carried that category, so answering the
     * wizard promoted an empty heading and the picker looked unchanged.
     */
    for (const ind of INDUSTRIES) {
      expect(ind.categories.length, `${ind.id} recommends nothing`).toBeGreaterThan(0);
      for (const cat of ind.categories) {
        expect(SEEDED_CATEGORIES.has(cat), `${ind.id} points at unseeded category "${cat}"`).toBe(
          true,
        );
      }
    }
  });

  it("keeps every recommended category in the shared trade order", () => {
    // `makeCategoryRank` falls back to `categoryRank` for anything it does not
    // recognise, so an unranked category still renders - just below every
    // listed trade, which for a company's own trade is the opposite of the
    // point.
    for (const ind of INDUSTRIES) {
      for (const cat of ind.categories) {
        expect(CATEGORY_ORDER_SRC, `"${cat}" is recommended but unranked`).toContain(cat);
      }
    }
  });

  it("covers the trades the client asked for by name", () => {
    // Plumbing, electrical, HVAC, construction, real estate and cleaning were
    // named in the request. Each has to be answerable AND lead to templates.
    for (const id of [
      "plumbing",
      "electrical",
      "hvac",
      "construction",
      "real_estate",
      "cleaning",
    ]) {
      const ind = findIndustry(id);
      expect(ind, `${id} is not an industry`).toBeTruthy();
      expect(SEEDED_CATEGORIES.has(ind!.categories[0]), `${id} leads with no templates`).toBe(true);
    }
  });

  it("only claims a trade heading where one is actually written for it", () => {
    /*
     * `tradeCategoryFor` is what badges a heading "Your trade" and what the
     * in-project picker opens on arrival. Only "Something else" has none, and
     * by definition cannot: badging "Field Reports" as that company's trade is
     * a claim about them that is not true.
     *
     * Landscaping was in that position too until it got a section of its own
     * in 20260830000000. Anything else added here without a library ends up
     * back in it, which is what the coverage tests exist to catch.
     */
    for (const ind of INDUSTRIES) {
      const trade = tradeCategoryFor(ind.id);
      if (trade === null) continue;
      expect(SEEDED_CATEGORIES.has(trade), `${ind.id} claims unseeded trade "${trade}"`).toBe(true);
      // It must also be the heading the reordering lifts, or the badge lands on
      // one section while another leads.
      expect(ind.categories[0], `${ind.id} badges a heading it does not lead with`).toBe(trade);
    }
    expect(tradeCategoryFor("other")).toBeNull();
    expect(tradeCategoryFor("landscaping")).toBe("Landscaping");
    expect(tradeCategoryFor(null)).toBeNull();
    expect(tradeCategoryFor("underwater-basket-weaving")).toBeNull();
  });

  it("uses ids that are unique and safe to store forever", () => {
    expect(new Set(INDUSTRY_IDS).size).toBe(INDUSTRY_IDS.length);
    for (const id of INDUSTRY_IDS) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    for (const list of [TEAM_SIZES, PROJECT_VOLUMES, COMPANY_GOALS, HEARD_FROM]) {
      const ids = list.map((c) => c.id);
      expect(new Set(ids).size, `duplicate id in ${JSON.stringify(ids)}`).toBe(ids.length);
    }
  });
});

describe("recommendedCategories", () => {
  it("leads with the primary industry, then each extra trade", () => {
    const out = recommendedCategories("hvac", ["plumbing"]);
    expect(out[0]).toBe("HVAC");
    expect(out[1]).toBe("Plumbing");
  });

  it("puts every trade above the general fallbacks", () => {
    /*
     * The bug this exists for, seen on screen before it was seen in code: a
     * plumber who also does HVAC got
     * `Plumbing, Field Reports, Field Admin, HVAC` - their second trade below
     * two generic headings. Walking the primary's full list first and
     * appending extras afterwards is the natural way to write this, and it is
     * wrong.
     */
    const out = recommendedCategories("plumbing", ["hvac"]);
    expect(out.slice(0, 2)).toEqual(["Plumbing", "HVAC"]);
    expect(out.indexOf("HVAC")).toBeLessThan(out.indexOf("Field Reports"));
    expect(out.indexOf("HVAC")).toBeLessThan(out.indexOf("Field Admin"));
  });

  it("ignores an extra trade with no section of its own", () => {
    // "Something else" has no trade heading, so it must not inject one.
    const out = recommendedCategories("plumbing", ["other"]);
    expect(out[0]).toBe("Plumbing");
    expect(out).not.toContain(undefined);
  });

  it("never repeats a heading", () => {
    // Both industries list "Field Reports"; a repeated heading would render
    // the same section twice in the picker.
    const out = recommendedCategories("electrical", ["hvac", "plumbing"]);
    expect(new Set(out).size).toBe(out.length);
  });

  it("is empty for a company that has not answered", () => {
    expect(recommendedCategories(null)).toEqual([]);
    expect(recommendedCategories(undefined, [])).toEqual([]);
    // An id from a stale client, or one we retired. Falling back to "no
    // recommendation" keeps the default order rather than throwing on a
    // dashboard.
    expect(recommendedCategories("underwater-basket-weaving")).toEqual([]);
  });
});

describe("isBusinessProfileComplete", () => {
  it("needs the industry and the team size, and nothing else", () => {
    expect(isBusinessProfileComplete(null)).toBe(false);
    expect(isBusinessProfileComplete({ industry: "hvac" })).toBe(false);
    expect(isBusinessProfileComplete({ team_size: "2-5" })).toBe(false);
    expect(isBusinessProfileComplete({ industry: "hvac", team_size: "2-5" })).toBe(true);
  });
});

/*
 * The wiring, checked by reading the source. These are cheap and they cover the
 * one failure mode that is invisible at runtime: a screen that quietly stops
 * consulting the profile and goes back to the fixed order.
 */
describe("the screens that read the business profile", () => {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  it("sorts both template screens by the personalised rank", () => {
    for (const path of [
      "apps/web/src/features/projects/components/ChoosePageTemplateDialog.tsx",
      "apps/web/src/features/settings/components/DocumentTemplatesManager.tsx",
    ]) {
      const src = read(path);
      expect(src, `${path} does not use the personalised rank`).toMatch(/makeCategoryRank\(/);
      expect(src, `${path} does not read the company profile`).toMatch(/useCompanySetup\(/);
      // The "Your trade" heading comes from the shared taxonomy, not from
      // re-deriving it out of the sort order in two places that could disagree.
      expect(src, `${path} derives the trade heading itself`).toMatch(/tradeCategoryFor\(/);
    }
  });

  it("writes the profile through the RPC, never straight to the table", () => {
    /*
     * `teams` is service-role-only since
     * 20260811002000_lock_down_team_billing_writes.sql, because `plan` and
     * `is_internal` live on the same row. A form that reached for
     * supabase.from("teams").update() would fail in production and, worse,
     * would be a request to re-grant the write that migration took away.
     */
    for (const path of [
      "apps/web/src/features/settings/components/AccountSetupDialog.tsx",
      "apps/web/src/features/settings/components/BusinessProfileSection.tsx",
      "apps/web/src/hooks/use-company-setup.tsx",
    ]) {
      expect(read(path), `${path} writes teams directly`).not.toMatch(/from\("teams"\)/);
    }
    expect(read("apps/web/src/features/settings/components/AccountSetupDialog.tsx")).toMatch(
      /saveCompanyProfile\(/,
    );
  });

  it("validates the setup answers server-side against the shared lists", () => {
    // Otherwise the enums exist only in the UI, and the column accepts
    // whatever a stale tab or a hand-rolled request sends.
    const registry = read("apps/api/src/domains/rpc/registry.ts");
    expect(registry).toMatch(/saveCompanyProfile:/);
    expect(registry).toMatch(/INDUSTRY_IDS/);
    expect(registry).toMatch(/TEAM_SIZE_IDS/);
    expect(registry).toMatch(/from "@sitepix\/shared"/);
  });

  it("never claims a company is unset while it is still loading", () => {
    /*
     * Caught in a browser, not by reading code: Settings → Company spent ~5
     * seconds telling a company that WAS set up "Not set up yet, so the
     * template library is in its default order", beside a button offering to
     * set it up again. Long enough to be the state most people see and act on.
     *
     * Both surfaces that can render an "unset" message have to gate on
     * `loading` first. The card already did; the panel did not.
     */
    // The card's guard lives in the hook that decides `shouldPrompt`, not in
    // the card - the card only draws what it is told.
    const hook = read("apps/web/src/hooks/use-company-setup.tsx");
    expect(hook, "the dashboard card can prompt before the team has loaded").toMatch(
      /shouldPrompt:\s*!loading &&/,
    );

    const panel = read("apps/web/src/features/settings/components/BusinessProfileSection.tsx");
    expect(panel, "the Settings panel renders a verdict before the team has loaded").toMatch(
      /if \(setup\.loading\)/,
    );
    // The early return has to come before the "Not set up yet" copy, or the
    // guard is decorative.
    expect(panel.indexOf("if (setup.loading)")).toBeLessThan(panel.indexOf("Not set up yet"));
  });

  it("reads the answers back out where an admin can see them", () => {
    /*
     * `goals` is the only column that records what a customer's problem is, in
     * words they picked themselves. It shipped write-only: the wizard wrote it
     * and nothing anywhere displayed it, which makes asking the question a
     * cost with no return.
     */
    const api = read("apps/api/src/domains/admin/teams.ts");
    expect(api).toMatch(/businessProfile:/);
    // Both admin reads carry it: the list, for the industry mix, and the
    // detail, for one company's answers.
    expect([...api.matchAll(/goals: Array\.isArray\(/g)]).toHaveLength(2);

    const page = read("apps/web/src/features/admin/pages/AdminTeamDetailPage.tsx");
    expect(page).toMatch(/BusinessProfilePanel/);
    expect(page, "the goals a company picked are never rendered").toMatch(/COMPANY_GOALS/);
  });

  it("checks the caller may answer for the company", () => {
    // The profile is company-wide and the write goes through the admin client,
    // so this check is the only thing between a crew member and the row.
    const service = read("apps/api/src/domains/teams/service.ts");
    expect(service).toMatch(/export async function saveCompanyProfileService/);
    expect(service).toMatch(/Only owners and admins can change the company profile/);
  });

  it("ships the migration the columns live in", () => {
    const sql = read("supabase/migrations/20260827000000_team_business_profile.sql");
    for (const col of [
      "industry",
      "trades",
      "team_size",
      "project_volume",
      "goals",
      "heard_from",
      "service_area",
      "profile_completed_at",
    ]) {
      expect(sql, `migration never adds ${col}`).toContain(col);
    }
    expect(sql).toContain("setup_prompt_dismissed_at");
    // Re-granting the write to `authenticated` would undo 20260811002000.
    expect(sql).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE)[^;]*public\.teams/i);
  });
});
