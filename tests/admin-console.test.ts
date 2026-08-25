import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  escapeFilterValue,
  escapeLikeValue,
  stripLikeWildcards,
  isMissingFunction,
} from "../apps/api/src/lib/postgrest";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/*
 * The admin console's regressions, guarded.
 *
 * Two different kinds of test live here because the defects were two different
 * kinds. The escaping is real logic and gets real assertions. The pagination
 * and the entry point are absences - code that was never written - and the only
 * thing that catches an absence coming back is reading the source, the same
 * approach and the same reasoning as tests/invariants.ts.
 */

describe("PostgREST filter escaping", () => {
  it("strips the characters that act as LIKE wildcards", () => {
    expect(stripLikeWildcards("100%")).toBe("100");
    expect(stripLikeWildcards("a_b")).toBe("ab");
    expect(stripLikeWildcards("a*b")).toBe("ab");
    expect(stripLikeWildcards("plain")).toBe("plain");
  });

  it("quotes a value so a comma cannot split an .or() expression", () => {
    // The actual bug: `full_name.ilike.%Smith, John%` parses as two filters,
    // the second of which is not a filter at all.
    expect(escapeLikeValue("Smith, John")).toBe('"%Smith, John%"');
    expect(escapeFilterValue("a,b")).toBe('"a,b"');
  });

  it("escapes quotes and backslashes so the closing quote cannot be moved", () => {
    expect(escapeFilterValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(escapeFilterValue("back\\slash")).toBe('"back\\\\slash"');
  });

  it("neutralises parentheses by quoting rather than by removing them", () => {
    // Parens group sub-expressions in .or(); inside quotes they are literal, so
    // a company name like "Acme (UK)" stays searchable instead of 400ing.
    expect(escapeLikeValue("Acme (UK)")).toBe('"%Acme (UK)%"');
  });

  it("recognises a missing SQL function so callers can fall back", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(
      isMissingFunction({ message: "Could not find the function public.admin_team_rollups" }),
    ).toBe(true);
    expect(isMissingFunction({ code: "PGRST205" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});

describe("admin services use the escaping helpers", () => {
  it("the users search does not interpolate a raw term into .or()", () => {
    const src = read("apps/api/src/domains/admin/users.ts");
    expect(src).toContain("escapeLikeValue");
    // The exact shape of the original defect.
    expect(src).not.toMatch(/const like = `%\$\{data\.search\}%`/);
  });

  it("the teams search strips wildcards", () => {
    const src = read("apps/api/src/domains/admin/teams.ts");
    expect(src).toContain("stripLikeWildcards");
  });
});

describe("admin lists are paginated", () => {
  /*
   * Two mechanisms, deliberately.
   *
   * Cursor pagination is right for an append-only feed: it cannot skip or
   * repeat a row when new ones arrive mid-scroll. But it cannot sort on an
   * arbitrary column, because the cursor IS the sort key. The users directory
   * sorts by six of them, so it pages by offset and gets a real total in
   * exchange - which is what lets it say "51-100 of 1,204" instead of "50 rows
   * loaded, more available".
   *
   * The invariant under test is that every list can reach page two, not that
   * they all do it the same way.
   */
  const CURSOR_PAGES = [
    "apps/web/src/features/admin/pages/AdminTeamsPage.tsx",
    "apps/web/src/features/admin/pages/AdminAuditLogPage.tsx",
    "apps/web/src/features/admin/pages/AdminNotificationsPage.tsx",
  ];

  it.each(CURSOR_PAGES)("%s consumes the server cursor", (page) => {
    const src = read(page);
    expect(src).toContain("useAdminList");
    expect(src).toContain("onLoadMore");
  });

  it("the users directory pages by offset and shows a real total", () => {
    const src = read("apps/web/src/features/admin/pages/AdminUsersPage.tsx");
    expect(src).toContain("offset");
    expect(src).toContain("Previous");
    expect(src).toContain("Next");
    // The total comes from SQL, so it describes the table rather than the page.
    expect(src).toContain("total.toLocaleString()");
  });

  it("the shared hook ends pagination on undefined, not null", () => {
    // react-query reads null as "there is another page", so returning the
    // server's `nextCursor: null` straight through yields an infinite
    // Load more button that fetches the same page forever.
    const src = read("apps/web/src/features/admin/hooks/use-admin-list.ts");
    expect(src).toContain("last.nextCursor ?? undefined");
  });
});

describe("admin console is reachable and guarded", () => {
  it("the sidebar links to /admin behind the platform-admin check", () => {
    const src = read("apps/web/src/components/AppSidebar.tsx");
    expect(src).toContain('url: "/admin"');
    expect(src).toContain("checkIsPlatformAdmin");
  });

  it("every admin service resolves the caller's admin status server-side", () => {
    /*
     * The client gate decides what to render; this is what decides what is
     * allowed. A service that forgets it is a full customer-data leak.
     *
     * Two ways to satisfy it, and only two. `requirePlatformAdmin` throws for a
     * non-admin and is what almost everything uses. `getPlatformAdminRole`
     * returns the role instead of throwing, which is what
     * `checkIsPlatformAdmin` needs - it must answer "no" to a non-admin rather
     * than erroring at them. Both read the caller's role from the database on
     * every call; neither trusts anything the client sent.
     */
    for (const file of ["service", "users", "teams", "notifications", "audit"]) {
      const src = read(`apps/api/src/domains/admin/${file}.ts`);
      const exported = src.match(/export async function \w+Service/g) ?? [];
      const guards = src.match(/requirePlatformAdmin\(|getPlatformAdminRole\(/g) ?? [];
      expect(guards.length, `${file}.ts guards`).toBeGreaterThanOrEqual(exported.length);
    }
  });

  it("revoking the last platform admin is refused", () => {
    const src = read("apps/api/src/domains/admin/users.ts");
    expect(src).toContain("last platform admin");
    // Counted with the target excluded, or revoking a non-admin trips the guard.
    expect(src).toMatch(/\.neq\("user_id", data\.userId\)/);
  });
});

describe("admin broadcast does not fan out one request per user", () => {
  it("inserts in batches", () => {
    const src = read("apps/api/src/domains/admin/notifications.ts");
    expect(src).toContain("chunk(rows)");
    // `await Promise.all(` rather than bare `Promise.all(`: the comment above
    // the fix quotes the original line, and a guard that trips on its own
    // explanation is a guard nobody keeps.
    expect(src).not.toContain("await Promise.all(");
  });

  it("reports what actually landed rather than what was intended", () => {
    const src = read("apps/api/src/domains/admin/notifications.ts");
    expect(src).toContain("return { sentTo: sent };");
  });
});

describe("team rollups are computed in the database", () => {
  it("the list service no longer pulls every photo row into a Map", () => {
    const src = read("apps/api/src/domains/admin/teams.ts");
    expect(src).toContain("admin_team_rollups");
    // The Map keyed by user_id is the defect that lost a multi-team user's
    // projects. It must not come back.
    expect(src).not.toContain("const teamByMemberId = new Map<string, string>()");
  });

  it("the fallback chunks its IN filters", () => {
    // Unchunked, a page whose teams own more than ~398 projects fails outright.
    // See apps/api/src/lib/chunked-in.ts.
    const src = read("apps/api/src/domains/admin/teams.ts");
    expect(src).toContain("selectIn");
  });

  it("the migration locks execute down to the service role", () => {
    // SECURITY DEFINER functions read past RLS, and Postgres grants EXECUTE to
    // PUBLIC by default - the same default that made new tables anon-readable.
    const sql = read("supabase/migrations/20260822120000_admin_team_rollups.sql");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.admin_team_rollups(uuid[])");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.admin_project_rollups(uuid[])");
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.admin_team_rollups(uuid[]) TO service_role",
    );
  });
});

describe("feedback inbox", () => {
  it("reads the table the product has been writing to all along", () => {
    // issue_reports had a writer (apps/web/src/lib/feedback.ts) and no reader.
    const src = read("apps/api/src/domains/admin/feedback.ts");
    expect(src).toContain('from("issue_reports")');
    expect(src).toContain("requirePlatformAdmin");
  });

  it("keeps the status vocabulary in step with the constraint", () => {
    const api = read("apps/api/src/domains/admin/feedback.ts");
    const sql = read("supabase/migrations/20260822130000_feedback_triage.sql");
    const statuses = ["new", "triaged", "resolved", "dismissed"];
    for (const s of statuses) {
      expect(api, `API missing ${s}`).toContain(`"${s}"`);
      expect(sql, `SQL missing ${s}`).toContain(`'${s}'`);
    }
    // A fifth status added to one side and not the other is accepted by the
    // API and rejected by the database at write time.
    expect(api).toContain(
      'export const FEEDBACK_STATUSES = ["new", "triaged", "resolved", "dismissed"] as const',
    );
  });

  it("escapes the description search", () => {
    const src = read("apps/api/src/domains/admin/feedback.ts");
    expect(src).toContain("escapeLikeValue");
  });

  it("refuses to silently drop a reply to a signed-out reporter", () => {
    // insertNotification returns early on a null recipient, so without this
    // check the reply would report success and reach nobody.
    const src = read("apps/api/src/domains/admin/feedback.ts");
    expect(src).toContain("if (!report.user_id)");
  });

  it("counts statuses off the table, not off the loaded page", () => {
    // A total computed from a cursor-paginated list silently means "of the
    // fifty rows currently loaded".
    const src = read("apps/api/src/domains/admin/feedback.ts");
    expect(src).toContain('{ count: "exact", head: true }');
  });

  it("is registered and routed", () => {
    expect(read("apps/api/src/domains/rpc/registry.ts")).toContain("listFeedback: authed(");
    expect(read("apps/web/src/features/admin/pages/AdminLayout.tsx")).toContain("/admin/feedback");
    expect(read("apps/web/src/routeTree.gen.ts")).toContain("/_app/admin/feedback");
  });
});
