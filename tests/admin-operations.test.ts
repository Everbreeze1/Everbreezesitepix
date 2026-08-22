import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/*
 * Guards for the operational half of the admin console: roles, the support
 * console, share-link revocation, observability, billing operations and usage.
 *
 * Source-text assertions, same approach and same reasoning as
 * tests/invariants.test.ts and tests/admin-console.test.ts: most of what is
 * defended here is a *decision* (this action needs that capability; this count
 * happens in SQL; this failure is reported rather than swallowed) rather than a
 * pure function, and this repo has no Supabase integration harness.
 */

describe("admin capability roles", () => {
  it("read is the default so existing call sites keep working", () => {
    const src = read("apps/api/src/lib/admin-context.ts");
    expect(src).toContain('capability: AdminCapability = "read"');
  });

  it("only superadmin holds the owner capability", () => {
    // An admin who can grant admin can promote themselves past every other
    // restriction, which would make the role column decorative.
    const src = read("apps/api/src/lib/admin-context.ts");
    expect(src).toMatch(/support: new Set<AdminCapability>\(\["read", "support"\]\)/);
    expect(src).toMatch(/billing: new Set<AdminCapability>\(\["read", "billing"\]\)/);
    expect(src).toMatch(/superadmin: new Set<AdminCapability>\(\[[^\]]*"owner"[^\]]*\]\)/);
  });

  it("survives a database that has no role column yet", () => {
    // The column arrives by hand-run migration, so this code ships first.
    // PostgREST rejects the whole select over one unknown column, which would
    // lock every admin out of the console until the SQL ran.
    const src = read("apps/api/src/lib/admin-context.ts");
    expect(src).toContain("isMissingColumn");
    expect(src).toContain('return legacy ? "superadmin" : null');
  });

  it("defaults existing rows to superadmin so nobody is locked out", () => {
    const sql = read("supabase/migrations/20260822150000_admin_roles.sql");
    expect(sql).toContain("DEFAULT 'superadmin'");
    expect(sql).toContain("platform_admins_role_check");
  });

  it("guards the destructive services with the right capability", () => {
    const expected: Array<[string, string]> = [
      ["apps/api/src/domains/admin/users.ts", "owner"],
      ["apps/api/src/domains/admin/shares.ts", "owner"],
      ["apps/api/src/domains/admin/billing.ts", "billing"],
      ["apps/api/src/domains/admin/teams.ts", "billing"],
    ];
    for (const [file, cap] of expected) {
      expect(read(file), `${file} should require ${cap}`).toContain(
        `requirePlatformAdmin(ctx.userId, "${cap}")`,
      );
    }
  });
});

describe("support console", () => {
  it("logs the read, not just the write", () => {
    // Opening a customer's account is a privacy event and left no trace.
    expect(read("apps/api/src/domains/admin/audit.ts")).toContain(
      "export async function logAdminRead",
    );
    expect(read("apps/api/src/domains/admin/user-detail.ts")).toContain("logAdminRead");
  });

  it("requires a reason on every mutating support action", () => {
    const src = read("apps/api/src/domains/admin/user-detail.ts");
    expect(src).toContain("const reasonSchema = z.string().trim().min(3).max(500)");
    expect(src).toContain("reason: reasonSchema");
  });

  it("verifies the typed delete confirmation server-side", () => {
    // The dialog is not the only caller, and this is the one action with no undo.
    const src = read("apps/api/src/domains/admin/user-detail.ts");
    expect(src).toContain("data.confirmEmail.trim().toLowerCase() !== email.toLowerCase()");
    expect(src).toContain("You cannot delete your own account");
  });

  it("reports rather than destroys the projects of a deleted user", () => {
    const src = read("apps/api/src/domains/admin/user-detail.ts");
    expect(src).toContain("orphanedProjects");
  });
});

describe("share link inventory", () => {
  it("only lists sources that exist in this database", () => {
    // project_page_shares and showcase_shares are in the generated types and in
    // migration filenames but are absent from production - verified by probe.
    const src = read("apps/api/src/domains/admin/shares.ts");
    expect(src).not.toContain('table: "project_page_shares"');
    expect(src).not.toContain('table: "showcase_shares"');
    for (const t of ["walkthroughs", "walkthrough_summaries", "showcases", "projects"]) {
      expect(src, `missing source ${t}`).toContain(`table: "${t}"`);
    }
  });

  it("revokes by nulling the token, which is what actually breaks the link", () => {
    const src = read("apps/api/src/domains/admin/shares.ts");
    expect(src).toContain("share_token: null");
  });

  it("requires a reason and logs which ids were killed", () => {
    const src = read("apps/api/src/domains/admin/shares.ts");
    expect(src).toContain("reason: z.string().trim().min(3).max(500)");
    expect(src).toContain("ids: data.ids");
  });
});

