import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/*
 * The capability system has to be visible, not just enforced.
 *
 * Roles were checked on every mutating service from the day they landed and
 * shown nowhere, so a `support` admin saw the full set of billing and
 * superadmin controls and discovered which were theirs by pressing one and
 * reading a 403 in a toast. A permission system nobody can see is a trap.
 */

describe("the client capability map mirrors the server", () => {
  it("grants the same capabilities to the same roles", () => {
    // Drift here produces a control that looks available and 403s - exactly
    // what surfacing roles was meant to remove.
    const server = read("apps/api/src/lib/admin-context.ts");
    const client = read("apps/web/src/features/admin/hooks/use-admin-role.ts");
    for (const line of [
      'support: new Set<AdminCapability>(["read", "support"])',
      'billing: new Set<AdminCapability>(["read", "billing"])',
    ]) {
      expect(server, `server missing ${line}`).toContain(line);
      expect(client, `client missing ${line}`).toContain(line);
    }
    expect(client).toMatch(/superadmin: new Set<AdminCapability>\(\[[^\]]*"owner"[^\]]*\]\)/);
  });

  it("is optimistic when the role is unknown", () => {
    /*
     * While the check is in flight, or against a database without the role
     * column, disabling everything would make the console look broken for
     * someone who is in fact a superadmin. The server refuses what it must, so
     * being optimistic costs a clear 403 at worst.
     */
    const src = read("apps/web/src/features/admin/hooks/use-admin-role.ts");
    expect(src).toContain("role === null ? true");
  });

  it("says it is not the security boundary", () => {
    const src = read("apps/web/src/features/admin/hooks/use-admin-role.ts");
    expect(src).toContain("NOT A SECURITY BOUNDARY");
  });
});

describe("controls are gated to the role that can use them", () => {
  const CASES: Array<[string, string]> = [
    ["apps/web/src/features/admin/components/TeamBillingPanel.tsx", "billing"],
    ["apps/web/src/features/admin/pages/AdminSecurityPage.tsx", "owner"],
    ["apps/web/src/features/admin/pages/AdminUsersPage.tsx", "support"],
  ];

  it.each(CASES)("%s asks for %s", (file, capability) => {
    const src = read(file);
    expect(src).toContain(`denyReason("${capability}")`);
    expect(src, "a disabled control must say why").toContain("CapabilityNotice");
  });

  it("the user detail page gates support and delete separately", () => {
    // Deleting is the one irreversible action and is superadmin-only, while
    // the rest of the support actions are not.
    const src = read("apps/web/src/features/admin/pages/AdminUserDetailPage.tsx");
    expect(src).toContain('denyReason("support")');
    expect(src).toContain('denyReason("owner")');
  });

  it("the admin's own role is shown to them", () => {
    const src = read("apps/web/src/features/admin/pages/AdminLayout.tsx");
    expect(src).toContain("adminCheck?.role");
  });

  it("checkIsPlatformAdmin returns the role, not just a boolean", () => {
    const src = read("apps/api/src/domains/admin/service.ts");
    expect(src).toContain("{ isAdmin: boolean; role: AdminRole | null }");
  });
});

describe("the audit log survives read logging", () => {
  it("hides view rows by default", () => {
    /*
     * Read logging made "who opened this account" answerable and also made
     * routine browsing the loudest content on the page whose job is "who
     * changed this".
     */
    const api = read("apps/api/src/domains/admin/audit.ts");
    expect(api).toContain("includeViews: z.boolean().default(false)");
    expect(api).toContain('query.not("action", "like", "view\\\\_%")');
  });

  it("matches the view_ prefix rather than a list of known actions", () => {
    // logAdminRead builds every read action name the same way, so a prefix
    // filter keeps working as detail views are added.
    const api = read("apps/api/src/domains/admin/audit.ts");
    expect(api).toContain("action: `view_${params.targetType}`");
  });

  it("escapes the action filter", () => {
    const api = read("apps/api/src/domains/admin/audit.ts");
    expect(api).toContain("stripLikeWildcards(data.action)");
  });

  it("surfaces the reason instead of burying it in JSON", () => {
    // The reason is the most useful thing on an audit row, and every mutating
    // action is required to carry one.
    const page = read("apps/web/src/features/admin/pages/AdminAuditLogPage.tsx");
    expect(page).toContain('typeof e.metadata?.reason === "string"');
  });
});

describe("api_audit_logs retention actually runs", () => {
  it("is called by the daily purge job", () => {
    // The function was written with the observability work and then called by
    // nothing, so the table it exists to bound grew without limit.
    const src = read("apps/api/src/domains/hooks/purge-trash.ts");
    expect(src).toContain("admin_prune_api_audit_logs");
    expect(src).toContain("keep_days: 90");
  });

  it("cannot fail the purge it rides along with", () => {
    // Trash purge carries a customer-visible 60-day recovery promise; a
    // retention hiccup must not take it down.
    const src = read("apps/api/src/domains/hooks/purge-trash.ts");
    expect(src).toMatch(/try \{[\s\S]{0,400}admin_prune_api_audit_logs[\s\S]{0,400}catch/);
  });

  it("reports how many rows it removed", () => {
    // A silently-zero prune should be visible on the Health page.
    const src = read("apps/api/src/domains/hooks/purge-trash.ts");
    expect(src).toContain("auditRowsPruned");
  });
});
