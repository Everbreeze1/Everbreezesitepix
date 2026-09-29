/**
 * Where Back goes when there is nothing to go back to.
 *
 * A screen opened from a notification, a share link or a cold start sits at
 * the bottom of the stack with nothing under it, so the navigator draws no
 * back arrow and Android's Back closes the app. Jon, 2026-09-29: "some of the
 * pages have back buttons some of them dont. can we make sure that is all
 * navigable." Every such screen instead goes to the page it belongs under: a
 * project's own pages to that project, a photo's pages to its project (or the
 * Photo Library), settings to Account, admin pages to Admin, the rest to Home.
 *
 * Import-free so a test can read it: `_layout.tsx` uses it for the header's
 * back arrow and for Android's hardware Back, so the two always agree.
 */

type Params = Record<string, unknown> | undefined;

function param(params: Params, key: string): string | null {
  const value = params?.[key];
  const one = Array.isArray(value) ? value[0] : value;
  return typeof one === "string" && one.length > 0 ? one : null;
}

/**
 * The parent page's href for a route of the signed-in stack, named the way
 * `_layout.tsx` names it (`project/[id]/tasks`, `report/[reportId]`).
 */
export function parentHref(routeName: string, params?: Params): string {
  const name = routeName.endsWith("/index") ? routeName.slice(0, -6) : routeName;

  if (name.startsWith("project/[id]/")) {
    const id = param(params, "id");
    return id ? `/project/${id}` : "/projects";
  }
  if (name === "project/[id]") return "/projects";

  if (name.startsWith("photo/[id]/")) {
    const projectId = param(params, "projectId");
    return projectId ? `/project/${projectId}` : "/gallery";
  }

  if (name === "report/edit/[reportId]") {
    const id = param(params, "reportId");
    return id ? `/report/${id}` : "/reports";
  }
  if (name === "report/[reportId]") return "/reports";
  if (name === "summary/[summaryId]") return "/reports";

  if (name === "group/[id]") return "/groups";
  if (name === "template/[id]" || name === "workflow-template/[templateId]") return "/templates";

  if (name.startsWith("admin/") && name !== "admin") return "/admin";

  if (
    name.startsWith("settings/") ||
    name === "workspace" ||
    name === "labels" ||
    name === "collaborators" ||
    name === "close-account" ||
    name === "queue" ||
    name === "trash"
  ) {
    return "/account";
  }

  return "/";
}