describe("observability", () => {
  it("aggregates in Postgres rather than pulling rows into Node", () => {
    const src = read("apps/api/src/domains/admin/health.ts");
    expect(src).toContain("admin_api_health");
    expect(src).toContain("admin_api_op_stats");
  });

  it("locks the aggregation functions and job_runs down", () => {
    const sql = read("supabase/migrations/20260822140000_admin_observability.sql");
    for (const fn of ["admin_api_health", "admin_api_op_stats", "admin_api_timeseries"]) {
      expect(sql, `${fn} REVOKE`).toContain(`REVOKE ALL ON FUNCTION public.${fn}(`);
    }
    expect(sql).toContain("REVOKE ALL ON public.job_runs FROM anon, authenticated");
    expect(sql).toContain("ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY");
  });

  it("bounds api_audit_logs growth", () => {
    const sql = read("supabase/migrations/20260822140000_admin_observability.sql");
    expect(sql).toContain("admin_prune_api_audit_logs");
  });

  it("says the migration is missing rather than rendering zero traffic", () => {
    // An unmigrated database showing 0 requests is indistinguishable from an
    // idle API, and the wrong one of those is alarming.
    const src = read("apps/api/src/domains/admin/health.ts");
    expect(src).toContain("20260822140000_admin_observability.sql");
  });

  it("records both cron jobs, including their failures", () => {
    expect(read("apps/api/src/domains/hooks/purge-trash.ts")).toContain(
      'recordJobRun("purge-trash"',
    );
    expect(read("apps/api/src/domains/hooks/archive-old-photos.ts")).toContain(
      'recordJobRun("archive-old-photos"',
    );
    // The failure row is written before the rethrow, or a job that dies leaves
    // no record of having died - the case the table exists for.
    expect(read("apps/api/src/lib/job-run.ts")).toContain("ok: false");
  });

  it("lists jobs that have never run", () => {
    // A job with no rows is exactly the failure this page exists to surface.
    expect(read("apps/api/src/domains/admin/health.ts")).toContain("KNOWN_JOBS");
  });
});

describe("billing operations", () => {
  it("keeps the paywall-hole reconciliation as a standing report", () => {
    const src = read("apps/api/src/domains/admin/billing.ts");
    expect(src).toContain("paidWithoutSubscription");
    expect(src).toContain("statusMismatch");
  });

  it("degrades rather than breaking when Stripe is unreachable", () => {
    // The local columns are what the paywall reads, and they matter most
    // precisely when Stripe is having a bad day.
    expect(read("apps/api/src/domains/admin/billing.ts")).toContain("unavailableReason");
  });

  it("leaves subscription status to the webhook", () => {
    // Writing teams.subscription_status here would race the webhook, which is
    // its single writer, and the webhook would win at an unpredictable moment.
    //
    // Bounded to the function body. An unbounded slice runs on into the
    // reconciliation report's doc comment, which quotes the paywall hole
    // verbatim - a guard that trips on its own explanation is one nobody keeps.
    const src = read("apps/api/src/domains/admin/billing.ts");
    const start = src.indexOf("export async function manageTeamSubscriptionService");
    const end = src.indexOf("export interface BillingReconciliation");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = src.slice(start, end);
    expect(fn).not.toContain('.from("teams").update(');
  });

  it("requires a reason for a plan override", () => {
    expect(read("apps/api/src/domains/admin/billing.ts")).toContain("reason: reasonSchema");
  });
});

describe("usage and cost", () => {
  it("labels the cost as an estimate on both sides", () => {
    expect(read("apps/api/src/domains/admin/usage.ts")).toContain("estimatedAiCostUsd");
    expect(read("apps/web/src/features/admin/pages/AdminUsagePage.tsx")).toContain("Estimate only");
  });

  it("counts work by users in no team rather than dropping it", () => {
    expect(read("apps/api/src/domains/admin/usage.ts")).toContain("Unattributed (no team)");
  });
});

