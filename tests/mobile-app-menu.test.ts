import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_MENU, isMenuItemActive } from "../apps/mobile/src/lib/app-menu";

/*
 * The app menu.
 *
 * The owner tested the Android build on a tablet and found a wide dark rail
 * with four tabs on it, a Browse grid at the foot of Home, and far less on
 * offer than the website's sidebar. The menu is the answer to all three: one
 * list of every destination, grouped like the web, opened from a small button
 * and gone once a row is picked. These pin what it lists and how it opens.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const APP = "apps/mobile/app/(app)";

const items = APP_MENU.flatMap((group) => group.items);
const hrefs = items.map((item) => item.href);
const labels = items.map((item) => item.label);

describe("the menu's destinations", () => {
  it("groups them the way the web sidebar does", () => {
    expect(APP_MENU.map((group) => group.title)).toEqual([
      "Workspace",
      "Set up",
      "Client-facing",
      null,
    ]);
  });

  it("offers every row the web sidebar has", () => {
    /*
     * Upgrade is the one deliberate omission (a purchase link in an app's main
     * menu does not get through store review), and Blueprints, Checklists and
     * Documents are one Templates screen in the app.
     */
    for (const label of [
      "Overview",
      "Projects",
      "Photo Library",
      "Reports",
      "Maps",
      "Templates",
      "Teams",
      "Portfolio",
      "Knowledge Base",
      "Feedback",
      "Admin",
    ]) {
      expect(labels, label).toContain(label);
    }
  });

  it("keeps everything the old Browse grid on Home reached", () => {
    for (const href of ["/reports", "/map", "/pipelines", "/timeline", "/groups", "/activity"]) {
      expect(hrefs, href).toContain(href);
    }
  });

  it("points every in-app row at a screen that exists", () => {
    for (const item of items) {
      if (item.web) continue;
      const name = item.href === "/" ? "index" : item.href.slice(1);
      const candidates = [`${APP}/${name}.tsx`, `${APP}/(tabs)/${name}.tsx`];
      expect(
        candidates.some((p) => existsSync(join(ROOT, p))),
        `${item.label} -> ${item.href}`,
      ).toBe(true);
    }
  });

  it("marks the four bottom-bar screens as tabs, and only those", () => {
    const tabs = items.filter((item) => item.tab).map((item) => item.href);
    expect(tabs.sort()).toEqual(["/", "/account", "/gallery", "/projects"]);
  });

  it("lists each destination once", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("hides the staff console from everyone the server does not vouch for", () => {
    expect(items.find((item) => item.href === "/admin")?.adminOnly).toBe(true);
  });
});

describe("isMenuItemActive", () => {
  const find = (href: string) => items.find((item) => item.href === href)!;

  it("lights Home only on Home", () => {
    expect(isMenuItemActive(find("/"), "/")).toBe(true);
    expect(isMenuItemActive(find("/"), "/reports")).toBe(false);
  });

  it("lights a row for the screens beneath it, not for a lookalike", () => {
    expect(isMenuItemActive(find("/map"), "/map")).toBe(true);
    expect(isMenuItemActive(find("/team"), "/team/invite")).toBe(true);
    expect(isMenuItemActive(find("/reports"), "/report-issue")).toBe(false);
  });

  it("never lights a link to the website", () => {
    expect(isMenuItemActive(find("/help"), "/help")).toBe(false);
  });
});

describe("how the menu is reached", () => {
  it("replaces the tablet rail with a floating menu button and the camera", () => {
    const bar = read("apps/mobile/src/components/TabBar.tsx");
    const railBranch = bar.slice(
      bar.indexOf("if (rail) {"),
      bar.indexOf("return (", bar.indexOf("if (rail) {") + 200),
    );
    // Out of the layout, so the page keeps the full width.
    expect(railBranch).toContain('position: "absolute"');
    expect(railBranch).toContain("<FloatingMenuButton />");
    expect(railBranch).toContain("{cameraButton}");
    // No tabs stacked down the edge any more: they are rows in the menu.
    expect(railBranch).not.toContain("state.routes.map");
    expect(bar).not.toContain("width: 96 + insets.right");
  });

  it("draws the floating menu button big, high-contrast and on the lower third", () => {
    // Jon, 2026-09-29: "closer to lower third of the page, give it a good
    // color contrast and make it bigger".
    const menu = read("apps/mobile/src/components/AppMenu.tsx");
    const button = menu.slice(menu.indexOf("export function FloatingMenuButton"));
    expect(menu).toContain("export const FLOATING_MENU_SIZE = 62;");
    expect(button).toContain('accessibilityLabel="Open menu"');
    expect(button).toContain("backgroundColor: theme.colors.foreground");
    expect(button).toContain("color={theme.colors.background}");
    const home = read(`${APP}/(tabs)/index.tsx`);
    expect(home).toContain('bottom: "22%"');
    expect(home).not.toContain("<MenuButton />");
    const bar = read("apps/mobile/src/components/TabBar.tsx");
    expect(bar).toContain('justifyContent: "flex-end"');
  });

  it("keeps the phone's bottom bar of four tabs around the camera", () => {
    const layout = read(`${APP}/(tabs)/_layout.tsx`);
    for (const name of ["index", "projects", "gallery", "account"]) {
      expect(layout).toContain(`name="${name}"`);
    }
  });

  it("mounts the menu once, around the signed-in stack", () => {
    const layout = read(`${APP}/_layout.tsx`);
    expect(layout).toContain("<AppMenuProvider>");
    expect(layout.indexOf("<AppMenuProvider>")).toBeLessThan(layout.indexOf("<Stack"));
  });
});

describe("menu destinations open inside the app", () => {
  const layout = read(`${APP}/_layout.tsx`).replace(/\s+/g, " ");

  it("slides pushed screens in from the right on both platforms", () => {
    expect(layout).toContain('animation: "slide_from_right"');
  });

  it("pushes every destination rather than presenting it as a modal", () => {
    for (const item of items) {
      if (item.web || item.tab) continue;
      const name = item.href.slice(1);
      const element = layout
        .split("<Stack.Screen")
        .find((chunk) => chunk.includes(`name="${name}"`));
      if (!element) continue; // Registered by the file itself with the stack defaults.
      const own = element.slice(0, element.indexOf("/>"));
      expect(own, name).not.toContain("presentation");
    }
  });

  it("leaves the camera and the editors as full-screen modals", () => {
    for (const name of [
      "project/[id]/capture",
      "project/[id]/walkthrough-record",
      "photo/[id]/annotate",
    ]) {
      const element = layout
        .split("<Stack.Screen")
        .find((chunk) => chunk.includes(`name="${name}"`));
      expect(element, name).toContain('presentation: "fullScreenModal"');
      expect(element, name).toContain("...MODAL_ANIMATION");
    }
  });
});
