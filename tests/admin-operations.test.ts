import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
    expect(read("apps/web/src/routeTree.gen.ts")).toContain("/_app/admin/users/$userId");
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