describe("every new admin surface is registered, routed and navigable", () => {
  const PATHS = ["/admin/health", "/admin/usage", "/admin/security", "/admin/feedback"];

  it.each(PATHS)("%s is in ADMIN_NAV and the route tree", (path) => {
    expect(read("apps/web/src/features/admin/pages/AdminLayout.tsx")).toContain(`to: "${path}"`);
    expect(read("apps/web/src/routeTree.gen.ts")).toContain(`/_app${path}`);
  });

  it("the user detail route exists", () => {
    expect(read("apps/web/src/routeTree.gen.ts")).toContain("/_app/admin/users_/$userId");
  });

  it("every new admin op is registered and has a client binding", () => {
    const registry = read("apps/api/src/domains/rpc/registry.ts");
    const client = read("apps/web/src/lib/admin.functions.ts");
    const ops = [
      "getPlatformUserDetail",
      "runUserSupportAction",
      "deletePlatformUser",
      "getTeamBilling",
      "overrideTeamPlan",
      "manageTeamSubscription",
      "getBillingReconciliation",
      "listShareLinks",
      "revokeShareLinks",
      "getApiHealth",
      "listJobRuns",
      "getPlatformUsage",
      "getContentLibrary",
    ];
    for (const op of ops) {
      expect(registry, `${op} not registered`).toContain(`  ${op}:`);
      // The op name as a string literal, not `("op")` - prettier wraps a long
      // rpcOp call onto its own line and the parenthesis moves.
      expect(client, `${op} has no client binding`).toContain(`"${op}"`);
    }
  });
});

describe("server errors are diagnosable", () => {
  it("records the thrown message for 5xx, not just the code", () => {
    // errorCode is "internal_error" for a missing Stripe customer, a null
    // dereference and a timeout alike, so the log said something failed and
    // nothing about what.
    const src = read("apps/api/src/domains/rpc/handle.ts");
    expect(src).toContain("err.message.slice(0, 500)");
    expect(src).toContain("res.status >= 500");
  });

  it("shows that message on the health page", () => {
    expect(read("apps/api/src/domains/admin/health.ts")).toContain('f.meta?.error === "string"');
    expect(read("apps/web/src/features/admin/pages/AdminHealthPage.tsx")).toContain("f.message");
  });

  it("does not log 4xx messages", () => {
    // Routine rejections would bury the real failures.
    const src = read("apps/api/src/domains/rpc/handle.ts");
    expect(src).not.toContain("res.status >= 400 && err instanceof Error");
  });
});

describe("billing portal reports why it failed", () => {
  it("returns a 4xx for a precondition rather than a bare 500", () => {
    // jsonFromUnknownError only forwards a message for 4xx, so a status-less
    // Error reached the customer AND the log as a generic internal_error.
    const src = read("apps/api/src/domains/billing/service.ts");
    expect(src).toContain("No billing account yet");
    expect(src).toMatch(/status:\s*409/);
  });

  it("names a customer id the current Stripe key cannot see", () => {
    // Stored ids stay syntactically valid when the key points at another
    // Stripe account, so the failure looks like a random 500 on one button.
    const src = read("apps/api/src/domains/billing/service.ts");
    expect(src).toContain("resource_missing");
    expect(src).toContain("different Stripe account");
  });
});

describe("getMyTeam is not N+1 on the auth API", () => {
  it("resolves email confirmation in one query", () => {
    // getMyTeam is 39% of all API traffic (AppSidebar calls it on every mount),
    // and it used to make one HTTPS round trip to GoTrue per team member. The
    // comment justifying that said "this is a page that loads once"; it is not.
    const src = read("apps/api/src/domains/teams/service.ts");
    expect(src).toContain("email_confirmed_for_users");
    expect(src).not.toContain("this is a page that loads once");
  });

  it("keeps the per-member path only as a pre-migration fallback", () => {
    const src = read("apps/api/src/domains/teams/service.ts");
    const fn = src.slice(
      src.indexOf("async function loadEmailConfirmed"),
      src.indexOf("export async function getMyTeamService"),
    );
    expect(fn).toContain("isMissingFunction");
    expect(fn).toContain("auth.admin.getUserById");
  });

  it("treats an unresolved member as unknown, not unconfirmed", () => {
    // ProjectTasks refuses to assign work to an unconfirmed member, so
    // defaulting to false would block someone who can sign in perfectly well.
    const src = read("apps/api/src/domains/teams/service.ts");
    expect(src).toContain('typeof row.email_confirmed === "boolean"');
  });

  it("fetches profiles and confirmation in parallel", () => {
    const src = read("apps/api/src/domains/teams/service.ts");
    expect(src).toContain("loadEmailConfirmed(supabaseAdmin, userIds)");
    expect(src).toMatch(/const \[profilesResult, confirmed\] = await Promise\.all\(/);
  });

  it("locks the SECURITY DEFINER function to the service role", () => {
    // It reads auth.users. Postgres grants EXECUTE to PUBLIC by default, so
    // without the REVOKE any signed-in user could enumerate confirmation state.
    const sql = read("supabase/migrations/20260822160000_email_confirmed_lookup.sql");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.email_confirmed_for_users(uuid[]) FROM PUBLIC, anon, authenticated",
    );
    expect(sql).toContain("SECURITY DEFINER");
  });

  it("returns a row for an id with no auth user", () => {
    // Driven off unnest(), so a missing auth row is NULL rather than absent -
    // the caller distinguishes unknown from unconfirmed.
    const sql = read("supabase/migrations/20260822160000_email_confirmed_lookup.sql");
    expect(sql).toContain("FROM unnest(user_ids)");
    expect(sql).toContain("LEFT JOIN auth.users");
  });
});

