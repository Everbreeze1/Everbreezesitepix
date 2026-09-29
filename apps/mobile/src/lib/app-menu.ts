/**
 * Every place the app menu can take you, grouped the way the web sidebar is.
 *
 * Import-free so a test can read it: the list is the promise that a phone or a
 * tablet reaches everything the website's sidebar does, and the only way to
 * keep that promise is to pin it. `AppMenu` turns each `icon` name into the
 * glyph, so this file never has to load React Native.
 *
 * The groups and their order are the web's (`AppSidebar.tsx`): Workspace, Set
 * up, Client-facing, and the small utility rows at the foot. The app adds the
 * browse surfaces the web keeps inside its Projects page (Pipelines, Timeline,
 * Groups) and the activity feed, which used to be the Browse grid at the
 * bottom of Home, a place nobody scrolled to.
 *
 * Notifications is not a row either. The bell sits in the header at the top of
 * the page, where it shows the unread count, and a second copy in this list
 * only repeated it (Jon, 2026-09-29: "leave it on top of the page").
 *
 * Two web rows are not here, on purpose. "Upgrade" is a purchase, and an app
 * store will not ship an app that links out to one from its main menu; plan
 * and billing stay on Account, which opens the web page. Blueprints,
 * Checklists and Documents are three tabs of one web page, and the app's
 * counterpart is one Templates screen, so they are one row.
 */

export type AppMenuIcon =
  | "overview"
  | "projects"
  | "photos"
  | "reports"
  | "map"
  | "pipelines"
  | "timeline"
  | "groups"
  | "activity"
  | "templates"
  | "team"
  | "portfolio"
  | "account"
  | "help"
  | "feedback"
  | "admin";

export type AppMenuItem = {
  label: string;
  /** An in-app route, or a path on the website when `web` is set. */
  href: string;
  icon: AppMenuIcon;
  /**
   * A tab of the bottom bar rather than a screen pushed on top of it. Reaching
   * one from a pushed screen goes back to the tabs instead of stacking a
   * second copy of Home on top of Reports.
   */
  tab?: boolean;
  /** Opens the website in the in-app browser: the app has no screen for it. */
  web?: boolean;
  /** Staff only, gated on the same server check as the Account row. */
  adminOnly?: boolean;
  /**
   * The account owner only (team role `owner`). The Portfolio is the company's
   * public face, so invited members of any role do not get the row.
   */
  ownerOnly?: boolean;
};

export type AppMenuGroup = {
  /** Section heading. `null` for the utility rows, which the web draws unlabelled. */
  title: string | null;
  items: AppMenuItem[];
};

export const APP_MENU: AppMenuGroup[] = [
  {
    title: "Workspace",
    items: [
      { label: "Overview", href: "/", icon: "overview", tab: true },
      { label: "Projects", href: "/projects", icon: "projects", tab: true },
      { label: "Photo Library", href: "/gallery", icon: "photos", tab: true },
      { label: "Reports", href: "/reports", icon: "reports" },
      { label: "Maps", href: "/map", icon: "map" },
      { label: "Pipelines", href: "/pipelines", icon: "pipelines" },
      { label: "Timeline", href: "/timeline", icon: "timeline" },
      { label: "Groups", href: "/groups", icon: "groups" },
      { label: "Team activity", href: "/activity", icon: "activity" },
    ],
  },
  {
    title: "Set up",
    items: [
      { label: "Templates", href: "/templates", icon: "templates" },
      { label: "Teams", href: "/team", icon: "team" },
    ],
  },
  {
    title: "Client-facing",
    items: [{ label: "Portfolio", href: "/portfolio", icon: "portfolio", ownerOnly: true }],
  },
  {
    title: null,
    items: [
      { label: "Account and settings", href: "/account", icon: "account", tab: true },
      { label: "Knowledge Base", href: "/help", icon: "help", web: true },
      { label: "Feedback", href: "/report-issue", icon: "feedback" },
      { label: "Admin", href: "/admin", icon: "admin", adminOnly: true },
    ],
  },
];

/**
 * Whether a row stands for the screen that is showing.
 *
 * Home is `/` and every path starts with a slash, so it only matches exactly.
 * Everything else also lights up for the screens beneath it.
 */
export function isMenuItemActive(item: AppMenuItem, pathname: string): boolean {
  if (item.web) return false;
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
