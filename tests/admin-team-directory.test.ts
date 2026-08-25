import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const SQL = "supabase/migrations/20260823120000_admin_team_directory.sql";
const API = "apps/api/src/domains/admin/team-directory.ts";
const PAGE = "apps/web/src/features/admin/pages/AdminTeamsPage.tsx";

/*
 * The teams screen was the last admin list still assembled in Node, and the
 * inconsistency was the point: users got filters, sorting, a real total and
 * export, and teams kept a name box and a cursor. Two admin lists that behave
 * differently is a thing an operator has to remember.
 */

describe("the team directory answers the screen in SQL", () => {
  it("filters, sorts, counts and pages in one query", () => {
    const sql = read(SQL);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.admin_team_directory");
    expect(sql).toContain("count(*) OVER () AS total_count");
    expect(sql).toContain("LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0)");
  });

  it("orders deterministically so paging cannot repeat or skip", () => {
    expect(read(SQL)).toContain("f.created_at DESC, f.id");
  });

  it("uses the same project attribution rule as the rollups", () => {
    /*
     * team_id when it is set, the legacy membership inference only for rows
     * still unattributed. If the directory and the rollups disagreed, the
     * teams list and the team detail page would show different project counts
     * for the same team.
     */
    const sql = read(SQL);
    expect(sql).toContain("p.team_id IS NOT NULL");
    expect(sql).toContain("AND p.team_id IS NULL");
    expect(sql).toContain("UNION");
  });

  it("counts a project once per team even when both rules match", () => {
    // The UNION dedupes, and DISTINCT guards the aggregate.
    expect(read(SQL)).toContain("count(DISTINCT tp.project_id)");
  });

  it("exposes the statuses an operator actually asks about", () => {
    const sql = read(SQL);
    const api = read(API);
    for (const s of ["past_due", "canceled", "internal", "unpaid_plan", "no_profile", "dormant"]) {
      expect(sql, `SQL missing ${s}`).toContain(`'${s}'`);
      expect(api, `API missing ${s}`).toContain(`"${s}"`);
    }
  });

  it("can find a paid plan with nothing backing it", () => {
    // The paywall-hole signature from LAUNCH.md 1.0a, as a filter rather than
    // a one-off query in a migration comment.
    const sql = read(SQL);
    expect(sql).toMatch(/unpaid_plan[\s\S]{0,200}stripe_subscription_id IS NULL/);
    expect(sql).toMatch(/unpaid_plan[\s\S]{0,220}NOT j\.is_internal/);
  });

  it("locks both functions to the service role", () => {
    const sql = read(SQL);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.admin_team_directory");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.admin_team_industry_mix()");
  });
});

describe("the industry mix covers every team", () => {
  it("is its own query, not a tally of the loaded page", () => {
    /*
     * This panel is the reason the setup wizard collects a business profile,
     * and it used to count whatever fifty rows were loaded - captioned to admit
     * it, which is honest but useless. A distribution over an arbitrary page is
     * not a distribution.
     */
    expect(read(SQL)).toContain("CREATE OR REPLACE FUNCTION public.admin_team_industry_mix");
    expect(read(API)).toContain("getTeamIndustryMixService");
    const page = read(PAGE);
    expect(page).toContain("getTeamIndustryMix");
    expect(page).toContain("teams have completed the setup wizard");
    // The old caption admitted the panel only described the page in view.
    expect(page).not.toContain("shown have completed");
  });
});

describe("the teams page matches the users page", () => {
  it("pages by offset and shows a real total", () => {
    const page = read(PAGE);
    expect(page).toContain("Previous");
    expect(page).toContain("Next");
    expect(page).toContain("total.toLocaleString()");
  });

  it("says so rather than faking filters before the migration runs", () => {
    expect(read(API)).toContain("degraded: true");
    expect(read(PAGE)).toContain("Filters and sorting are unavailable");
  });

  it("renders unknown rollups as unknown, not as zero", () => {
    // "0 projects" is a fact an operator would act on; "we could not ask" is not.
    expect(read(PAGE)).toContain("degraded ? unknown");
  });

  it("gates the Stripe re-sync on billing", () => {
    const page = read(PAGE);
    expect(page).toContain('denyReason("billing")');
    expect(page).toContain("CapabilityNotice");
  });

  it("signposts the detail page from every row", () => {
    expect(read(PAGE)).toMatch(/Manage\s*\n?\s*<ChevronRight/);
  });

  it("defuses spreadsheet formula injection in its export", () => {
    const api = read(API);
    expect(api).toContain("s = `'${s}`");
  });
});