describe("a nested route's parent must render an Outlet", () => {
  /*
   * The defect family this guards.
   *
   * TanStack's flat-file convention nests `_app.admin.users.$userId` UNDER
   * `_app.admin.users`. If the parent's component does not render an <Outlet/>,
   * the child never mounts: visiting /admin/users/<id> silently renders the
   * users LIST, at the detail URL, with no error, no console warning and no
   * failed request. Every static check passes - the file exists, the route id is
   * in routeTree.gen.ts, the component compiles - and the page is simply wrong.
   *
   * The admin team detail page shipped in this state and nobody noticed. It was
   * found by driving the app in a browser, which is the only thing that can find
   * it, and this test is the cheap substitute for doing that every time.
   *
   * The fix is the trailing-underscore sibling convention the repo already uses
   * elsewhere (`_app.showcases_.$showcaseId.tsx`): it keeps the same URL but
   * stops the route nesting.
   */
  const ROUTES = join(ROOT, "apps/web/src/routes");

  it("no $param route sits under a parent that cannot render it", () => {
    const files = readdirSync(ROUTES).filter((f) => f.endsWith(".tsx"));
    const offenders: string[] = [];

    for (const file of files) {
      const m = file.match(/^(.*)\.\$[^.]+\.tsx$/);
      if (!m) continue;
      const parent = `${m[1]}.tsx`;
      if (!files.includes(parent)) continue; // no parent route: nothing to nest under

      const parentSrc = readFileSync(join(ROUTES, parent), "utf8");
      const comp = (parentSrc.match(/component:\s*(\w+)/) ?? [])[1];
      const imp = comp
        ? parentSrc.match(new RegExp(`import \{[^}]*\b${comp}\b[^}]*\} from "([^"]+)"`))
        : null;

      let componentSrc = "";
      if (imp) {
        const rel = imp[1].replace("@/", "apps/web/src/");
        for (const ext of [".tsx", ".ts"]) {
          const candidate = join(ROOT, rel + ext);
          if (existsSync(candidate)) componentSrc = readFileSync(candidate, "utf8");
        }
      }

      if (!/<Outlet/.test(componentSrc)) {
        offenders.push(
          `${file} nests under ${parent} (${comp ?? "?"}), which renders no <Outlet/>. ` +
            `Rename it to ${m[1]}_.$… to make it a sibling.`,
        );
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("user directory", () => {
  it("filters, sorts, counts and pages in SQL rather than in Node", () => {
    // Filtering a fetched page filters only what was fetched, which produces
    // confidently wrong counts. The whole screen is one query.
    const sql = read("supabase/migrations/20260823100000_admin_user_directory.sql");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.admin_user_directory");
    expect(sql).toContain("count(*) OVER () AS total_count");
    expect(sql).toContain("LIMIT greatest(p_limit, 1) OFFSET greatest(p_offset, 0)");
  });

  it("returns one row per user even when they are in two teams", () => {
    // A plain LEFT JOIN to team_members emits a row per membership, which
    // double-counts the user and corrupts both the total and the paging.
    const sql = read("supabase/migrations/20260823100000_admin_user_directory.sql");
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain("team_count");
  });

  it("orders deterministically so paging cannot repeat or skip a row", () => {
    const sql = read("supabase/migrations/20260823100000_admin_user_directory.sql");
    expect(sql).toContain("f.created_at DESC, f.id");
  });

  it("locks the directory and notes down to the service role", () => {
    const sql = read("supabase/migrations/20260823100000_admin_user_directory.sql");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.admin_user_directory");
    // user_notes are internal notes ABOUT a customer and must never be readable
    // by them; Supabase grants new public tables to anon by default.
    expect(sql).toContain("REVOKE ALL ON public.user_notes FROM anon, authenticated");
    expect(sql).toContain("ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY");
  });

  it("says so rather than faking filters before the migration runs", () => {
    const src = read("apps/api/src/domains/admin/user-directory.ts");
    expect(src).toContain("degraded: true");
    expect(read("apps/web/src/features/admin/pages/AdminUsersPage.tsx")).toContain(
      "Filters and sorting are unavailable",
    );
  });

  it("exposes every status an operator asks about", () => {
    const api = read("apps/api/src/domains/admin/user-directory.ts");
    const sql = read("supabase/migrations/20260823100000_admin_user_directory.sql");
    for (const s of ["unconfirmed", "suspended", "no_team", "dormant", "admin"]) {
      expect(api, `API missing ${s}`).toContain(`"${s}"`);
      expect(sql, `SQL missing ${s}`).toContain(`'${s}'`);
    }
  });
});

describe("admin roles are settable, not just enforceable", () => {
  it("the UI can set a role, not only a boolean", () => {
    // The roles were enforced on every mutating service from the day they
    // landed, but nothing could set them - so every admin was a superadmin and
    // the capability system was decorative.
    const panel = read("apps/web/src/features/admin/components/UserAdminPanels.tsx");
    expect(panel).toContain("setAdminRole");
    for (const r of ["support", "billing", "superadmin"]) {
      expect(panel, `role ${r} not offered`).toContain(r);
    }
  });

  it("refuses to leave the platform with no superadmin", () => {
    // Narrowing the only superadmin to `support` locks out grant, revoke and
    // delete for everyone without removing a single row, so a guard that only
    // counted admins would wave it through.
    const src = read("apps/api/src/domains/admin/user-directory.ts");
    expect(src).toContain("This is the last superadmin");
    expect(src).toMatch(/\.eq\("role", "superadmin"\)[\s\S]{0,80}\.neq\("user_id", data\.userId\)/);
  });

  it("requires a reason for every role change", () => {
    const src = read("apps/api/src/domains/admin/user-directory.ts");
    expect(src).toMatch(/setAdminRoleInputSchema[\s\S]{0,300}reason: z\.string\(\)/);
  });
});

describe("bulk user actions", () => {
  it("reports partial success instead of rounding it up", () => {
    const src = read("apps/api/src/domains/admin/user-directory.ts");
    expect(src).toContain("failed: Array<{ userId: string; reason: string }>");
    expect(read("apps/web/src/features/admin/pages/AdminUsersPage.tsx")).toContain(
      "res.failed.length",
    );
  });

  it("excludes delete", () => {
    // The one irreversible action stays one at a time, behind its typed
    // confirmation. Bulk-deleting accounts is not a support gesture.
    const src = read("apps/api/src/domains/admin/user-directory.ts");
    expect(src).toContain('z.enum(["suspend", "reinstate", "resend_confirmation"])');
  });

  it("runs sequentially and is bounded", () => {
    // Each is a GoTrue round trip; a parallel burst of a hundred is how a
    // support action becomes an auth outage.
    const src = read("apps/api/src/domains/admin/user-directory.ts");
    expect(src).toMatch(/userIds: z\.array\(z\.string\(\)\.uuid\(\)\)\.min\(1\)\.max\(100\)/);
    expect(src).toContain("for (const userId of data.userIds)");
  });

  it("clears the selection when filters change", () => {
    // Keeping a selection across a filter change means a bulk action hits
    // accounts the operator can no longer see.
    const src = read("apps/web/src/features/admin/pages/AdminUsersPage.tsx");
    expect(src).toMatch(/const applyFilter[\s\S]{0,260}setSelected\(new Set\(\)\)/);
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formula injection with a prefix, not with quoting", () => {
    /*
     * A display name of `=HYPERLINK(...)` is executed by Excel, Sheets and
     * LibreOffice on the machine of whoever opens the export. CSV quoting does
     * not stop it - quoting is how the value survives transport, and the
     * spreadsheet evaluates what it finds inside the quotes. The leading
     * apostrophe is the actual mitigation.
     */
    const src = read("apps/api/src/domains/admin/user-directory.ts");
    expect(src).toContain("s = `'${s}`");
    expect(src).toContain("Formula injection");
  });

  it("is bounded and says when it truncated", () => {
    const src = read("apps/api/src/domains/admin/user-directory.ts");
    expect(src).toContain("truncated");
    expect(src).toMatch(/max: z\.number\(\)\.int\(\)\.min\(1\)\.max\(5000\)/);
  });
});
