import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adminCan,
  canSeeGatedItem,
  isAccountOwner,
  readAdminAccess,
} from "../apps/mobile/src/lib/access";
import { APP_MENU } from "../apps/mobile/src/lib/app-menu";

/*
 * Who sees Portfolio and who sees Admin.
 *
 * Jon, 2026-09-29: "This portfolio is gated to account owner not lower
 * levels. Admin function is only for the test account so no subscribers
 * should have access to admin."
 *
 * Admin is platform staff (`platform_admins`, asked through
 * `checkIsPlatformAdmin`, the op the web's AdminLayout and sidebar ask).
 * Portfolio is the team's `owner` role, the field the web sidebar branches on.
 */

const APP = "apps/mobile/app/(app)";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const items = APP_MENU.flatMap((group) => group.items);

describe("readAdminAccess", () => {
  it("says yes only to a clear yes", () => {
    expect(readAdminAccess({ isAdmin: true, role: "superadmin" })).toEqual({
      isAdmin: true,
      role: "superadmin",
    });
    expect(readAdminAccess({ isAdmin: "true" }).isAdmin).toBe(false);
    expect(readAdminAccess(null).isAdmin).toBe(false);
    expect(readAdminAccess({ isAdmin: false, role: "superadmin" })).toEqual({
      isAdmin: false,
      role: null,
    });
  });
});

describe("isAccountOwner", () => {
  it("is the owner role and nothing below it", () => {
    expect(isAccountOwner({ myRole: "owner" })).toBe(true);
    for (const role of ["admin", "manager", "standard", "restricted", "member", null]) {
      expect(isAccountOwner({ myRole: role })).toBe(false);
    }
    expect(isAccountOwner(undefined)).toBe(false);
  });
});

describe("the menu", () => {
  it("marks Portfolio owner-only and Admin staff-only", () => {
    expect(items.find((item) => item.href === "/portfolio")?.ownerOnly).toBe(true);
    expect(items.find((item) => item.href === "/admin")?.adminOnly).toBe(true);
  });

  it("hides Admin from an account owner who is not staff", () => {
    const admin = items.find((item) => item.href === "/admin")!;
    expect(canSeeGatedItem(admin, { isPlatformAdmin: false, isAccountOwner: true })).toBe(false);
    expect(canSeeGatedItem(admin, { isPlatformAdmin: true, isAccountOwner: false })).toBe(true);
  });

  it("hides Portfolio from invited members", () => {
    const portfolio = items.find((item) => item.href === "/portfolio")!;
    expect(canSeeGatedItem(portfolio, { isPlatformAdmin: true, isAccountOwner: false })).toBe(
      false,
    );
    expect(canSeeGatedItem(portfolio, { isPlatformAdmin: false, isAccountOwner: true })).toBe(true);
  });

  it("filters with both gates", () => {
    const menu = read("apps/mobile/src/components/AppMenu.tsx");
    expect(menu).toContain(
      "canSeeGatedItem(item, { isPlatformAdmin: isAdmin, isAccountOwner: isOwner })",
    );
  });
});

describe("the screens enforce the same gates", () => {
  it("redirects a non-owner away from the Portfolio", () => {
    const screen = read(`${APP}/portfolio.tsx`);
    expect(screen).toContain("useAccountOwner()");
    expect(screen).toContain('if (!isOwner) return <Redirect href="/" />;');
  });

  it("shows the Portfolio row on Account only to the owner", () => {
    const account = read(`${APP}/(tabs)/account.tsx`).replace(/\s+/g, " ");
    expect(account).toContain("{isOwner ? (");
    expect(account).toContain("{isAdmin ? (");
  });

  it("puts every admin screen behind AdminGate", () => {
    for (const file of [
      "index",
      "users",
      "user/[id]",
      "teams",
      "team/[id]",
      "feedback",
      "notifications",
      "health",
      "usage",
      "security",
      "audit-log",
    ]) {
      expect(read(`${APP}/admin/${file}.tsx`), file).toContain("<AdminGate");
    }
  });

  it("keys the staff answer by account, so a cached yes cannot follow a sign-out", () => {
    expect(read("apps/mobile/src/lib/use-access.ts")).toContain(
      'queryKey: ["is-platform-admin", user?.id ?? null]',
    );
    // And the whole cache goes when the signed-in account changes.
    expect(read("apps/mobile/src/lib/auth.tsx")).toContain("queryClient.clear()");
  });
});

describe("adminCan", () => {
  it("mirrors the server's role capabilities", () => {
    expect(adminCan("support", "support")).toBe(true);
    expect(adminCan("support", "billing")).toBe(false);
    expect(adminCan("billing", "owner")).toBe(false);
    expect(adminCan("superadmin", "owner")).toBe(true);
    // Unknown role: offer it, the server decides.
    expect(adminCan(null, "owner")).toBe(true);
  });
});
